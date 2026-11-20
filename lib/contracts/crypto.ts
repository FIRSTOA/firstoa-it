import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  pbkdf2,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * 계약 관리 비밀 칸 — 암호 계산만 모아 둔 곳(설계 docs/tasks/2026-11-20-contract-management.md §3-4).
 * DB·쿠키·요청을 모름. 열쇠·비밀번호 해시는 Vercel 환경변수(Production 만)에서 읽고, 값은 어디에도 찍지 않는다.
 *
 * 순수 계산(열쇠를 인자로 받는 함수)은 Node 로 바로 시험할 수 있다:
 *   node --conditions=react-server <시험.mts>   (server-only 가 react-server 조건에서 빈 모듈이 됨)
 * 시험 열쇠는 그 자리에서 randomBytes 로 만든다 — 코드·문서에 열쇠 값을 적지 않는다.
 *
 * 형식(설정 화면 components/contracts/SecretSetupTool.tsx 와 반드시 같게):
 *   CONTRACT_SECRET_KEY    = 무작위 32바이트의 표준 base64(패딩 포함 44자)
 *   CONTRACT_PASSWORD_HASH = pbkdf2-sha256$<반복 횟수>$<salt>$<hash>
 *                            salt = 16바이트, hash = 32바이트, 둘 다 base64url(패딩 없음, RFC 4648 §5)
 *                            비밀번호 = NFC 로 정리한 문자열의 UTF-8 바이트, PRF = HMAC-SHA-256, 반복 600,000
 *   암호문(sealed)          = v1.<iv 12바이트>.<tag 16바이트>.<암호문> — 셋 다 base64url(패딩 없음)
 *   AAD                    = it-contracts:v1:<seat|contract>:<owner id 소문자>:<field>
 * 주의: .env.local 에 해시를 넣으면 Next 가 `$이름`을 변수로 바꿔 버림 → `\$`로 적어야 함(Vercel 값은 그대로).
 */

export const SECRET_KEY_ENV = 'CONTRACT_SECRET_KEY';
export const PASSWORD_HASH_ENV = 'CONTRACT_PASSWORD_HASH';

export const SEALED_VERSION = 'v1';
export const PBKDF2_PREFIX = 'pbkdf2-sha256';
export const PBKDF2_ITERATIONS = 600_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_HASH_BYTES = 32;
/** 환경변수 해시의 반복 횟수 허용 범위(설정 화면은 항상 600,000) */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 5_000_000;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_SALT = Buffer.from('it-contracts:v1', 'utf8');

/** 복호화 실패 — 이유를 나누지 않음(어느 칸이 왜 틀렸는지 알려 주지 않기 위해) */
export class SecretOpenError extends Error {
  constructor() {
    super('열쇠가 다르거나 값이 손상됨');
    this.name = 'SecretOpenError';
  }
}

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

// ── 암호화 열쇠 ───────────────────────────────────────────────────────

/** CONTRACT_SECRET_KEY 값 → 32바이트 열쇠. 모양·길이가 틀리면 null(= 비밀 칸 기능 꺼짐) */
export function parseSecretKey(raw: string | null | undefined): Buffer | null {
  const text = (raw ?? '').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) return null;
  const buf = Buffer.from(text, 'base64');
  return buf.length === 32 ? buf : null;
}

/** 큰 열쇠에서 용도별 열쇠를 따로 뽑음 — 쿠키 서명·IP 해시가 암호화 열쇠를 그대로 쓰지 않게 */
export function deriveSubKey(master: Buffer, info: 'unlock-cookie' | 'ip-hash'): Buffer {
  return Buffer.from(hkdfSync('sha256', master, HKDF_SALT, Buffer.from(info, 'utf8'), 32));
}

// ── 비밀 칸 암호화 (AES-256-GCM + AAD) ───────────────────────────────

export type SecretOwnerKind = 'seat' | 'contract';

/** 암호문을 다른 줄·칸에 옮겨 붙이면 안 풀리게 하는 꼬리표 */
export function secretAad(kind: SecretOwnerKind, ownerId: string, field: string): string {
  return `it-contracts:${SEALED_VERSION}:${kind}:${ownerId.trim().toLowerCase()}:${field}`;
}

export function sealWithKey(key: Buffer, plain: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEALED_VERSION}.${toB64url(iv)}.${toB64url(tag)}.${toB64url(ct)}`;
}

/** 실패하면 SecretOpenError 하나로만 던짐(원인·값은 싣지 않음) */
export function openWithKey(key: Buffer, sealed: string, aad: string): string {
  const parts = typeof sealed === 'string' ? sealed.split('.') : [];
  if (parts.length !== 4 || parts[0] !== SEALED_VERSION) throw new SecretOpenError();
  const iv = fromB64url(parts[1]);
  const tag = fromB64url(parts[2]);
  const ct = fromB64url(parts[3]);
  if (!iv || iv.length !== IV_BYTES || !tag || tag.length !== TAG_BYTES || !ct) throw new SecretOpenError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretOpenError();
  }
}

// ── 인증 비밀번호 (PBKDF2-SHA256) ────────────────────────────────────

export type ParsedPasswordHash = { iterations: number; salt: Buffer; hash: Buffer };

/** 브라우저 설정 화면과 같은 규칙 — 한글 등 같은 글자가 다른 바이트로 들어와도 같게 */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/** CONTRACT_PASSWORD_HASH 값 → 반복 횟수·salt·hash. 모양이 틀리면 null(= 비밀 칸 기능 꺼짐) */
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

export async function checkPassword(parsed: ParsedPasswordHash, password: string): Promise<boolean> {
  const got = await pbkdf2Sha256(password, parsed.salt, parsed.iterations, parsed.hash.length);
  return got.length === parsed.hash.length && timingSafeEqual(got, parsed.hash);
}

/** 해시 지문 8자 — 쿠키에 넣어 두면 비밀번호(해시)를 바꾸는 순간 열려 있던 쿠키가 모두 무효 */
export function passwordHashFingerprint(raw: string): string {
  return createHash('sha256').update(raw.trim(), 'utf8').digest('hex').slice(0, 8);
}

// ── 열람 쿠키 서명 ───────────────────────────────────────────────────

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

// ── 환경변수 ─────────────────────────────────────────────────────────

export type ContractKeys = {
  secretKey: Buffer;
  cookieKey: Buffer;
  ipKey: Buffer;
  password: ParsedPasswordHash;
  pwFingerprint: string;
};

/** 두 환경변수가 각각 쓸 수 있는 모양인지(값은 돌려주지 않음) */
export function contractEnvStatus(): { key: boolean; passwordHash: boolean } {
  return {
    key: parseSecretKey(process.env[SECRET_KEY_ENV]) !== null,
    passwordHash: parsePasswordHash(process.env[PASSWORD_HASH_ENV]) !== null,
  };
}

/** 열쇠·해시를 읽어 용도별 열쇠까지. 하나라도 없거나 모양이 틀리면 null */
export function readContractKeys(): ContractKeys | null {
  const secretKey = parseSecretKey(process.env[SECRET_KEY_ENV]);
  const rawHash = process.env[PASSWORD_HASH_ENV] ?? '';
  const password = parsePasswordHash(rawHash);
  if (!secretKey || !password) return null;
  return {
    secretKey,
    cookieKey: deriveSubKey(secretKey, 'unlock-cookie'),
    ipKey: deriveSubKey(secretKey, 'ip-hash'),
    password,
    pwFingerprint: passwordHashFingerprint(rawHash),
  };
}
