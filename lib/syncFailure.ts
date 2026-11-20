/**
 * 최선노력 반영(네이버 캘린더·구글시트)이 실패했을 때 화면에 보여 줄 짧은 이유(쉬운 말).
 * 앱 저장은 성공으로 두되 실패를 삼키지 않고 "앱에는 저장, ○○ 반영은 실패"를 알리는 데 씀
 * (app/calendar/actions.ts·app/sales/actions.ts·app/shipment-prep/reportActions.ts).
 * import 없는 순수 함수 — 'use server' 파일은 함수 말고 다른 걸 export 못 해서 따로 둠.
 */

function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
}

/** HTTP 상태 번호 — 구글 API 오류(status·response.status·code) 또는 문구 속 "(412)" 꼴. */
function statusOf(err: unknown): number | null {
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } | null };
    for (const v of [e.status, e.response?.status, e.code]) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{3}$/.test(v) ? Number(v) : NaN;
      if (n >= 400 && n < 600) return n;
    }
  }
  const m = messageOf(err).match(/\((\d{3})\)/);
  return m ? Number(m[1]) : null;
}

function isTimeout(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : '';
  return name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|ETIMEDOUT/i.test(messageOf(err));
}

function isNetwork(err: unknown): boolean {
  return /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|network/i.test(messageOf(err));
}

function short(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function naverFailReason(err: unknown): string {
  const status = statusOf(err);
  if (isTimeout(err)) return '네이버가 제때 답하지 않았어요';
  if (status === 401 || /인증 실패/.test(messageOf(err))) return '네이버 로그인(앱 비밀번호) 문제';
  if (status === 403) return '이 네이버 캘린더에 쓸 권한이 없어요';
  if (isNetwork(err)) return '네이버에 연결하지 못했어요';
  return short(messageOf(err)) || '알 수 없는 오류';
}

export function sheetFailReason(err: unknown): string {
  const status = statusOf(err);
  const msg = messageOf(err);
  if (status === 429 || /quota|rate limit/i.test(msg)) return '구글시트 1분 사용 한도에 걸렸어요';
  if (status === 403) return '구글시트 편집 권한이 없어요';
  if (isTimeout(err) || isNetwork(err)) return '구글시트에 연결하지 못했어요';
  return short(msg) || '알 수 없는 오류';
}
