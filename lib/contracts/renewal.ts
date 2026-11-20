/**
 * 계약 상품의 다음 날짜·상태, 갱신 처리 날짜 계산 — import 없는 순수 함수.
 * 설계: docs/tasks/2026-11-20-contract-management.md §3-6.
 * 날짜는 모두 'YYYY-MM-DD' 문자열(한국 날짜). 오늘은 호출하는 쪽이 kstTodayYmd() 로 넘김.
 */

export type RenewalStateKey = 'expired' | 'due30' | 'ok' | 'nodate';

/** 한국 시간 오늘 'YYYY-MM-DD' (아침 9시 전에 하루 어긋나지 않게) */
export function kstTodayYmd(now: number = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

function parse(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** ymd 에 n 일 더하기 */
export function addDaysYmd(ymd: string, n: number): string {
  const p = parse(ymd);
  if (!p) return ymd;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}

/** ymd 에 n 개월 더하기 — 말일 맞춤(1/31 + 1개월 = 2/28) */
export function addMonthsYmd(ymd: string, n: number): string {
  const p = parse(ymd);
  if (!p) return ymd;
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(p.d, last)).padStart(2, '0')}`;
}

export type RenewalSeat = { renewsOn: string | null; endsOn: string | null; status: string };
export type RenewalContract = {
  term: '' | 'monthly' | 'yearly';
  status: string;
  renewsOn: string | null;
  endsOn: string | null;
  seats: RenewalSeat[];
};

const DONE_CONTRACT = new Set(['해지', '만료']);
const DONE_SEAT = new Set(['해지', '만료', '회수']);
const RANK: Record<RenewalStateKey, number> = { expired: 3, due30: 2, ok: 1, nodate: 0 };

/** 계약 상품 하나의 다음 날짜(가장 이른 것)·상태. 월 구독이면 renews_on 은 안 봄, 해지·만료는 제외(nodate) */
export function contractRenewal(c: RenewalContract, today: string): { state: RenewalStateKey; next: string | null } {
  if (DONE_CONTRACT.has(c.status)) return { state: 'nodate', next: null };
  const dates: string[] = [];
  const push = (v: string | null) => {
    if (v && parse(v)) dates.push(v);
  };
  push(c.endsOn);
  if (c.term !== 'monthly') push(c.renewsOn);
  for (const s of c.seats) {
    if (DONE_SEAT.has(s.status)) continue;
    push(s.endsOn);
    if (c.term !== 'monthly') push(s.renewsOn);
  }
  if (!dates.length) return { state: 'nodate', next: null };
  const next = dates.reduce((a, b) => (b < a ? b : a));
  const state: RenewalStateKey = next < today ? 'expired' : next <= addDaysYmd(today, 30) ? 'due30' : 'ok';
  return { state, next };
}

/** 거래처 값 = 계약들 중 가장 급한 것(해지·만료 계약은 안 봄). 같은 급이면 더 이른 날짜 */
export function clientRenewal(contracts: RenewalContract[], today: string): { state: RenewalStateKey; next: string | null } {
  let best: { state: RenewalStateKey; next: string | null } = { state: 'nodate', next: null };
  for (const c of contracts) {
    if (DONE_CONTRACT.has(c.status)) continue;
    const r = contractRenewal(c, today);
    if (RANK[r.state] > RANK[best.state] || (RANK[r.state] === RANK[best.state] && r.next && best.next && r.next < best.next)) best = r;
  }
  return best;
}

/**
 * "갱신 처리" — current 를 term(월 구독 1개월 / 연 구독·비면 1년)만큼 뒤로.
 * 시트 날짜가 안 고쳐진 채 오래 지난 경우를 위해 오늘보다 뒤가 될 때까지 같은 간격으로 더함.
 * current 가 없거나 못 읽으면 null(호출하는 쪽이 알림).
 */
export function nextRenewDate(current: string | null, term: '' | 'monthly' | 'yearly', today: string): string | null {
  if (!current || !parse(current)) return null;
  const step = term === 'monthly' ? 1 : 12;
  let next = addMonthsYmd(current, step);
  for (let i = 1; next <= today && i < 1200; i++) next = addMonthsYmd(current, step * (i + 1));
  return next;
}
