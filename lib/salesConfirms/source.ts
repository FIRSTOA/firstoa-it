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

  try {
    return { ok: true, body: await res.json() };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'unreachable', error: '영업 웹앱이 응답하지 않아요 — 3분 뒤 자동으로 다시 해요' };
    }
    return { ok: false, code: 'bad_shape', error: '영업 웹앱이 보낸 모양이 달라요 — 하나도 가져오지 않았어요' };
  }
}
