import 'server-only';
import { cookies, headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONTRACT_CLIENTS_TABLE,
  CONTRACT_SECRET_LOG_TABLE,
  CONTRACT_SECRETS_TABLE,
  SW_CONTRACTS_TABLE,
  SW_SEATS_TABLE,
  createAdminClient,
} from '@/lib/supabase/server';
import { SECRET_FIELDS, type SecretField, type SecretLogRow, type SecretOwner } from '@/lib/contracts/types';
import {
  SecretOpenError,
  checkPassword,
  contractEnvStatus,
  ipHashWith,
  lockoutUntil,
  openWithKey,
  readContractKeys,
  sealWithKey,
  secretAad,
  signUnlockToken,
  verifyUnlockToken,
  type ContractKeys,
  type SecretOwnerKind,
} from '@/lib/contracts/crypto';

/**
 * 계약 관리 비밀 칸 — 암호문 표(it_contract_secrets)를 읽고 쓰는 **유일한** 파일.
 * 설계 docs/tasks/2026-11-20-contract-management.md §3-4·§3-7.
 * - 평문 비밀·열쇠·비밀번호는 console·오류 문구·기록 표 어디에도 싣지 않는다.
 * - 평문을 돌려주는 함수(readSecretPlain·readContractSecretsPlain)와 비밀 쓰기(writeSecret)는 안에서도 열람 쿠키를 다시 확인한다.
 * - insertSecretsIfMissing·verifySecrets 는 시트 옮기기용 — 부르는 액션이 requireUnlock 을 먼저 한다(값은 돌려주지 않음).
 */

export const UNLOCK_COOKIE = 'it_ct_unlock';
/** 열람 유지 시간(D8) — 연장 없음 */
export const UNLOCK_TTL_MS = 10 * 60 * 1000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const IP_FAIL_MAX = 5;
const ALL_FAIL_MAX = 30;
const ID_CHUNK = 200;
const PAGE = 1000;
const MAX_SECRET_LENGTH = 4000;
const NOT_CONFIGURED_MSG =
  '비밀 칸 기능이 아직 설정 전이에요. /contracts/setup 에서 열쇠와 비밀번호를 만들어 Vercel 에 넣고 다시 배포해 주세요.';
const MISSING_TABLE_MSG = '계약 관리 표가 아직 없어요. supabase/contracts_schema.sql 을 Supabase SQL Editor 에서 먼저 실행해 주세요.';
const LOG_ACTIONS = ['unlock_ok', 'unlock_fail', 'lock', 'view', 'view_bulk', 'edit', 'delete', 'import'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 열람 쿠키가 없거나 만료·무효 — 액션은 { ok:false, needUnlock:true } 로 바꿔 돌려줌 */
export class UnlockRequired extends Error {
  constructor(message = '인증 비밀번호를 먼저 넣어 주세요(10분 동안 열람할 수 있어요).') {
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

/** DB 오류 → 사람이 읽을 문구(오류 문구엔 값이 없음 — details 는 행 내용이 들어갈 수 있어 안 씀) */
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

function requireKeys(): ContractKeys {
  const keys = readContractKeys();
  if (!keys) throw new Error(NOT_CONFIGURED_MSG);
  return keys;
}

// ── 설정 상태 ────────────────────────────────────────────────────────

/** 열쇠·비밀번호 해시 환경변수가 둘 다 쓸 수 있는 모양이면 true. 아니면 비밀 액션은 모두 거절(목록 화면은 그대로) */
export function secretsConfigured(): boolean {
  return readContractKeys() !== null;
}

/** 설정 화면용 — 어느 쪽이 들어가 있는지만(값은 안 돌려줌) */
export function secretsConfigDetail(): { key: boolean; passwordHash: boolean } {
  return contractEnvStatus();
}

export function secretsNotConfiguredMessage(): string {
  return NOT_CONFIGURED_MSG;
}

// ── 소유자(계약 상품 / 좌석) ──────────────────────────────────────────

export type ParsedOwner = { kind: SecretOwnerKind; id: string; column: 'contract_id' | 'seat_id' };

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

function ownerOf(p: ParsedOwner): SecretOwner {
  return p.kind === 'contract' ? { contractId: p.id } : { seatId: p.id };
}

/** 기록용 — 그 칸이 어느 상품·거래처 것인지. 못 읽으면 아는 데까지만(기록이 보기를 막지 않게) */
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

async function requestMeta(keys: ContractKeys | null): Promise<{ ipHash: string; ua: string }> {
  let ip = '';
  let ua = '';
  try {
    const h = await headers();
    ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
    ua = h.get('user-agent') ?? '';
  } catch {
    // 요청 밖(빌드 등) — IP·기기 없이
  }
  return { ipHash: keys ? ipHashWith(keys.ipKey, ip) : '', ua: shortDevice(ua) };
}

// ── 열람 쿠키 ────────────────────────────────────────────────────────

async function readSession(keys: ContractKeys): Promise<{ name: string; exp: number } | null> {
  const store = await cookies();
  const token = store.get(UNLOCK_COOKIE)?.value;
  if (!token) return null;
  return verifyUnlockToken(keys.cookieKey, token, { now: Date.now(), pw: keys.pwFingerprint, maxTtlMs: UNLOCK_TTL_MS });
}

/** 열람 중이면 { name }(열 때 적은 이름), 아니면 UnlockRequired. 설정 전이면 일반 Error */
export async function requireUnlock(): Promise<{ name: string }> {
  const keys = requireKeys();
  const session = await readSession(keys);
  if (!session) throw new UnlockRequired();
  return { name: session.name };
}

/** 지금 열람 상태(던지지 않음 — 설정 전이면 null) */
export async function currentUnlock(): Promise<{ name: string; expiresAt: string } | null> {
  const keys = readContractKeys();
  if (!keys) return null;
  try {
    const session = await readSession(keys);
    return session ? { name: session.name, expiresAt: new Date(session.exp).toISOString() } : null;
  } catch {
    return null;
  }
}

/** 서버 액션 안에서만 — httpOnly · Secure(운영) · SameSite=Strict · Path=/ · 10분, 연장 없음 */
async function issueUnlockCookie(keys: ContractKeys, name: string): Promise<{ expiresAt: string }> {
  const exp = Date.now() + UNLOCK_TTL_MS;
  const token = signUnlockToken(keys.cookieKey, { name, exp, pw: keys.pwFingerprint });
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

/** 이 기기의 잠금 끝 시각(열람 상태 표시용 — 못 읽으면 null) */
export async function currentLockedUntil(): Promise<string | null> {
  const keys = readContractKeys();
  if (!keys) return null;
  try {
    const { ipHash } = await requestMeta(keys);
    return (await readLockout(createAdminClient(), ipHash, Date.now())).lockedUntil;
  } catch (err) {
    console.error('[contracts/secrets] 잠금 상태 확인 실패:', (err as Error)?.message);
    return null;
  }
}

function lockedMessage(scope: Lockout['scope']): string {
  return scope === 'all'
    ? '틀린 비밀번호가 너무 많이 들어와 잠시 모든 기기에서 잠겼어요. 15분 뒤에 다시 해 주세요.'
    : '틀린 비밀번호가 여러 번 들어와 이 기기는 15분 동안 잠겼어요.';
}

export type UnlockAttempt =
  | { ok: true; name: string; expiresAt: string }
  | { ok: false; error: string; remaining?: number; lockedUntil?: string | null };

/**
 * 인증 비밀번호 확인 → 맞으면 열람 쿠키(서버 액션 안에서만 부를 것).
 * 동시에 여러 번 보내 제한을 피하지 못하게, 계산 전에 "틀림"으로 먼저 적고 다시 센 뒤 계산 → 맞으면 그 줄을 unlock_ok 로 바꿈.
 */
export async function attemptUnlock(password: string, name: string): Promise<UnlockAttempt> {
  const keys = readContractKeys();
  if (!keys) return { ok: false, error: NOT_CONFIGURED_MSG };
  const supabase = createAdminClient();
  const { ipHash, ua } = await requestMeta(keys);

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

  const ok = await checkPassword(keys.password, password);
  if (!ok) {
    const { error: upErr } = await supabase.from(CONTRACT_SECRET_LOG_TABLE).update({ note: '' }).eq('id', attemptId);
    if (upErr) console.error('[contracts/secrets] 틀린 시도 기록 정리 실패:', upErr.code, upErr.message);
    const remaining = Math.max(0, Math.min(IP_FAIL_MAX - after.ipFails, ALL_FAIL_MAX - after.allFails));
    if (after.lockedUntil) {
      return { ok: false, error: `비밀번호가 맞지 않아요. ${lockedMessage(after.scope)}`, remaining: 0, lockedUntil: after.lockedUntil };
    }
    return { ok: false, error: `비밀번호가 맞지 않아요. (남은 시도 ${remaining}회)`, remaining, lockedUntil: null };
  }

  const { error: okErr } = await supabase
    .from(CONTRACT_SECRET_LOG_TABLE)
    .update({ action: 'unlock_ok', note: '' })
    .eq('id', attemptId);
  if (okErr) console.error('[contracts/secrets] 열람 기록 실패:', okErr.code, okErr.message);
  const { expiresAt } = await issueUnlockCookie(keys, name);
  return { ok: true, name, expiresAt };
}

// ── 기록 ─────────────────────────────────────────────────────────────

/** 열람·수정·인증 기록 — 값은 절대 안 적음. 실패해도 던지지 않음(서버 로그에만) */
export async function logSecretEvent(e: {
  action: string;
  actor: string;
  clientId?: string;
  contractId?: string;
  seatId?: string;
  clientName?: string;
  field?: string;
  count?: number;
  note?: string;
}): Promise<void> {
  try {
    if (!(LOG_ACTIONS as readonly string[]).includes(e.action)) {
      console.error('[contracts/secrets] 모르는 기록 종류:', e.action);
      return;
    }
    const keys = readContractKeys();
    const { ipHash, ua } = await requestMeta(keys);
    const uuidOrNull = (v?: string) => (v && UUID_RE.test(v) ? v.toLowerCase() : null);
    const { error } = await createAdminClient()
      .from(CONTRACT_SECRET_LOG_TABLE)
      .insert({
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
  } catch (err) {
    console.error('[contracts/secrets] 기록 실패:', (err as Error)?.message);
  }
}

/** 열람 기록 화면 — 최근 limit 건(최대 500) + 최근 24시간 틀린 시도 수(count head) */
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
  if (list.error) throw dbError('열람 기록을 못 읽었어요', list.error);
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

// ── 어느 칸에 비밀이 있는지 (값 없음) ─────────────────────────────────

/** 표시용 — 소유자 id → 비밀이 있는 칸 목록. 200개씩 나눠 묻고, 각 묶음도 1000줄씩 끝까지(1000줄 한도) */
export async function secretFlags(ids: { contractIds: string[]; seatIds: string[] }): Promise<Map<string, SecretField[]>> {
  const supabase = createAdminClient();
  const found = new Map<string, Set<SecretField>>();
  const jobs: { column: 'contract_id' | 'seat_id'; part: string[] }[] = [
    ...chunk(uniqueUuids(ids.contractIds ?? []), ID_CHUNK).map((part) => ({ column: 'contract_id' as const, part })),
    ...chunk(uniqueUuids(ids.seatIds ?? []), ID_CHUNK).map((part) => ({ column: 'seat_id' as const, part })),
  ];
  // 한 번에 4묶음씩
  for (const batch of chunk(jobs, 4)) {
    const results = await Promise.all(
      batch.map(async ({ column, part }) => {
        const rows: { owner: string; field: string }[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from(CONTRACT_SECRETS_TABLE)
            .select(`id, ${column}, field`)
            .in(column, part)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw dbError('비밀 칸 표시를 못 읽었어요', error);
          const page = (data ?? []) as Record<string, string>[];
          for (const r of page) rows.push({ owner: String(r[column]), field: String(r.field) });
          if (page.length < PAGE) break;
        }
        return rows;
      }),
    );
    for (const rows of results) {
      for (const { owner, field } of rows) {
        if (!isSecretField(field)) continue;
        const set = found.get(owner) ?? new Set<SecretField>();
        set.add(field);
        found.set(owner, set);
      }
    }
  }
  const out = new Map<string, SecretField[]>();
  for (const [owner, set] of found) out.set(owner, SECRET_FIELDS.filter((f) => set.has(f)));
  return out;
}

// ── 시트 옮기기용 (값은 돌려주지 않음) ─────────────────────────────────

/**
 * 칸마다 암호화해 넣되, 이미 있는 칸((좌석|상품), field)은 건드리지 않음(ON CONFLICT DO NOTHING).
 * 빈 문자열은 넣지 않고 셈에서도 빠짐. 같은 칸이 두 번 오면 처음 것만 넣고 나머지는 existing 으로 셈.
 * 부르는 액션이 requireUnlock 을 먼저 할 것. 모양이 틀린 입력·DB 오류는 던짐.
 */
export async function insertSecretsIfMissing(
  rows: { contractId?: string; seatId?: string; field: SecretField; plain: string }[],
  actor: string,
): Promise<{ inserted: number; existing: number }> {
  const keys = requireKeys();
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
  for (const column of ['contract_id', 'seat_id'] as const) {
    const items = [...by[column].values()];
    for (const part of chunk(items, ID_CHUNK)) {
      const payload = part.map((i) => ({
        [column]: i.owner.id,
        field: i.field,
        sealed: sealWithKey(keys.secretKey, i.plain, secretAad(i.owner.kind, i.owner.id, i.field)),
        key_version: 1,
        updated_by: who,
      }));
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

/** DB 에서 다시 읽어 복호화한 값이 시트 값과 같은지(서버 메모리 안에서만 비교 — 값은 안 돌려줌) */
export async function verifySecrets(
  rows: { seatId: string; field: SecretField; plain: string }[],
): Promise<{ verified: number; mismatched: { seatId: string; field: SecretField }[] }> {
  const keys = requireKeys();
  const supabase = createAdminClient();
  const seatIds = uniqueUuids(rows.map((r) => r.seatId));
  const fields = [...new Set(rows.map((r) => r.field).filter(isSecretField))];
  const sealedBy = new Map<string, string>();
  if (seatIds.length > 0 && fields.length > 0) {
    for (const part of chunk(seatIds, ID_CHUNK)) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from(CONTRACT_SECRETS_TABLE)
          .select('id, seat_id, field, sealed')
          .in('seat_id', part)
          .in('field', fields)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw dbError('확인용으로 비밀 칸을 못 읽었어요', error);
        const page = (data ?? []) as { seat_id: string; field: string; sealed: string }[];
        for (const r of page) sealedBy.set(`${String(r.seat_id).toLowerCase()}:${r.field}`, r.sealed);
        if (page.length < PAGE) break;
      }
    }
  }
  let verified = 0;
  const mismatched: { seatId: string; field: SecretField }[] = [];
  for (const r of rows) {
    const id = typeof r.seatId === 'string' ? r.seatId.toLowerCase() : '';
    const sealed = UUID_RE.test(id) && isSecretField(r.field) ? sealedBy.get(`${id}:${r.field}`) : undefined;
    let same = false;
    if (sealed !== undefined && typeof r.plain === 'string') {
      try {
        same = openWithKey(keys.secretKey, sealed, secretAad('seat', id, r.field)) === r.plain;
      } catch {
        same = false;
      }
    }
    if (same) verified++;
    else mismatched.push({ seatId: r.seatId, field: r.field });
  }
  return { verified, mismatched };
}

// ── 보기·저장 (열람 중일 때만 — 안에서도 다시 확인) ─────────────────────

/** 한 칸 복호화. 없으면 null, 열쇠가 다르거나 손상되면 SecretOpenError */
export async function readSecretPlain(owner: ParsedOwner, field: SecretField): Promise<string | null> {
  const keys = requireKeys();
  await requireUnlock();
  const { data, error } = await createAdminClient()
    .from(CONTRACT_SECRETS_TABLE)
    .select('sealed')
    .eq(owner.column, owner.id)
    .eq('field', field)
    .maybeSingle();
  if (error) throw dbError('비밀 칸을 못 읽었어요', error);
  if (!data) return null;
  return openWithKey(keys.secretKey, String((data as { sealed: string }).sealed), secretAad(owner.kind, owner.id, field));
}

/** 한 계약 상품 + 그 좌석들의 비밀 칸 전부(거래처 전체·전체 내보내기는 없음). 하나라도 안 풀리면 SecretOpenError(개수만) */
export async function readContractSecretsPlain(
  contractId: string,
): Promise<{ values: { owner: SecretOwner; field: SecretField; value: string }[]; failed: number }> {
  const keys = requireKeys();
  await requireUnlock();
  const owner = parseSecretOwner({ contractId });
  if (!owner) throw new Error('계약 상품 id 모양이 틀렸어요.');
  const supabase = createAdminClient();

  const seatIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(SW_SEATS_TABLE)
      .select('id')
      .eq('contract_id', owner.id)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw dbError('좌석 목록을 못 읽었어요', error);
    const page = (data ?? []) as { id: string }[];
    seatIds.push(...page.map((r) => String(r.id).toLowerCase()));
    if (page.length < PAGE) break;
  }

  const sealedRows: { owner: ParsedOwner; field: SecretField; sealed: string }[] = [];
  {
    const { data, error } = await supabase
      .from(CONTRACT_SECRETS_TABLE)
      .select('id, field, sealed')
      .eq('contract_id', owner.id)
      .order('id', { ascending: true });
    if (error) throw dbError('비밀 칸을 못 읽었어요', error);
    for (const r of (data ?? []) as { field: string; sealed: string }[]) {
      if (isSecretField(r.field)) sealedRows.push({ owner, field: r.field, sealed: r.sealed });
    }
  }
  for (const part of chunk(seatIds, ID_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(CONTRACT_SECRETS_TABLE)
        .select('id, seat_id, field, sealed')
        .in('seat_id', part)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw dbError('비밀 칸을 못 읽었어요', error);
      const page = (data ?? []) as { seat_id: string; field: string; sealed: string }[];
      for (const r of page) {
        const seatOwner = parseSecretOwner({ seatId: String(r.seat_id) });
        if (seatOwner && isSecretField(r.field)) sealedRows.push({ owner: seatOwner, field: r.field, sealed: r.sealed });
      }
      if (page.length < PAGE) break;
    }
  }

  const values: { owner: SecretOwner; field: SecretField; value: string }[] = [];
  let failed = 0;
  for (const r of sealedRows) {
    try {
      values.push({ owner: ownerOf(r.owner), field: r.field, value: openWithKey(keys.secretKey, r.sealed, secretAad(r.owner.kind, r.owner.id, r.field)) });
    } catch (err) {
      if (err instanceof SecretOpenError) failed++;
      else throw err;
    }
  }
  return { values, failed };
}

/**
 * 비밀 한 칸 저장(빈 값·공백뿐 = 삭제). 'saved' / 'deleted' / 'nothing'(지울 게 없었음).
 * 주인(상품·좌석)이 없으면 FK 오류로 실패.
 */
export async function writeSecret(owner: ParsedOwner, field: SecretField, value: string, actor: string): Promise<'saved' | 'deleted' | 'nothing'> {
  const keys = requireKeys();
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
  const { error } = await supabase.from(CONTRACT_SECRETS_TABLE).upsert(
    {
      [owner.column]: owner.id,
      field,
      sealed: sealWithKey(keys.secretKey, value, secretAad(owner.kind, owner.id, field)),
      key_version: 1,
      updated_by: (actor ?? '').slice(0, 40),
    },
    { onConflict: `${owner.column},field` },
  );
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
