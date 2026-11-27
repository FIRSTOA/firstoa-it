import 'server-only';
import type { SalesImportErrorCode } from './types';

const DEFAULT_URL = 'https://firstoa-smart-sales-os.vercel.app/api/export/it-confirms';

export type FetchSalesConfirmsResult =
  | { ok: true; body: unknown }
  | { ok: false; code: SalesImportErrorCode; error: string };

/**
 * 영업 웹앱 읽기 전용 API 호출(D1). 키·응답 본문은 오류 문구·로그에 넣지 않음(상태 코드만).
 * since = 'YYYY-MM-DD'.
 */
export async function fetchSalesConfirms(since: string, timeoutMs: number): Promise<FetchSalesConfirmsResult> {
  const key = process.env.SALES_EXPORT_KEY;
  if (!key) {
    return { ok: false, code: 'no_key', error: '영업 웹앱 연결 키가 아직 없어요 — 개발 담당에게 알려 주세요' };
  }
  let url: string;
  try {
    const u = new URL(process.env.SALES_EXPORT_URL || DEFAULT_URL);
    u.searchParams.set('since', since);
    url = u.toString();
  } catch {
    return { ok: false, code: 'not_found', error: '영업 웹앱의 가져오기 주소가 바뀌었어요 — 개발 담당에게 알려 주세요' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'x-export-key': key, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    console.warn(`[sales-import] 영업 웹앱 호출 실패(${name === 'TimeoutError' || name === 'AbortError' ? '시간 초과' : '연결'})`);
    return { ok: false, code: 'unreachable', error: '영업 웹앱이 응답하지 않아요 — 3분 뒤 자동으로 다시 해요' };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: 'unauthorized', error: '영업 웹앱이 키를 거절했어요 — 영업 쪽에서 키를 바꿨는지 확인해 주세요' };
  }
  if (res.status === 404) {
    return { ok: false, code: 'not_found', error: '영업 웹앱의 가져오기 주소가 바뀌었어요' };
  }
  if (!res.ok) {
    console.warn(`[sales-import] 영업 웹앱 응답 ${res.status}`);
    return { ok: false, code: 'unreachable', error: '영업 웹앱이 응답하지 않아요 — 3분 뒤 자동으로 다시 해요' };
  }

  // 본문은 읽기만 — 오류 문구엔 형식(content-type)만, 본문 값은 안 넣음
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim() || '형식 없음';
  try {
    return { ok: true, body: await res.json() };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'unreachable', error: '영업 웹앱이 응답하지 않아요 — 3분 뒤 자동으로 다시 해요' };
    }
    console.warn(`[sales-import] 응답이 JSON 아님(${contentType})`);
    return {
      ok: false,
      code: 'bad_shape',
      error: `영업 웹앱이 보낸 모양이 달라요 — 하나도 가져오지 않았어요 (JSON 아님 · ${contentType})`,
    };
  }
}

// ───────── 한 건 받기(설계 E1·E8) — 키는 헤더로만, 주소에 안 붙임 ─────────

/** 영업 export id 형식(영업 라우트와 같은 검사) — 아니면 부르지 않음 */
export const SALES_ID_PATTERN = /^[a-z0-9]{6,32}$/;
const HTML_MAX_BYTES = 2 * 1024 * 1024;

export type FetchSalesConfirmOneResult =
  | { ok: true; body: unknown }
  | { ok: false; notFound: true }
  | { ok: false; notFound?: false; code: SalesImportErrorCode; error: string };

export type FetchSalesFormHtmlResult =
  | { ok: true; html: string }
  | { ok: false; notFound: true }
  | { ok: false; tooBig: true }
  | { ok: false; notFound?: false; tooBig?: false; code: SalesImportErrorCode; error: string };

function oneUrl(id: string, type: string, html: boolean): string | null {
  if (!SALES_ID_PATTERN.test(id) || !type) return null;
  try {
    const u = new URL(process.env.SALES_EXPORT_URL || DEFAULT_URL);
    u.searchParams.set('id', id);
    u.searchParams.set('type', type);
    if (html) u.searchParams.set('html', '1');
    return u.toString();
  } catch {
    return null;
  }
}

const ONE_UNREACHABLE = '영업 웹앱이 응답하지 않아요 — 잠시 뒤 다시 해요';

/** 공통 호출 — 응답(Response)이나 분류된 오류. 로그엔 HTTP 숫자·reason 만 */
async function callOne(
  url: string | null,
  accept: string,
  timeoutMs: number,
  tag: string,
): Promise<{ ok: true; res: Response } | Extract<FetchSalesConfirmOneResult, { ok: false }>> {
  const key = process.env.SALES_EXPORT_KEY;
  if (!key) {
    return { ok: false, code: 'no_key', error: '영업 웹앱 연결 키가 아직 없어요 — 개발 담당에게 알려 주세요' };
  }
  if (!url) {
    return { ok: false, code: 'not_found', error: '영업 웹앱의 가져오기 주소가 바뀌었어요 — 개발 담당에게 알려 주세요' };
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'x-export-key': key, accept },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    console.warn(`[${tag}] 영업 웹앱 호출 실패(${name === 'TimeoutError' || name === 'AbortError' ? '시간 초과' : '연결'})`);
    return { ok: false, code: 'unreachable', error: ONE_UNREACHABLE };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: 'unauthorized', error: '영업 웹앱이 키를 거절했어요 — 영업 쪽에서 키를 바꿨는지 확인해 주세요' };
  }
  // 한 건 주소에서 404 = 그 확인서가 영업에 없음(종류가 바뀜 등) — 주소가 바뀐 것과 구분
  if (res.status === 404) return { ok: false, notFound: true };
  if (!res.ok) {
    console.warn(`[${tag}] 영업 웹앱 응답 ${res.status}`);
    return { ok: false, code: 'unreachable', error: ONE_UNREACHABLE };
  }
  return { ok: true, res };
}

/** 영업 확인서 한 건(JSON) — `?id=&type=`. 목록 한 줄과 같은 모양 */
export async function fetchSalesConfirmOne(id: string, type: string, timeoutMs = 4_000): Promise<FetchSalesConfirmOneResult> {
  const got = await callOne(oneUrl(id, type, false), 'application/json', timeoutMs, 'sales-import');
  if (!got.ok) return got;
  try {
    return { ok: true, body: await got.res.json() };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, code: 'unreachable', error: ONE_UNREACHABLE };
    console.warn('[sales-import] 한 건 응답이 JSON 아님');
    return { ok: false, code: 'bad_shape', error: '영업 웹앱이 보낸 모양이 달라요 — 가져오지 않았어요' };
  }
}

/** 영업 양식 HTML 한 건 — `?id=&type=&html=1`(그 순간 영업 최신 양식). 2MB 넘으면 too_big. 내용은 로그·오류에 안 넣음 */
export async function fetchSalesFormHtml(id: string, type: string, timeoutMs = 4_000): Promise<FetchSalesFormHtmlResult> {
  const got = await callOne(oneUrl(id, type, true), 'text/html', timeoutMs, 'sales-form');
  if (!got.ok) return got;
  const res = got.res;
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > HTML_MAX_BYTES) {
    try {
      await res.body?.cancel();
    } catch {
      /* 무시 */
    }
    return { ok: false, tooBig: true };
  }
  try {
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, code: 'bad_shape', error: '영업 웹앱이 보낸 모양이 달라요' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > HTML_MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* 무시 */
        }
        return { ok: false, tooBig: true };
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    return { ok: true, html: new TextDecoder('utf-8').decode(buf) };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    console.warn(`[sales-form] 본문 읽기 실패(${name === 'TimeoutError' || name === 'AbortError' ? '시간 초과' : '연결'})`);
    return { ok: false, code: 'unreachable', error: ONE_UNREACHABLE };
  }
}
