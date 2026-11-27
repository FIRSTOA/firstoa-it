/** 다음 영업일(주말 건너뜀, 공휴일은 모름) — 순수(서버·화면 둘 다). 오늘 준비하는 건 다음 영업일 출고분. */
export function nextBusinessDay(ymd: string): string {
  const [y, m, day] = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
