'use server';

import { revalidatePath } from 'next/cache';
import {
  UnlockRequired,
  attemptUnlock,
  clearUnlockCookie,
  countSeatSecrets,
  currentLockedUntil,
  currentUnlock,
  deleteSeatRow,
  logSecretEvent,
  parseSecretField,
  parseSecretOwner,
  readContractSecretsPlain,
  readSecretLog,
  readSecretPlain,
  requireUnlock,
  secretOwnerContext,
  secretsConfigured,
  secretsNotConfiguredMessage,
  writeSecret,
} from '@/lib/contracts/secrets';
import { SecretOpenError } from '@/lib/contracts/crypto';
import type {
  ActionResult,
  SecretField,
  SecretLogRow,
  SecretOwner,
  UnlockResult,
  UnlockState,
} from '@/lib/contracts/types';

/*
 * 계약 관리 — 비밀 칸 서버 액션(설계 §3-4·§3-7, 이름·인자는 lib/contracts/types.ts 맨 아래 주석 그대로).
 * 서버 액션은 주소를 아는 누구나 부를 수 있으므로 모든 비밀 동작은 여기서 다시 쿠키를 확인한다.
 * 평문은 요청한 칸(들)만 응답에 싣고, 오류 문구·서버 로그에는 절대 넣지 않는다.
 * 이 파일은 'use server' — async 함수만 export.
 */

const OPEN_FAIL_MSG = '열쇠가 다르거나 값이 손상됨';
const LOCKED_STATE: UnlockState = { configured: false, unlocked: false, name: '', expiresAt: null, lockedUntil: null };

type Fail = { ok: false; error: string; needUnlock?: boolean };

/** 설정 확인 + 열람 쿠키 확인 → 이름 */
async function guard(): Promise<{ ok: true; name: string } | Fail> {
  if (!secretsConfigured()) return { ok: false, error: secretsNotConfiguredMessage() };
  try {
    const { name } = await requireUnlock();
    return { ok: true, name };
  } catch (err) {
    if (err instanceof UnlockRequired) return { ok: false, error: err.message, needUnlock: true };
    return { ok: false, error: '인증 상태를 확인하지 못했어요. 화면을 새로 고쳐 주세요.' };
  }
}

/** 던진 오류 → 화면 문구(복호화 실패는 한 가지 문구로만) */
function failFrom(err: unknown, fallback: string): Fail {
  if (err instanceof UnlockRequired) return { ok: false, error: err.message, needUnlock: true };
  if (err instanceof SecretOpenError) return { ok: false, error: OPEN_FAIL_MSG };
  const message = err instanceof Error && err.message ? err.message : fallback;
  return { ok: false, error: message };
}

function cleanName(raw: unknown): string {
  return typeof raw === 'string'
    ? raw
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

/** 지금 열람 상태 — 설정 전이면 configured:false. 던지지 않음 */
export async function getUnlockState(): Promise<UnlockState> {
  try {
    if (!secretsConfigured()) return LOCKED_STATE;
    const session = await currentUnlock();
    if (session) return { configured: true, unlocked: true, name: session.name, expiresAt: session.expiresAt, lockedUntil: null };
    return { configured: true, unlocked: false, name: '', expiresAt: null, lockedUntil: await currentLockedUntil() };
  } catch (err) {
    console.error('[contracts/secretActions] 열람 상태 확인 실패:', (err as Error)?.message);
    return { configured: secretsConfigured(), unlocked: false, name: '', expiresAt: null, lockedUntil: null };
  }
}

/** 인증 비밀번호 + 이름(2자 이상) → 10분 열람 쿠키. 같은 기기 15분 안 5회 / 전체 30회 틀리면 15분 잠금 */
export async function unlockSecrets(password: string, name: string): Promise<UnlockResult> {
  if (!secretsConfigured()) return { ok: false, error: secretsNotConfiguredMessage() };
  const who = cleanName(name);
  if (who.length < 2) return { ok: false, error: '이름을 2자 이상 적어 주세요(열람 기록에 남아요).' };
  if (who.length > 20) return { ok: false, error: '이름은 20자까지 적어 주세요.' };
  if (typeof password !== 'string' || password.length === 0) return { ok: false, error: '인증 비밀번호를 넣어 주세요.' };
  if (password.length > 200) return { ok: false, error: '비밀번호가 너무 길어요.' };
  try {
    const res = await attemptUnlock(password, who);
    if (!res.ok) return res;
    return { ok: true, state: { configured: true, unlocked: true, name: res.name, expiresAt: res.expiresAt, lockedUntil: null } };
  } catch (err) {
    console.error('[contracts/secretActions] 인증 처리 실패:', (err as Error)?.message);
    return { ok: false, error: '인증을 처리하지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** 잠그기 = 쿠키 지우기 + 기록(lock) */
export async function lockSecrets(): Promise<ActionResult> {
  try {
    const session = await currentUnlock();
    await clearUnlockCookie();
    if (session) await logSecretEvent({ action: 'lock', actor: session.name });
    return { ok: true };
  } catch (err) {
    console.error('[contracts/secretActions] 잠그기 실패:', (err as Error)?.message);
    return { ok: false, error: '잠그지 못했어요. 화면을 새로 고쳐 주세요.' };
  }
}

/** 누른 칸 하나만 복호화 → 기록(view). 잠겨 있으면 needUnlock:true */
export async function revealSecret(owner: SecretOwner, field: SecretField): Promise<ActionResult<{ value: string }>> {
  const g = await guard();
  if (!g.ok) return g;
  const o = parseSecretOwner(owner);
  const f = parseSecretField(field);
  if (!o || !f) return { ok: false, error: '어느 칸인지 알 수 없어요. 화면을 새로 고쳐 주세요.' };
  try {
    const value = await readSecretPlain(o, f);
    if (value === null) return { ok: false, error: '저장된 값이 없어요(지워졌을 수 있어요).' };
    const ctx = await secretOwnerContext(o);
    await logSecretEvent({
      action: 'view',
      actor: g.name,
      clientId: ctx.clientId,
      contractId: ctx.contractId,
      seatId: ctx.seatId,
      clientName: ctx.clientName,
      field: f,
    });
    return { ok: true, value };
  } catch (err) {
    return failFrom(err, '비밀 칸을 열지 못했어요.');
  }
}

/** "이 상품 모두 보기" — 한 계약 상품과 그 좌석들만, 기록(view_bulk + 개수) */
export async function revealContractSecrets(
  contractId: string,
): Promise<ActionResult<{ values: { owner: SecretOwner; field: SecretField; value: string }[] }>> {
  const g = await guard();
  if (!g.ok) return g;
  const o = parseSecretOwner({ contractId });
  if (!o) return { ok: false, error: '어느 계약 상품인지 알 수 없어요. 화면을 새로 고쳐 주세요.' };
  try {
    const { values, failed } = await readContractSecretsPlain(o.id);
    if (failed > 0) return { ok: false, error: `${OPEN_FAIL_MSG} (${failed}칸) — 칸마다 따로 열어 보세요.` };
    const ctx = await secretOwnerContext(o);
    await logSecretEvent({
      action: 'view_bulk',
      actor: g.name,
      clientId: ctx.clientId,
      contractId: o.id,
      clientName: ctx.clientName,
      count: values.length,
    });
    return { ok: true, values };
  } catch (err) {
    return failFrom(err, '비밀 칸을 열지 못했어요.');
  }
}

/** 비밀 한 칸 저장(빈 값 = 삭제). 열람 중일 때만, 기록(edit / delete — 값 없이) */
export async function saveSecret(owner: SecretOwner, field: SecretField, value: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const o = parseSecretOwner(owner);
  const f = parseSecretField(field);
  if (!o || !f) return { ok: false, error: '어느 칸인지 알 수 없어요. 화면을 새로 고쳐 주세요.' };
  if (typeof value !== 'string') return { ok: false, error: '값이 올바르지 않아요.' };
  try {
    const result = await writeSecret(o, f, value, g.name);
    if (result !== 'nothing') {
      const ctx = await secretOwnerContext(o);
      await logSecretEvent({
        action: result === 'deleted' ? 'delete' : 'edit',
        actor: g.name,
        clientId: ctx.clientId,
        contractId: ctx.contractId,
        seatId: ctx.seatId,
        clientName: ctx.clientName,
        field: f,
      });
      revalidatePath('/contracts');
    }
    return { ok: true };
  } catch (err) {
    return failFrom(err, '비밀 칸을 저장하지 못했어요.');
  }
}

/** 좌석 삭제(좌석 삭제는 여기로 일원화) — 비밀 칸이 있으면 열람 중이어야, 없으면 그냥. 비밀은 cascade */
export async function deleteSwSeat(id: string): Promise<ActionResult> {
  const o = parseSecretOwner({ seatId: id });
  if (!o) return { ok: false, error: '어느 좌석인지 알 수 없어요. 화면을 새로 고쳐 주세요.' };
  try {
    const secretCount = await countSeatSecrets(o.id);
    let actor = '';
    if (secretCount > 0) {
      const g = await guard();
      if (!g.ok) {
        return g.needUnlock
          ? { ...g, error: `이 좌석에 비밀 칸이 ${secretCount}개 있어요 — 인증 비밀번호를 넣은 뒤(열람 중) 지울 수 있어요.` }
          : g;
      }
      actor = g.name;
    }
    const ctx = secretCount > 0 ? await secretOwnerContext(o) : null;
    const deleted = await deleteSeatRow(o.id);
    if (!deleted) return { ok: false, error: '이미 지워졌거나 없는 좌석이에요. 화면을 새로 고쳐 주세요.' };
    if (ctx) {
      await logSecretEvent({
        action: 'delete',
        actor,
        clientId: ctx.clientId,
        contractId: ctx.contractId,
        seatId: o.id,
        clientName: ctx.clientName,
        count: secretCount,
        note: `좌석 삭제(비밀 칸 ${secretCount}개 함께)`,
      });
    }
    revalidatePath('/contracts');
    revalidatePath('/home');
    return { ok: true };
  } catch (err) {
    return failFrom(err, '좌석을 지우지 못했어요.');
  }
}

/** 열람 기록(최근 limit 건, 최대 500) + 최근 24시간 틀린 시도 수 — 열람 중이어야 */
export async function listSecretLog(limit: number = 200): Promise<ActionResult<{ rows: SecretLogRow[]; failed24h: number }>> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    const { rows, failed24h } = await readSecretLog(limit);
    return { ok: true, rows, failed24h };
  } catch (err) {
    return failFrom(err, '열람 기록을 못 읽었어요.');
  }
}
