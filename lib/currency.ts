/**
 * "154만원", "3억5000만" 같은 한글 축약 표기를 실제 숫자로 바꿔서 "1,540,000원" 형식으로
 * 통일합니다. 입고/판매 금액란에 사람이 편하게 입력해도(예: "220만원") 저장은 항상 같은
 * 콤마 형식으로 남아야 나중에 통계(합계/평균)를 낼 때 다시 쉽게 파싱할 수 있습니다.
 *
 * "대당 220만원(vat별도)"처럼 숫자 외에 다른 말이 섞여 있으면 그 의미(단가/부가세 등)를
 * 잃을 수 있어서 변환하지 않고 원문 그대로 둡니다 — 순수하게 금액만 적었을 때만 정규화합니다.
 */

export function parseKoreanWon(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // 순수 숫자(콤마 허용) + 선택적 "원": "1,540,000원", "1540000"
  const plain = s.match(/^([\d,]+)\s*원?$/);
  if (plain) {
    const n = Number(plain[1].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // 억/만 축약: "3억5000만원", "220만원", "3억", "154.5만"
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*억)?\s*(?:(\d+(?:\.\d+)?)\s*만)?\s*원?$/);
  if (m && (m[1] || m[2])) {
    const eok = m[1] ? parseFloat(m[1]) * 100_000_000 : 0;
    const man = m[2] ? parseFloat(m[2]) * 10_000 : 0;
    const total = Math.round(eok + man);
    return total > 0 ? total : null;
  }

  return null;
}

export function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

/** 인식되면 정규화된 형식으로, 아니면(다른 말이 섞여있으면) 원문 그대로 돌려줍니다. */
export function normalizeWonInput(raw: string): string {
  const n = parseKoreanWon(raw);
  return n !== null ? formatWon(n) : raw;
}
