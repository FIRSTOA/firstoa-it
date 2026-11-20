import 'server-only';
import { cookies, headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONTRACT_CLIENTS_TABLE,
  CONTRACT_SECRET_LOG_TABLE,
  CONTRACT_SECRETS_TABLE,
  CONTRACT_SETTINGS_TABLE,
  SW_CONTRACTS_TABLE,
  SW_SEATS_TABLE,
  createAdminClient,
} from '@/lib/supabase/server';
import {
  SECRET_FIELDS,
  UNLOCK_HOURS,
  type SecretField,
  type SecretLogRow,
  type UnlockState,
} from '@/lib/contracts/types';
import {
  checkPassword,
  deriveUnlockKeys,
  ipHashWith,
  lockoutUntil,
  makePasswordHash,
  newCookieSecret,
  parseCookieSecret,
  parsePasswordHash,
  passwordHashFingerprint,
  signUnlockToken,
  verifyUnlockToken,
  type ParsedPasswordHash,
} from '@/lib/contracts/crypto';

/**
 * 계약 관리 소프트웨어 탭 잠금 + 비밀 칸 — 비밀 칸 표(it_contract_secrets)와 설정 표(it_contract_settings)를 읽고 쓰는 **유일한** 파일.
 * 설계 docs/tasks/2026-11-20-contract-management.md §3-4·§3-7, **D13**(비밀번호 하나로 소프트웨어 탭 전체 잠금, 열면 값도 그냥 보임,
 * 비밀 칸은 암호화 없이 value_text 그대로, 비밀번호는 화면에서 정하고 PBKDF2 해시만 settings 에).
 * - 비밀 값·비밀번호는 console·오류 문구·기록 표 어디에도 싣지 않는다.
 * - 값을 돌려주는 readSecretsForOwners 와 비밀 쓰기 writeSecret 은 안에서도 잠금 해제를 다시 확인한다.
 * - insertSecretsIfMissing·verifySecrets 는 시트 옮기기용 — 부르는 액션이 requireUnlock 을 먼저 한다(값은 돌려주지 않음).
 */

export const UNLOCK_COOKIE = 'it_ct_unlock';
/** 잠금 해제 유지 시간(D13: UNLOCK_HOURS) — 연장 없음 */
export const UNLOCK_TTL_MS = UNLOCK_HOURS * 60 * 60 * 1000;
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 200;
const PASSWORD_SETTING = 'sw_password_hash';
const COOKIE_SECRET_SETTING = 'cookie_secret';
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const IP_FAIL_MAX = 5;
const ALL_FAIL_MAX = 30;
const ID_CHUNK = 200;
const PAGE = 1000;
const MAX_SECRET_LENGTH = 4000;
const MISSING_TABLE_MSG = '계약 관리 표가 아직 없어요. supabase/contracts_schema.sql 을 Supabase SQL Editor 에서 먼저 실행해 주세요.';
const DAMAGED_HASH_MSG =
  '저장된 비밀번호 정보가 손상됐어요. Supabase 의 it_contract_settings 에서 sw_password_hash 줄을 지우고 화면에서 다시 정해 주세요.';
const LOG_ACTIONS = ['unlock_ok', 'unlock_fail', 'lock', 'view', 'view_bulk', 'edit', 'delete', 'import'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 잠금 해제 쿠키가 없거나 만료·무효 — 액션은 { ok:false, needUnlock:true } 로 바꿔 돌려줌 */
export class UnlockRequired extends Error {
  constructor(message = `소프트웨어 계약 비밀번호를 먼저 넣어 주세요(한 번 넣으면 ${UNLOCK_HOURS}시간 동안 열려 있어요).`) {
    super(message);
    this.name = 'UnlockRequired';
  }
}

type ErrLike = { code?: string; message?: string } | null | undefined;

function isMissingTable(error: ErrLike): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message ?? '');
  return /it_contract_|it_sw_/.test(message) && /does not exist|could not find|schema cache/i.test(message);
}

/** DB 오류 → 사람이 읽을 문구(details 는 행 내용이 들어갈 수 있어 안 씀) */
function dbError(what: string, error: ErrLike): Error {
  if (isMissingTable(error)) return new Error(MISSING_TABLE_MSG);
  const code = error?.code ? ` [${error.code}]` : '';
  return new Error(`${what}${code}: ${String(error?.message ?? '알 수 없는 오류').slice(0, 120)}`);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function uniqueUuids(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) if (typeof id === 'string' && UUID_RE.test(id)) out.add(id.toLowerCase());
  return [...out];
}

function isSecretField(field: unknown): field is SecretField {
  return typeof field === 'string' && (SECRET_FIELDS as readonly string[]).includes(field);
}

/** 새 비밀번호 모양 검사 — 문제 있으면 문구, 괜찮으면 null */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return '비밀번호를 넣어 주세요.';
  if (password.length < PASSWORD_MIN_LENGTH) return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상으로 정해 주세요.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `비밀번호는 ${PASSWORD_MAX_LENGTH}자까지 돼요.`;
  return null;
}

// ── 설정(비밀번호 해시·쿠키 서명용 값) ─────────────────────────────────

type Auth = {
  supabase: SupabaseClient;
  cookieKey: Buffer;
  ipKey: Buffer;
  /** settings 에 있는 그대로(아직 안 정했으면 null) — 바꿀 때 "읽은 값 그대로일 때만" 비교에 씀 */
  hashStored: string | null;
  /** 모양이 틀리면 null(hashStored 는 있음 → 손상) */
  hash: ParsedPasswordHash | null;
  pwFingerprint: string;
};

async function readSettings(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from(CONTRACT_SETTINGS_TABLE)
    .select('key, value')
    .in('key', [PASSWORD_SETTING, COOKIE_SECRET_SETTING]);
  if (error) throw dbError('잠금 설정을 못 읽었어요', error);
  return new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}

/** 설정 한 번 읽기(매번 새로 — 다른 기기에서 비밀번호를 바꾸면 바로 반영). 쿠키 서명용 값이 없으면 처음 한 번 만듦 */
async function loadAuth(): Promise<Auth> {
  const supabase = createAdminClient();
  let settings = await readSettings(supabase);
  if (!settings.has(COOKIE_SECRET_SETTING)) {
    // 여러 요청이 동시에 와도 하나만 들어가게(on conflict do nothing) → 다시 읽어 들어간 값을 씀
    const { error } = await supabase
      .from(CONTRACT_SETTINGS_TABLE)
      .upsert({ key: COOKIE_SECRET_SETTING, value: newCookieSecret(), updated_by: 'app' }, { onConflict: 'key', ignoreDuplicates: true });
    if (error) throw dbError('잠금 설정 값을 만들지 못했어요', error);
    settings = await readSettings(supabase);
  }
  const secret = parseCookieSecret(settings.get(COOKIE_SECRET_SETTING));
  if (!secret) {
    throw new Error(
      '잠금 설정 값(cookie_secret)이 손상됐어요. Supabase 의 it_contract_settings 에서 cookie_secret 줄을 지우면 새로 만들어요(열려 있던 화면은 다시 잠겨요).',
    );
  }
  const stored = settings.get(PASSWORD_SETTING);
  const hashStored = stored && stored.trim() !== '' ? stored : null;
  const { cookieKey, ipKey } = deriveUnlockKeys(secret);
  return {
    supabase,
    cookieKey,
    ipKey,
    hashStored,
    hash: hashStored ? parsePasswordHash(hashStored) : null,
    pwFingerprint: hashStored ? passwordHashFingerprint(hashStored) : '',
  };
}

// ── 소유자(계약 상품 / 좌석) ──────────────────────────────────────────

export type ParsedOwner = { kind: 'seat' | 'contract'; id: string; column: 'contract_id' | 'seat_id' };

/** 화면에서 온 값은 믿지 않음 — 둘 중 정확히 하나, uuid 모양일 때만 */
export function parseSecretOwner(owner: unknown): ParsedOwner | null {
  if (!owner || typeof owner !== 'object') return null;
  const o = owner as { contractId?: unknown; seatId?: unknown };
  const hasContract = o.contractId !== undefined;
  const hasSeat = o.seatId !== undefined;
  if (hasContract === hasSeat) return null;
  const id = hasContract ? o.contractId : o.seatId;
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  return hasContract
    ? { kind: 'contract', id: id.toLowerCase(), column: 'contract_id' }
    : { kind: 'seat', id: id.toLowerCase(), column: 'seat_id' };
}

export function parseSecretField(field: unknown): SecretField | null {
  return isSecretField(field) ? field : null;
}

/** 기록용 — 그 칸이 어느 상품·거래처 것인지. 못 읽으면 아는 데까지만(기록이 일을 막지 않게) */
export async function secretOwnerContext(
  owner: ParsedOwner,
): Promise<{ exists: boolean; seatId?: string; contractId?: string; clientId?: string; clientName?: string }> {
  const supabase = createAdminClient();
  const out: { exists: boolean; seatId?: string; contractId?: string; clientId?: string; clientName?: string } = { exists: false };
  try {
    let contractId: string | undefined;
    if (owner.kind === 'seat') {
      out.seatId = owner.id;
      const { data, error } = await supabase.from(SW_SEATS_TABLE).select('id, contract_id').eq('id', owner.id).maybeSingle();
      if (error || !data) return out;
      contractId = String((data as { contract_id: string }).contract_id);
    } else {
      contractId = owner.id;
    }
    out.contractId = contractId;
    const { data: c, error: cErr } = await supabase.from(SW_CONTRACTS_TABLE).select('id, client_id').eq('id', contractId).maybeSingle();
    if (cErr || !c) return out;
    out.exists = true;
    out.clientId = String((c as { client_id: string }).client_id);
    const { data: cl } = await supabase.from(CONTRACT_CLIENTS_TABLE).select('id, name').eq('id', out.clientId).maybeSingle();
    if (cl) out.clientName = String((cl as { name: string }).name ?? '');
  } catch (err) {
    console.error('[contracts/secrets] 기록용 거래처 확인 실패:', (err as Error)?.message);
  }
  return out;
}

// ── 요청 정보(IP·기기) ───────────────────────────────────────────────

function shortDevice(ua: string): string {
  if (!ua) return '';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : '기타';
  const browser = /KAKAOTALK/i.test(ua)
    ? '카카오톡'
    : /SamsungBrowser/.test(ua)
      ? '삼성 인터넷'
      : /Edg(A|iOS)?\//.test(ua)
        ? 'Edge'
        : /Whale\//.test(ua)
          ? '웨일'
          : /CriOS|Chrome\//.test(ua)
            ? 'Chrome'
            : /FxiOS|Firefox\//.test(ua)
              ? 'Firefox'
              : /Safari\//.test(ua)
                ? 'Safari'
                : '';
  return (browser ? `${os} · ${browser}` : os).slice(0, 60);
}

async function requestMeta(ipKey: Buffer | null): Promise<{ ipHash: string; ua: string }> {
  let ip = '';
  let ua = '';
  try {
    const h = await headers();
    ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
    ua = h.get('user-agent') ?? '';
  } catch {
    // 요청 밖(빌드 등) — IP·기기 없이
  }
  return { ipHash: ipKey ? ipHashWith(ipKey, ip) : '', ua: shortDevice(ua) };
}

// ── 잠금 해제 쿠키 ────────────────────────────────────────────────────

async function readCookieToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(UNLOCK_COOKIE)?.value || null;
}

function sessionFrom(auth: Auth, token: string | null): { name: string; exp: number } | null {
  if (!token || !auth.hashStored || !auth.hash) return null;
  return verifyUnlockToken(auth.cookieKey, token, { now: Date.now(), pw: auth.pwFingerprint, maxTtlMs: UNLOCK_TTL_MS });
}

/** 열려 있으면 { name }(열 때 적은 이름 — 안 적었으면 ''), 아니면 UnlockRequired. 설정을 못 읽으면 일반 Error */
export async function requireUnlock(): Promise<{ name: string }> {
  const token = await readCookieToken();
  if (!token) throw new UnlockRequired(); // 쿠키가 없으면 DB 안 읽음
  const session = sessionFrom(await loadAuth(), token);
  if (!session) throw new UnlockRequired();
  return { name: session.name };
}

/** 열려 있는지만(던지지 않음 — 못 읽으면 false) */
export async function isUnlocked(): Promise<boolean> {
  try {
    await requireUnlock();
    return true;
  } catch (err) {
    if (!(err instanceof UnlockRequired)) console.error('[contracts/secrets] 잠금 상태 확인 실패:', (err as Error)?.message);
    return false;
  }
}

/** 서버 액션 안에서만 — httpOnly · Secure(운영) · SameSite=Strict · Path=/ · UNLOCK_HOURS, 연장 없음 */
async function issueUnlockCookie(auth: Pick<Auth, 'cookieKey'>, hashStored: string, name: string): Promise<{ expiresAt: string }> {
  const exp = Date.now() + UNLOCK_TTL_MS;
  const token = signUnlockToken(auth.cookieKey, { name, exp, pw: passwordHashFingerprint(hashStored) });
  const store = await cookies();
  store.set({
    name: UNLOCK_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });
  return { expiresAt: new Date(exp).toISOString() };
}

/** 서버 액션 안에서만 — 쿠키 지우기 */
export async function clearUnlockCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: UNLOCK_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

// ── 틀린 시도 제한 (기록 표 기반) ─────────────────────────────────────

type Lockout = { ipFails: number; allFails: number; lockedUntil: string | null; scope: 'ip' | 'all' | null };

/**
 * 최근 30분의 틀린 시도 시각만 작게 읽어(상한 500줄) 계산 — 같은 기기 15분 안 5회 / 전체 15분 안 30회 → 그때부터 15분 잠금.
 * 읽기 실패는 던짐(부르는 쪽이 "잠시 열 수 없음"으로 — 셀 수 없으면 열지 않음).
 */
async function readLockout(supabase: SupabaseClient, ipHash: string, now: number): Promise<Lockout> {
  const since = new Date(now - 2 * FAIL_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from(CONTRACT_SECRET_LOG_TABLE)
    .select('at, ip_hash')
    .eq('action', 'unlock_fail')
    .gte('at', since)
    .order('at', { ascending: false })
    .limit(500);
  if (error) throw dbError('틀린 시도 기록을 못 읽었어요', error);
  const rows = (data ?? []) as { at: string; ip_hash: string }[];
  const all = rows.map((r) => Date.parse(r.at)).filter((t) => Number.isFinite(t));
  const mine = rows.filter((r) => r.ip_hash === ipHash).map((r) => Date.parse(r.at)).filter((t) => Number.isFinite(t));
  const recent = (ts: number[]) => ts.filter((t) => t > now - FAIL_WINDOW_MS).length;
  const ipUntil = lockoutUntil(mine, now, IP_FAIL_MAX, FAIL_WINDOW_MS);
  const allUntil = lockoutUntil(all, now, ALL_FAIL_MAX, FAIL_WINDOW_MS);
  const until = Math.max(ipUntil ?? 0, allUntil ?? 0);
  return {
    ipFails: recent(mine),
    allFails: recent(all),
    lockedUntil: until > 0 ? new Date(until).toISOString() : null,
    scope: until === 0 ? null : allUntil !== null && allUntil >= (ipUntil ?? 0) ? 'all' : 'ip',
  };
}

function lockedMessage(scope: Lockout['scope']): string {
  return scope === 'all'
    ? '틀린 비밀번호가 너무 많이 들어와 잠시 모든 기기에서 잠겼어요. 15분 뒤에 다시 해 주세요.'
    : '틀린 비밀번호가 여러 번 들어와 이 기기는 15분 동안 잠겼어요.';
}

function remainingOf(l: Lockout): number {
  return Math.max(0, Math.min(IP_FAIL_MAX - l.ipFails, ALL_FAIL_MAX - l.allFails));
}

/** 지금 잠금 상태(화면 첫 표시용). 설정을 못 읽으면 던짐 — 액션이 기본값으로 바꿈 */
export async function readUnlockState(): Promise<UnlockState> {
  const token = await readCookieToken();
  const auth = await loadAuth();
  const session = sessionFrom(auth, token);
  if (session) {
    return { passwordSet: true, unlocked: true, expiresAt: new Date(session.exp).toISOString(), lockedUntil: null };
  }
  let lockedUntil: string | null = null;
  if (auth.hashStored) {
    try {
      const { ipHash } = await requestMeta(auth.ipKey);
      lockedUntil = (await readLockout(auth.supabase, ipHash, Date.now())).lockedUntil;
    } catch (err) {
      console.error('[contracts/secrets] 잠금 상태 확인 실패:', (err as Error)?.message);
    }
  }
  return { passwordSet: auth.hashStored !== null, unlocked: false, expiresAt: null, lockedUntil };
}

export type UnlockAttempt =
  | { ok: true; name: string; expiresAt: string }
  | { ok: false; error: string; remaining?: number; lockedUntil?: string | null };

/**
 * 비밀번호 확인 → 맞으면 잠금 해제 쿠키(서버 액션 안에서만 부를 것).
 * 동시에 여러 번 보내 제한을 피하지 못하게, 계산 전에 "틀림"으로 먼저 적고 다시 센 뒤 계산 → 맞으면 그 줄을 unlock_ok 로 바꿈.
 */
export async function attemptUnlock(password: string, name: string): Promise<UnlockAttempt> {
  let auth: Auth;
  try {
    auth = await loadAuth();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!auth.hashStored) return { ok: false, error: '아직 비밀번호를 정하지 않았어요. 먼저 비밀번호를 정해 주세요.' };
  if (!auth.hash) return { ok: false, error: DAMAGED_HASH_MSG };
  const { supabase } = auth;
  const { ipHash, ua } = await requestMeta(auth.ipKey);

  let before: Lockout;
  try {
    before = await readLockout(supabase, ipHash, Date.now());
  } catch (err) {
    return { ok: false, error: `${(err as Error).message} — 잠시 뒤 다시 해 주세요.` };
  }
  if (before.lockedUntil) return { ok: false, error: lockedMessage(before.scope), remaining: 0, lockedUntil: before.lockedUntil };

  const { data: attempt, error: insErr } = await supabase
    .from(CONTRACT_SECRET_LOG_TABLE)
    .insert({ action: 'unlock_fail', actor: name, ip_hash: ipHash, ua, note: '확인 중' })
    .select('id')
    .single();
  if (insErr || !attempt) {
    return { ok: false, error: `${dbError('시도 기록을 못 남겼어요', insErr).message} — 기록이 안 되면 열 수 없어요.` };
  }
  const attemptId = (attempt as { id: number }).id;

  let after: Lockout;
  try {
    after = await readLockout(supabase, ipHash, Date.now());
  } catch (err) {
    return { ok: false, error: `${(err as Error).message} — 잠시 뒤 다시 해 주세요.` };
  }
  // 방금 적은 시도까지 세어 한도를 넘으면(동시에 여러 번 보낸 경우) 계산하지 않음
  if (after.ipFails > IP_FAIL_MAX || after.allFails > ALL_FAIL_MAX) {
    await supabase.from(CONTRACT_SECRET_LOG_TABLE).update({ note: '한도 넘음 — 확인 안 함' }).eq('id', attemptId);
    const scope = after.allFails > ALL_FAIL_MAX ? 'all' : 'ip';
    return { ok: false, error: lockedMessage(scope), remaining: 0, lockedUntil: after.lockedUntil };
  }

  const ok = await checkPassword(auth.hash, password);
  if (!ok) {
    const { error: upErr } = await supabase.from(CONTRACT_SECRET_LOG_TABLE).update({ note: '' }).eq('id', attemptId);
    if (upErr) console.error('[contracts/secrets] 틀린 시도 기록 정리 실패:', upErr.code, upErr.message);
    if (after.lockedUntil) {
      return { ok: false, error: `비밀번호가 맞지 않아요. ${lockedMessage(after.scope)}`, remaining: 0, lockedUntil: after.lockedUntil };
    }
    const remaining = remainingOf(after);
    return { ok: false, error: `비밀번호가 맞지 않아요. (남은 시도 ${remaining}회)`, remaining, lockedUntil: null };
  }

  const { error: okErr } = await supabase.from(CONTRACT_SECRET_LOG_TABLE).update({ action: 'unlock_ok', note: '' }).eq('id', attemptId);
  if (okErr) console.error('[contracts/secrets] 잠금 해제 기록 실패:', okErr.code, okErr.message);
  const { expiresAt } = await issueUnlockCookie(auth, auth.hashStored, name);
  return { ok: true, name, expiresAt };
}

/**
 * 처음 비밀번호 정하기 — settings 에 해시가 없을 때만. 동시에 두 곳에서 정하면 먼저 들어간 것만(on conflict do nothing).
 * 성공하면 이 기기는 바로 열림 + 기록(unlock_ok, '처음 정함'). 서버 액션 안에서만.
 */
export async function setInitialPassword(password: string, name: string): Promise<UnlockAttempt> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  let auth: Auth;
  try {
    auth = await loadAuth();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (auth.hashStored) return { ok: false, error: '비밀번호가 이미 정해져 있어요. 그 비밀번호로 열어 주세요.' };
  const hashStored = await makePasswordHash(password);
  const { data, error } = await auth.supabase
    .from(CONTRACT_SETTINGS_TABLE)
    .upsert({ key: PASSWORD_SETTING, value: hashStored, updated_by: name.slice(0, 40) }, { onConflict: 'key', ignoreDuplicates: true })
    .select('key');
  if (error) return { ok: false, error: dbError('비밀번호를 저장하지 못했어요', error).message };
  if ((data ?? []).length === 0) return { ok: false, error: '방금 다른 곳에서 비밀번호를 정했어요. 그 비밀번호로 열어 주세요.' };
  const { expiresAt } = await issueUnlockCookie(auth, hashStored, name);
  const { ipHash, ua } = await requestMeta(auth.ipKey);
  await insertLog(auth.supabase, ipHash, ua, { action: 'unlock_ok', actor: name, note: '처음 정함' });
  return { ok: true, name, expiresAt };
}

/**
 * 비밀번호 바꾸기 — 열려 있어야 하고 지금 비밀번호도 맞아야 함(틀리면 틀린 시도로 셈).
 * 해시가 바뀌면 지문이 달라져 다른 기기의 쿠키는 모두 무효, 이 기기는 새 쿠키로 계속 열림. 서버 액션 안에서만.
 */
export async function replacePassword(current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await readCookieToken();
  const auth = await loadAuth();
  const session = sessionFrom(auth, token);
  if (!session) throw new UnlockRequired();
  if (!auth.hashStored || !auth.hash) return { ok: false, error: DAMAGED_HASH_MSG };
  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem };
  if (typeof current !== 'string' || current.length === 0) return { ok: false, error: '지금 비밀번호를 넣어 주세요.' };
  if (current.length > PASSWORD_MAX_LENGTH) return { ok: false, error: '지금 비밀번호가 맞지 않아요.' };
  if (current === next) return { ok: false, error: '지금과 같은 비밀번호예요. 다른 비밀번호로 정해 주세요.' };

  const { supabase } = auth;
  const { ipHash, ua } = await requestMeta(auth.ipKey);
  const before = await readLockout(supabase, ipHash, Date.now());
  if (before.lockedUntil) return { ok: false, error: lockedMessage(before.scope) };

  if (!(await checkPassword(auth.hash, current))) {
    const { error: insErr } = await supabase
      .from(CONTRACT_SECRET_LOG_TABLE)
      .insert({ action: 'unlock_fail', actor: session.name, ip_hash: ipHash, ua, note: '비밀번호 바꾸기 — 지금 비밀번호 틀림' });
    if (insErr) console.error('[contracts/secrets] 틀린 시도 기록 실패:', insErr.code, insErr.message);
    const after = await readLockout(supabase, ipHash, Date.now());
    return {
      ok: false,
      error: after.lockedUntil
        ? `지금 비밀번호가 맞지 않아요. ${lockedMessage(after.scope)}`
        : `지금 비밀번호가 맞지 않아요. (남은 시도 ${remainingOf(after)}회)`,
    };
  }

  const newStored = await makePasswordHash(next);
  // 읽은 해시 그대로일 때만 바꿈 — 그 사이 다른 곳에서 바꿨으면 덮지 않음
  const { data, error } = await supabase
    .from(CONTRACT_SETTINGS_TABLE)
    .update({ value: newStored, updated_by: session.name.slice(0, 40) })
    .eq('key', PASSWORD_SETTING)
    .eq('value', auth.hashStored)
    .select('key');
  if (error) return { ok: false, error: dbError('비밀번호를 바꾸지 못했어요', error).message };
  if ((data ?? []).length === 0) return { ok: false, error: '방금 다른 곳에서 비밀번호가 바뀌었어요. 새 비밀번호로 다시 열어 주세요.' };
  await issueUnlockCookie(auth, newStored, session.name);
  await insertLog(supabase, ipHash, ua, { action: 'edit', actor: session.name, note: '비밀번호 바꿈' });
  return { ok: true };
}

// ── 기록 ─────────────────────────────────────────────────────────────

type LogEvent = {
  action: string;
  actor: string;
  clientId?: string;
  contractId?: string;
  seatId?: string;
  clientName?: string;
  field?: string;
  count?: number;
  note?: string;
};

async function insertLog(supabase: SupabaseClient, ipHash: string, ua: string, e: LogEvent): Promise<void> {
  if (!(LOG_ACTIONS as readonly string[]).includes(e.action)) {
    console.error('[contracts/secrets] 모르는 기록 종류:', e.action);
    return;
  }
  const uuidOrNull = (v?: string) => (v && UUID_RE.test(v) ? v.toLowerCase() : null);
  const { error } = await supabase.from(CONTRACT_SECRET_LOG_TABLE).insert({
    action: e.action,
    actor: (e.actor ?? '').slice(0, 40),
    client_id: uuidOrNull(e.clientId),
    contract_id: uuidOrNull(e.contractId),
    seat_id: uuidOrNull(e.seatId),
    client_name: (e.clientName ?? '').slice(0, 120),
    field: (e.field ?? '').slice(0, 40),
    // DB 칸 이름은 event_count(PostgREST count() 집계와 헷갈리지 않게) — 인자 이름은 §3-7 대로 count
    event_count: Number.isSafeInteger(e.count) && (e.count as number) >= 0 ? e.count : 1,
    ip_hash: ipHash,
    ua,
    note: (e.note ?? '').slice(0, 300),
  });
  if (error) console.error('[contracts/secrets] 기록 실패:', error.code, error.message);
}

/** 잠금 해제·비밀 칸 수정·인증 기록 — 값은 절대 안 적음. 실패해도 던지지 않음(서버 로그에만) */
export async function logSecretEvent(e: LogEvent): Promise<void> {
  try {
    let ipKey: Buffer | null = null;
    try {
      ipKey = (await loadAuth()).ipKey;
    } catch {
      // 설정을 못 읽어도 기록은 남김(IP 해시만 빈 값)
    }
    const { ipHash, ua } = await requestMeta(ipKey);
    await insertLog(createAdminClient(), ipHash, ua, e);
  } catch (err) {
    console.error('[contracts/secrets] 기록 실패:', (err as Error)?.message);
  }
}

/** 기록 화면 — 최근 limit 건(최대 500) + 최근 24시간 틀린 시도 수(count head) */
export async function readSecretLog(limit: number): Promise<{ rows: SecretLogRow[]; failed24h: number }> {
  const n = Math.min(500, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 200)));
  const supabase = createAdminClient();
  const [list, failed] = await Promise.all([
    supabase
      .from(CONTRACT_SECRET_LOG_TABLE)
      .select('at, action, actor, client_name, field, event_count, ua, note')
      .order('at', { ascending: false })
      .limit(n),
    supabase
      .from(CONTRACT_SECRET_LOG_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('action', 'unlock_fail')
      .gte('at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (list.error) throw dbError('기록을 못 읽었어요', list.error);
  if (failed.error) throw dbError('틀린 시도 수를 못 셌어요', failed.error);
  const rows = ((list.data ?? []) as {
    at: string;
    action: string;
    actor: string;
    client_name: string;
    field: string;
    event_count: number;
    ua: string;
    note: string;
  }[]).map((r) => ({
    at: r.at,
    action: r.action,
    actor: r.actor ?? '',
    clientName: r.client_name ?? '',
    field: r.field ?? '',
    count: r.event_count ?? 1,
    ua: r.ua ?? '',
    note: r.note ?? '',
  }));
  return { rows, failed24h: failed.count ?? 0 };
}

// ── 비밀 칸 읽기 ─────────────────────────────────────────────────────

type SecretRow = { owner: string; field: SecretField; value: string };

/** 주인 id 들(200개씩) × 각 묶음 1000줄씩 끝까지(1000줄 한도). withValue=false 면 값 칸은 아예 안 읽음 */
async function readSecretRows(
  supabase: SupabaseClient,
  column: 'contract_id' | 'seat_id',
  ids: string[],
  withValue: boolean,
): Promise<SecretRow[]> {
  const out: SecretRow[] = [];
  const parts = chunk(uniqueUuids(ids), ID_CHUNK);
  const cols = withValue ? `id, ${column}, field, value_text` : `id, ${column}, field`;
  // 한 번에 4묶음씩
  for (const batch of chunk(parts, 4)) {
    const results = await Promise.all(
      batch.map(async (part) => {
        const rows: SecretRow[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from(CONTRACT_SECRETS_TABLE)
            .select(cols)
            .in(column, part)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw dbError('비밀 칸을 못 읽었어요', error);
          const page = (data ?? []) as unknown as Record<string, string>[];
          for (const r of page) {
            if (!isSecretField(r.field)) continue;
            rows.push({ owner: String(r[column]).toLowerCase(), field: r.field, value: withValue ? String(r.value_text ?? '') : '' });
          }
          if (page.length < PAGE) break;
        }
        return rows;
      }),
    );
    for (const rows of results) out.push(...rows);
  }
  return out;
}

/** 어느 칸에 비밀이 있는지만(값 없음) — 주인 id → 칸 목록. 잠금 해제 필요 없음 */
export async function secretFlags(ids: { contractIds: string[]; seatIds: string[] }): Promise<Map<string, SecretField[]>> {
  const supabase = createAdminClient();
  const [contractRows, seatRows] = await Promise.all([
    readSecretRows(supabase, 'contract_id', ids.contractIds ?? [], false),
    readSecretRows(supabase, 'seat_id', ids.seatIds ?? [], false),
  ]);
  const found = new Map<string, Set<SecretField>>();
  for (const { owner, field } of [...contractRows, ...seatRows]) {
    const set = found.get(owner) ?? new Set<SecretField>();
    set.add(field);
    found.set(owner, set);
  }
  const out = new Map<string, SecretField[]>();
  for (const [owner, set] of found) out.set(owner, SECRET_FIELDS.filter((f) => set.has(f)));
  return out;
}

/**
 * 잠금 해제 상태에서 비밀 값까지 — 상세 화면(getClientDetail)용. 먼저 requireUnlock(아니면 UnlockRequired).
 * 빈 칸은 키 없음. 주인 id 는 소문자.
 */
export async function readSecretsForOwners(ids: {
  contractIds: string[];
  seatIds: string[];
}): Promise<{ contract: Map<string, Partial<Record<SecretField, string>>>; seat: Map<string, Partial<Record<SecretField, string>>> }> {
  await requireUnlock();
  const supabase = createAdminClient();
  const [contractRows, seatRows] = await Promise.all([
    readSecretRows(supabase, 'contract_id', ids.contractIds ?? [], true),
    readSecretRows(supabase, 'seat_id', ids.seatIds ?? [], true),
  ]);
  const toMap = (rows: SecretRow[]) => {
    const m = new Map<string, Partial<Record<SecretField, string>>>();
    for (const r of rows) {
      if (r.value === '') continue;
      const rec = m.get(r.owner) ?? {};
      rec[r.field] = r.value;
      m.set(r.owner, rec);
    }
    return m;
  };
  return { contract: toMap(contractRows), seat: toMap(seatRows) };
}

// ── 시트 옮기기용 (값은 돌려주지 않음) ─────────────────────────────────

/**
 * 칸마다 그대로 넣되, 이미 있는 칸((좌석|상품), field)은 건드리지 않음(ON CONFLICT DO NOTHING).
 * 빈 문자열은 넣지 않고 셈에서도 빠짐. 같은 칸이 두 번 오면 처음 것만 넣고 나머지는 existing 으로 셈.
 * 부르는 액션이 requireUnlock 을 먼저 할 것. 모양이 틀린 입력·DB 오류는 던짐.
 */
export async function insertSecretsIfMissing(
  rows: { contractId?: string; seatId?: string; field: SecretField; plain: string }[],
  actor: string,
): Promise<{ inserted: number; existing: number }> {
  const supabase = createAdminClient();
  const by: Record<'contract_id' | 'seat_id', Map<string, { owner: ParsedOwner; field: SecretField; plain: string }>> = {
    contract_id: new Map(),
    seat_id: new Map(),
  };
  let existing = 0;
  for (const r of rows) {
    const owner = parseSecretOwner(r.contractId !== undefined ? { contractId: r.contractId } : { seatId: r.seatId });
    if (!owner) throw new Error('비밀 칸의 주인(상품·좌석) id 모양이 틀렸어요.');
    if (!isSecretField(r.field)) throw new Error('알 수 없는 비밀 칸 종류예요.');
    if (typeof r.plain !== 'string') throw new Error('비밀 값이 글자가 아니에요.');
    if (r.plain === '') continue;
    if (r.plain.length > MAX_SECRET_LENGTH) throw new Error(`비밀 값이 너무 길어요(${MAX_SECRET_LENGTH}자까지).`);
    const k = `${owner.id}:${r.field}`;
    if (by[owner.column].has(k)) {
      existing++;
      continue;
    }
    by[owner.column].set(k, { owner, field: r.field, plain: r.plain });
  }
  const who = (actor ?? '').slice(0, 40);
  let inserted = 0;
  // 좌석 비밀과 계약 비밀은 onConflict 대상이 달라 한 요청에 섞지 않음
  for (const column of ['contract_id', 'seat_id'] as const) {
    const items = [...by[column].values()];
    for (const part of chunk(items, ID_CHUNK)) {
      const payload = part.map((i) => ({ [column]: i.owner.id, field: i.field, value_text: i.plain, updated_by: who }));
      const { data, error } = await supabase
        .from(CONTRACT_SECRETS_TABLE)
        .upsert(payload, { onConflict: `${column},field`, ignoreDuplicates: true })
        .select('id');
      if (error) throw dbError('비밀 칸을 저장하지 못했어요', error);
      const n = (data ?? []).length;
      inserted += n;
      existing += part.length - n;
    }
  }
  return { inserted, existing };
}

/** DB 에서 다시 읽어 저장값이 시트 값과 같은지(서버 메모리 안에서만 비교 — 값은 안 돌려줌) */
export async function verifySecrets(
  rows: { seatId: string; field: SecretField; plain: string }[],
): Promise<{ verified: number; mismatched: { seatId: string; field: SecretField }[] }> {
  const supabase = createAdminClient();
  const stored = new Map<string, string>();
  for (const r of await readSecretRows(supabase, 'seat_id', rows.map((x) => x.seatId), true)) {
    stored.set(`${r.owner}:${r.field}`, r.value);
  }
  let verified = 0;
  const mismatched: { seatId: string; field: SecretField }[] = [];
  for (const r of rows) {
    const id = typeof r.seatId === 'string' ? r.seatId.toLowerCase() : '';
    const value = UUID_RE.test(id) && isSecretField(r.field) ? stored.get(`${id}:${r.field}`) : undefined;
    if (value !== undefined && typeof r.plain === 'string' && value === r.plain) verified++;
    else mismatched.push({ seatId: r.seatId, field: r.field });
  }
  return { verified, mismatched };
}

// ── 쓰기 (잠금 해제 상태에서만 — 안에서도 다시 확인) ────────────────────

/**
 * 비밀 한 칸 저장(빈 값·공백뿐 = 삭제). 'saved' / 'deleted' / 'nothing'(지울 게 없었음).
 * 주인(상품·좌석)이 없으면 FK 오류로 실패.
 */
export async function writeSecret(owner: ParsedOwner, field: SecretField, value: string, actor: string): Promise<'saved' | 'deleted' | 'nothing'> {
  await requireUnlock();
  if (typeof value !== 'string') throw new Error('비밀 값이 글자가 아니에요.');
  if (value.length > MAX_SECRET_LENGTH) throw new Error(`비밀 값이 너무 길어요(${MAX_SECRET_LENGTH}자까지).`);
  const supabase = createAdminClient();
  if (value.trim() === '') {
    const { data, error } = await supabase
      .from(CONTRACT_SECRETS_TABLE)
      .delete()
      .eq(owner.column, owner.id)
      .eq('field', field)
      .select('id');
    if (error) throw dbError('비밀 칸을 지우지 못했어요', error);
    return (data ?? []).length > 0 ? 'deleted' : 'nothing';
  }
  const { error } = await supabase
    .from(CONTRACT_SECRETS_TABLE)
    .upsert({ [owner.column]: owner.id, field, value_text: value, updated_by: (actor ?? '').slice(0, 40) }, { onConflict: `${owner.column},field` });
  if (error) {
    if (error.code === '23503') throw new Error('그 계약 상품·좌석이 없어요(지워졌을 수 있어요). 화면을 새로 고쳐 주세요.');
    throw dbError('비밀 칸을 저장하지 못했어요', error);
  }
  return 'saved';
}

/** 좌석에 든 비밀 칸 수(count head) */
export async function countSeatSecrets(seatId: string): Promise<number> {
  const owner = parseSecretOwner({ seatId });
  if (!owner) throw new Error('좌석 id 모양이 틀렸어요.');
  const { count, error } = await createAdminClient()
    .from(CONTRACT_SECRETS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('seat_id', owner.id);
  if (error) throw dbError('좌석의 비밀 칸을 못 셌어요', error);
  return count ?? 0;
}

/** 여러 좌석 한꺼번에 지울 때 한 번에 받는 최대 개수 */
export const SEAT_DELETE_MAX = 500;

/** 화면에서 온 좌석 id 목록 정리 — uuid 모양만, 소문자, 중복 제거. 1~max 개가 아니면 문구 */
export function cleanSeatIds(ids: unknown, max: number = SEAT_DELETE_MAX): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(ids)) return { ok: false, error: '지울 좌석 목록이 올바르지 않아요. 화면을 새로 고쳐 주세요.' };
  const out = uniqueUuids(ids.filter((x): x is string => typeof x === 'string'));
  if (out.length === 0) return { ok: false, error: '지울 좌석을 골라 주세요.' };
  if (out.length > max) return { ok: false, error: `한 번에 ${max}개까지 지울 수 있어요(고른 좌석 ${out.length}개).` };
  return { ok: true, ids: out };
}

/**
 * 여러 좌석 삭제(비밀 칸은 FK cascade 로 같이) — 200개씩 .in('id', …). 없는 id 는 무시.
 * 지우기 전에 좌석별 비밀 칸 수만 셈(값은 안 읽음). 지운 좌석의 계약 상품 id 들도 돌려줌(기록용).
 * 첫 묶음에서 실패하면 던지고, 중간에 멈추면 그때까지 지운 수 + error 로 돌려줌(부르는 쪽이 지운 만큼 기록).
 */
export async function deleteSeatRows(
  ids: string[],
): Promise<{ deleted: number; secretCount: number; contractIds: string[]; error: string | null }> {
  const seatIds = uniqueUuids(ids);
  const supabase = createAdminClient();

  // 지울 좌석이 어느 상품 것인지(기록용) — 200개씩이라 1000줄 한도 안
  const contractOf = new Map<string, string>();
  for (const part of chunk(seatIds, ID_CHUNK)) {
    const { data, error } = await supabase.from(SW_SEATS_TABLE).select('id, contract_id').in('id', part);
    if (error) throw dbError('지울 좌석을 못 읽었어요', error);
    for (const r of (data ?? []) as { id: string; contract_id: string }[]) contractOf.set(String(r.id).toLowerCase(), String(r.contract_id));
  }
  const existing = seatIds.filter((id) => contractOf.has(id));
  if (existing.length === 0) return { deleted: 0, secretCount: 0, contractIds: [], error: null };

  // 좌석별 비밀 칸 수(값 칸은 안 읽음)
  const secretsPerSeat = new Map<string, number>();
  for (const r of await readSecretRows(supabase, 'seat_id', existing, false)) {
    secretsPerSeat.set(r.owner, (secretsPerSeat.get(r.owner) ?? 0) + 1);
  }

  const deletedIds: string[] = [];
  let stopped: string | null = null;
  for (const part of chunk(existing, ID_CHUNK)) {
    const { data, error } = await supabase.from(SW_SEATS_TABLE).delete().in('id', part).select('id');
    if (error) {
      // restrict FK 는 23001, 일반 FK 는 23503 — 다른 기록이 좌석을 가리킴
      const why =
        error.code === '23001' || error.code === '23503'
          ? '다른 기록이 이 좌석들을 쓰고 있어 지울 수 없어요.'
          : dbError('좌석을 지우지 못했어요', error).message;
      if (deletedIds.length === 0) throw new Error(why);
      stopped = `좌석 ${deletedIds.length}개를 지운 뒤 멈췄어요 — ${why}`;
      break;
    }
    for (const r of (data ?? []) as { id: string }[]) deletedIds.push(String(r.id).toLowerCase());
  }
  const contractIds = [...new Set(deletedIds.map((id) => contractOf.get(id)).filter((v): v is string => Boolean(v)))];
  const secretCount = deletedIds.reduce((n, id) => n + (secretsPerSeat.get(id) ?? 0), 0);
  return { deleted: deletedIds.length, secretCount, contractIds, error: stopped };
}

/** 좌석 한 줄 삭제(비밀 칸은 FK cascade 로 같이). 지운 줄이 있으면 true */
export async function deleteSeatRow(seatId: string): Promise<boolean> {
  const owner = parseSecretOwner({ seatId });
  if (!owner) throw new Error('좌석 id 모양이 틀렸어요.');
  const { data, error } = await createAdminClient().from(SW_SEATS_TABLE).delete().eq('id', owner.id).select('id');
  if (error) {
    // restrict FK 는 23001, 일반 FK 는 23503 — 다른 기록이 이 좌석을 가리킴
    if (error.code === '23001' || error.code === '23503') throw new Error('다른 기록이 이 좌석을 쓰고 있어 지울 수 없어요.');
    throw dbError('좌석을 지우지 못했어요', error);
  }
  return (data ?? []).length > 0;
}
