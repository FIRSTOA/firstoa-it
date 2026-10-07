/**
 * 소모품 가격표 — 구글시트 "소모품구매판매" 탭을 그대로 읽고 씁니다(재고 시트와 동일한
 * 패턴). 가격 관련 값은 시트에 이미 "₩ 14,520" 같은 형식 문자열로 들어있어서, 이 프로젝트
 * 전반의 관례대로 숫자로 파싱하지 않고 자유 텍스트 그대로 다룹니다.
 */
export type ConsumableItem = {
  rowNumber: number; // 시트 상의 실제 1-based 행 번호. 수정/삭제 시 이 행을 찾는 키로 씁니다.
  gubun: string; // 구분
  spec: string; // 사양
  vendor: string; // 매입처
  purchasePrice: string; // 구매단가
  item: string; // 품목
  model: string; // 모델명
  manufacturer: string; // 제조사
  salePrice: string; // 판매단가
  margin: string; // 마진
  internetPrice: string; // 인터넷가격
};

export type ConsumableInput = Omit<ConsumableItem, 'rowNumber'>;

export const BLANK_CONSUMABLE: ConsumableInput = {
  gubun: '',
  spec: '',
  vendor: '',
  purchasePrice: '',
  item: '',
  model: '',
  manufacturer: '',
  salePrice: '',
  margin: '',
  internetPrice: '',
};

/** "₩ 18,480"처럼 원화 기호/콤마/공백이 섞인 값에서 숫자만 뽑습니다(통계용 엄격 파싱과 달리
 * 여기선 마진 계산용으로 쓰기 좋게 느슨하게 받습니다). */
function parsePriceLoose(raw: string): number | null {
  const digits = raw.replace(/[^\d.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 마진 = (판매단가 - 구매단가) / 구매단가 * 100, "26.08%" 형식. 둘 다 숫자로 못 읽으면 빈 문자열. */
export function computeMarginPercent(purchasePrice: string, salePrice: string): string {
  const buy = parsePriceLoose(purchasePrice);
  const sell = parsePriceLoose(salePrice);
  if (buy === null || sell === null) return '';
  const margin = ((sell - buy) / buy) * 100;
  return `${margin.toFixed(2)}%`;
}

export function filterConsumables(items: ConsumableItem[], searchTerm: string): ConsumableItem[] {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return items;
  return items.filter((c) => {
    const hay = `${c.gubun} ${c.spec} ${c.vendor} ${c.item} ${c.model} ${c.manufacturer}`.toLowerCase();
    return hay.includes(term);
  });
}
