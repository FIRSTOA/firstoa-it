'use server';

import { revalidatePath } from 'next/cache';
import {
  UnlockRequired,
  attemptUnlock,
  clearUnlockCookie,
  countSeatSecrets,
  deleteSeatRow,
  logSecretEvent,
  parseSecretField,
  parseSecretOwner,
  readSecretLog,
  readUnlockState,
  replacePassword,
  requireUnlock,
  secretOwnerContext,
  setInitialPassword,
  writeSecret,
} from '@/lib/contracts/secrets';
import type { ActionResult, SecretField, SecretLogRow, SecretOwner, UnlockResult, UnlockState } from '@/lib/contracts/types';

/*
 * 계약 관리 — 소프트웨어 탭 잠금·비밀 칸 서버 액션(D13: 비밀번호 하나로 소프트웨어 탭 전체, 2시간 쿠키).
 * 이름·인자는 lib/contracts/types.ts 맨 아래 주석 그대로. 서버 액션은 주소를 아는 누구나 부를 수 있으므로
 * 쓰기·기록 보기는 모두 여기서 다시 잠금 해제를 확인한다. 비밀 값·비밀번호는 오류 문구·서버 로그에 넣지 않는다.
 * 이 파일은 'use server' — async 함수만 export.
 */

type Fail = { ok: false; error: string; needUnlock?: boolean };

/** 잠금 해제 확인 → 이름(안 적었으면 '') */
async function guard(): Promise<{ ok: true; name: string } | Fail> {
  try {
    const { name } = await requireUnlock();
    return { ok: true, name };
  } catch (err) {
    return failFrom(err, '잠금 상태를 확인하지 못했어요. 화면을 새로 고쳐 주세요.');
  }
}

/** 던진 오류 → 화면 문구 */
function failFrom(err: unknown, fallback: string): Fail {
  if (err instanceof UnlockRequired) return { ok: false, error: err.message, needUnlock: true };
  const message = err instanceof Error && err.message ? err.message : fallback;
  return { ok: false, error: message };
}

/** 이름은 선택 — 적으면 기록에 남음(20자까지) */
function cleanName(raw: unknown): string {
  return typeof raw === 'string'
    ? raw
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20)
    : '';
}

/** 지금 잠금 상태 — 던지지 않음(못 읽으면 잠김·미설정으로) */
export async function getUnlockState(): Promise<UnlockState> {
  try {
    return await readUnlockState();
  } catch (err) {
    console.error('[contracts/secretActions] 잠금 상태 확인 실패:', (err as Error)?.message);
    return { passwordSet: false, unlocked: false, expiresAt: null, lockedUntil: null };
  }
}

/** 처음 비밀번호 정하기 — 아직 안 정했을 때만(4자 이상). 성공하면 이 기기는 바로 열림 */
export async function setFirstPassword(password: string, name?: string): Promise<UnlockResult> {
  try {
    const res = await setInitialPassword(typeof password === 'string' ? password : '', cleanName(name));
    if (!res.ok) return res;
    revalidatePath('/contracts');
    return { ok: true, state: { passwordSet: true, unlocked: true, expiresAt: res.expiresAt, lockedUntil: null } };
  } catch (err) {
    console.error('[contracts/secretActions] 처음 비밀번호 정하기 실패:', (err as Error)?.message);
    return { ok: false, error: '비밀번호를 정하지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** 비밀번호 넣어 열기 — 같은 기기 15분 안 5회 / 전체 30회 틀리면 15분 잠금 */
export async function unlockSecrets(password: string, name?: string): Promise<UnlockResult> {
  if (typeof password !== 'string' || password.length === 0) return { ok: false, error: '비밀번호를 넣어 주세요.' };
  if (password.length > 200) return { ok: false, error: '비밀번호가 맞지 않아요.' };
  try {
    const res = await attemptUnlock(password, cleanName(name));
    if (!res.ok) return res;
    revalidatePath('/contracts');
    return { ok: true, state: { passwordSet: true, unlocked: true, expiresAt: res.expiresAt, lockedUntil: null } };
  } catch (err) {
    console.error('[contracts/secretActions] 잠금 해제 처리 실패:', (err as Error)?.message);
    return { ok: false, error: '잠금 해제를 처리하지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** 잠그기 = 쿠키 지우기 + 기록(lock) */
export async function lockSecrets(): Promise<ActionResult> {
  try {
    let actor: string | null = null;
    try {
      actor = (await requireUnlock()).name;
    } catch {
      actor = null; // 이미 잠겨 있음 — 쿠키만 지움
    }
    await clearUnlockCookie();
    if (actor !== null) await logSecretEvent({ action: 'lock', actor });
    revalidatePath('/contracts');
    return { ok: true };
  } catch (err) {
    console.error('[contracts/secretActions] 잠그기 실패:', (err as Error)?.message);
    return { ok: false, error: '잠그지 못했어요. 화면을 새로 고쳐 주세요.' };
  }
}

/** 비밀번호 바꾸기 — 열려 있고 지금 비밀번호가 맞아야. 다른 기기는 다시 잠기고 이 기기는 계속 열림 */
export async function changePassword(current: string, next: string): Promise<ActionResult> {
  try {
    const res = await replacePassword(typeof current === 'string' ? current : '', typeof next === 'string' ? next : '');
    if (!res.ok) return res;
    revalidatePath('/contracts');
    return { ok: true };
  } catch (err) {
    if (err instanceof UnlockRequired) return failFrom(err, '');
    console.error('[contracts/secretActions] 비밀번호 바꾸기 실패:', (err as Error)?.message);
    return failFrom(err, '비밀번호를 바꾸지 못했어요.');
  }
}

/** 비밀 한 칸 저장(빈 값 = 삭제). 열려 있을 때만, 기록(edit / delete — 값 없이) */
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

/** 좌석 삭제(좌석 삭제는 여기로 일원화) — 열려 있을 때만. 비밀 칸은 cascade 로 같이 지워지고, 있었으면 기록 */
export async function deleteSwSeat(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const o = parseSecretOwner({ seatId: id });
  if (!o) return { ok: false, error: '어느 좌석인지 알 수 없어요. 화면을 새로 고쳐 주세요.' };
  try {
    const secretCount = await countSeatSecrets(o.id);
    const ctx = secretCount > 0 ? await secretOwnerContext(o) : null;
    const deleted = await deleteSeatRow(o.id);
    if (!deleted) return { ok: false, error: '이미 지워졌거나 없는 좌석이에요. 화면을 새로 고쳐 주세요.' };
    if (ctx) {
      await logSecretEvent({
        action: 'delete',
        actor: g.name,
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

/** 기록(최근 limit 건, 최대 500) + 최근 24시간 틀린 시도 수 — 열려 있을 때만 */
export async function listSecretLog(limit: number = 200): Promise<ActionResult<{ rows: SecretLogRow[]; failed24h: number }>> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    const { rows, failed24h } = await readSecretLog(limit);
    return { ok: true, rows, failed24h };
  } catch (err) {
    return failFrom(err, '기록을 못 읽었어요.');
  }
}
