import 'server-only';
import { createHash, createHmac, hkdfSync, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 계약 관리 소프트웨어 탭 잠금 — 암호 계산만 모아 둔 곳(설계 docs/tasks/2026-11-20-contract-management.md §3-4, D13).
 * D13: 비밀 칸은 암호화하지 않음(서버 전용 표에 그대로). 여기는 비밀번호 해시·잠금 해제 쿠키 서명·IP 해시·틀린 시도 계산만.
 * DB·쿠키·요청을 모름 — 값(쿠키 서명용 무작위 값)은 부르는 쪽(lib/contracts/secrets.ts)이 it_contract_settings 에서 읽어 넘김.
 *
 * 순수 계산이라 Node 로 바로 시험할 수 있다:
 *   node --conditions=react-server <시험.mts>   (server-only 가 react-server 조건에서 빈 모듈이 됨)
 * 시험 값은 그 자리에서 randomBytes 로 만든다 — 코드·문서에 실제 값을 적지 않는다.
 *
 * 형식:
 *   비밀번호 해시(it_contract_settings 'sw_password_hash') = pbkdf2-sha256$<반복 횟수>$<salt>$<hash>
 *     salt = 16바이트, hash = 32바이트, 둘 다 base64url(패딩 없음, RFC 4648 §5)
 *     비밀번호 = NFC 로 정리한 문자열의 UTF-8 바이트, PRF = HMAC-SHA-256, 반복 600,000 (서버에서 만듦)
 *   쿠키 서명용 값('cookie_secret') = 무작위 32바이트 base64url(패딩 없음, 43자) → HKDF 로 쿠키 서명 열쇠·IP 해시 열쇠를 따로 뽑음
 *   쿠키 = base64url(JSON{v:1, exp, name, pw}).base64url(HMAC-SHA256), pw = 비밀번호 해시 문자열의 지문 8자
 */

export const PBKDF2_PREFIX = 'pbkdf2-sha256';
export const PBKDF2_ITERATIONS = 600_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_HASH_BYTES = 32;
export const COOKIE_SECRET_BYTES = 32;
/** 저장된 해시의 반복 횟수 허용 범위(이 앱이 만드는 해시는 항상 600,000) */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 5_000_000;
const HKDF_SALT = Buffer.from('it-contracts:v1', 'utf8');

// ── base64url ─────────────────────────────────────────────────────────

export function toB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** base64url(패딩 없음)만 받음. 같은 바이트를 다르게 적은 값(남는 비트가 다른 것)도 거절 → 글자 하나만 바꿔도 다른 값 */
export function fromB64url(text: string): Buffer | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const buf = Buffer.from(text, 'base64url');
  return buf.toString('base64url') === text ? buf : null;
}

// ── 쿠키 서명용 무작위 값 → 용도별 열쇠 ───────────────────────────────

/** 처음 한 번 만들어 it_contract_settings 'cookie_secret' 에 넣는 값 */
export function newCookieSecret(): string {
  return toB64url(randomBytes(COOKIE_SECRET_BYTES));
}

/** 저장된 'cookie_secret' 값 → 32바이트. 모양이 틀리면 null */
export function parseCookieSecret(raw: string | null | undefined): Buffer | null {
  const buf = fromB64url((raw ?? '').trim());
  return buf && buf.length === COOKIE_SECRET_BYTES ? buf : null;
}

/** 한 값에서 용도별 열쇠를 따로 뽑음 — 쿠키 서명과 IP 해시가 같은 열쇠를 쓰지 않게 */
export function deriveSubKey(master: Buffer, info: 'unlock-cookie' | 'ip-hash'): Buffer {
  return Buffer.from(hkdfSync('sha256', master, HKDF_SALT, Buffer.from(info, 'utf8'), 32));
}

export function deriveUnlockKeys(master: Buffer): { cookieKey: Buffer; ipKey: Buffer } {
  return { cookieKey: deriveSubKey(master, 'unlock-cookie'), ipKey: deriveSubKey(master, 'ip-hash') };
}

// ── 비밀번호 (PBKDF2-SHA256) ─────────────────────────────────────────

export type ParsedPasswordHash = { iterations: number; salt: Buffer; hash: Buffer };

/** 한글 등 같은 글자가 다른 바이트(NFD)로 들어와도 같은 비밀번호로 */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/** 저장된 해시 → 반복 횟수·salt·hash. 모양이 틀리면 null */
export function parsePasswordHash(raw: string | null | undefined): ParsedPasswordHash | null {
  const text = (raw ?? '').trim();
  const m = /^pbkdf2-sha256\$(\d{6,7})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(text);
  if (!m) return null;
  const iterations = Number(m[1]);
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;
  const salt = fromB64url(m[2]);
  const hash = fromB64url(m[3]);
  if (!salt || salt.length < PASSWORD_SALT_BYTES || !hash || hash.length !== PASSWORD_HASH_BYTES) return null;
  return { iterations, salt, hash };
}

export function formatPasswordHash(salt: Uint8Array, hash: Uint8Array, iterations: number = PBKDF2_ITERATIONS): string {
  return `${PBKDF2_PREFIX}$${iterations}$${toB64url(salt)}$${toB64url(hash)}`;
}

/** 이벤트 루프를 막지 않게 비동기(600,000회 ≈ 0.3~0.6초) */
export function pbkdf2Sha256(password: string, salt: Uint8Array, iterations: number, length: number = PASSWORD_HASH_BYTES): Promise<Buffer> {
  const pw = Buffer.from(normalizePassword(password), 'utf8');
  return new Promise((resolve, reject) => {
    pbkdf2(pw, salt, iterations, length, 'sha256', (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** 새 비밀번호 → 저장할 해시 문자열(무작위 salt 16바이트, 600,000회) */
export async function makePasswordHash(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  return formatPasswordHash(salt, await pbkdf2Sha256(password, salt, PBKDF2_ITERATIONS));
}

export async function checkPassword(parsed: ParsedPasswordHash, password: string): Promise<boolean> {
  const got = await pbkdf2Sha256(password, parsed.salt, parsed.iterations, parsed.hash.length);
  return got.length === parsed.hash.length && timingSafeEqual(got, parsed.hash);
}

/** 해시 지문 8자 — 쿠키에 넣어 두면 비밀번호(해시)를 바꾸는 순간 다른 기기의 쿠키가 모두 무효 */
export function passwordHashFingerprint(raw: string): string {
  return createHash('sha256').update(raw.trim(), 'utf8').digest('hex').slice(0, 8);
}

// ── 잠금 해제 쿠키 서명 ──────────────────────────────────────────────

export type UnlockClaims = { name: string; exp: number };

/** base64url(JSON{v:1, exp, name, pw}).base64url(HMAC-SHA256) */
export function signUnlockToken(cookieKey: Buffer, claims: { name: string; exp: number; pw: string }): string {
  const body = toB64url(Buffer.from(JSON.stringify({ v: 1, exp: claims.exp, name: claims.name, pw: claims.pw }), 'utf8'));
  const sig = createHmac('sha256', cookieKey).update(body, 'utf8').digest();
  return `${body}.${toB64url(sig)}`;
}

/**
 * 서명·만료·해시 지문이 모두 맞을 때만 {name, exp}. 아니면 null(이유는 안 나눔).
 * maxTtlMs: 지금부터 그보다 먼 만료는 거절(시계가 틀린 쿠키 방지, 1분 여유).
 */
export function verifyUnlockToken(
  cookieKey: Buffer,
  token: string | null | undefined,
  opts: { now: number; pw: string; maxTtlMs: number },
): UnlockClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sigText] = parts;
  const sig = fromB64url(sigText);
  const want = createHmac('sha256', cookieKey).update(body, 'utf8').digest();
  if (!sig || sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  const raw = fromB64url(body);
  if (!raw) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  const c = claims as { v?: unknown; exp?: unknown; name?: unknown; pw?: unknown };
  if (c.v !== 1 || typeof c.exp !== 'number' || !Number.isFinite(c.exp) || typeof c.name !== 'string' || typeof c.pw !== 'string') {
    return null;
  }
  if (c.exp <= opts.now) return null;
  if (c.exp > opts.now + opts.maxTtlMs + 60_000) return null;
  if (c.pw !== opts.pw) return null;
  return { name: c.name, exp: c.exp };
}

// ── IP 해시 ──────────────────────────────────────────────────────────

/** 원래 IP 는 저장하지 않음 — HMAC 앞 16자만 */
export function ipHashWith(ipKey: Buffer, ip: string): string {
  return createHmac('sha256', ipKey)
    .update(ip.trim() || 'unknown', 'utf8')
    .digest('hex')
    .slice(0, 16);
}

// ── 틀린 시도 잠금 계산 ──────────────────────────────────────────────

/**
 * 틀린 시도 시각들(ms) → 잠금이 끝나는 시각(ms) 또는 null.
 * 규칙: 어떤 windowMs 구간 안에 max 번 틀렸으면, 그 max 번째 틀린 때부터 windowMs 동안 잠금.
 * (잠금 중엔 비밀번호 계산도, 틀린 기록도 안 하므로 잠금이 저절로 늘어나지 않음)
 */
export function lockoutUntil(failTimes: number[], now: number, max: number, windowMs: number): number | null {
  if (max < 1) return null;
  const t = failTimes.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let until: number | null = null;
  for (let i = max - 1; i < t.length; i++) {
    if (t[i] - t[i - max + 1] <= windowMs) {
      const end = t[i] + windowMs;
      if (until === null || end > until) until = end;
    }
  }
  return until !== null && until > now ? until : null;
}
