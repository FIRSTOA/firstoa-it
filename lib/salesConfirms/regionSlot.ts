/**
 * 출고 준비 일정 시간 ↔ 지역 (순수 — import 없음).
 * 사용자 설명(2026-11-26): 출고 준비 리스트는 통합 캘린더(네이버) 일정에서 오고, **일정 시간으로 지역(배송 동선)을 나눔**
 *   오전 09:00 = 수도권A · 오후 12:00 = 수도권B · 오후 15:00 = 수도권C · 오후 18:00 = 수도권D · 오후 21:00 = 수도권E
 * 정해진 다섯 시각(정각)이 아닌 일정은 지역 모름(null) — 시간 범위로 나누는 거라면 여기 한 곳만 고침.
 * 쓰는 곳: prepMatch.ts(영업 확인서 ↔ 출고 준비 일정 같은 건 찾기 — 지역이 같아야), 상세의 지역 추정(영업 지역이 비었을 때).
 */

export const REGION_BY_HOUR: Readonly<Record<number, string>> = {
  9: '수도권A',
  12: '수도권B',
  15: '수도권C',
  18: '수도권D',
  21: '수도권E',
};

/**
 * 일정 시작 시각 → 지역. 한국 시간 기준.
 * @param start ISO 시각(타임존 포함) 또는 'HH:mm' / 'HH:mm:ss'. 종일 일정·날짜만 있으면 null.
 */
export function regionFromEventTime(start: string | null | undefined): string | null {
  if (!start) return null;
  const s = String(start).trim();
  let hour: number | null = null;
  let minute = 0;
  const hm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (hm) {
    hour = Number(hm[1]);
    minute = Number(hm[2]);
  } else if (/T\d{2}:\d{2}/.test(s)) {
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return null;
    // 타임존이 없는 'YYYY-MM-DDTHH:mm' 는 이미 한국 시간으로 봄
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
      const kst = new Date(ms + 9 * 3600_000);
      hour = kst.getUTCHours();
      minute = kst.getUTCMinutes();
    } else {
      const m = /T(\d{2}):(\d{2})/.exec(s);
      hour = m ? Number(m[1]) : null;
      minute = m ? Number(m[2]) : 0;
    }
  }
  if (hour === null || minute !== 0) return null;
  return REGION_BY_HOUR[hour] ?? null;
}
