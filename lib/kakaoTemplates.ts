/**
 * 구매입력 화면에서 카톡으로 보낼 문구를 만듭니다. 두 양식 다 순수 문자열 조립이라
 * 서버 의존성이 없고, 클라이언트에서 바로 미리보기를 만들 수 있습니다.
 */

export type PurchaseMessageData = {
  vendor: string;
  department: string;
  manager: string;
  expectedDate: string;
  priceCompared: string;
  deliveryPlace: string;
  category: string;
  model: string;
  quantity: number;
  unitPrice: number;
  currentStock: string;
  safetyStock: string;
};

function fmtWon(n: number): string {
  return `${n.toLocaleString()}원`;
}

/** 매입승인요청(내부) — 사용자가 실제 쓰는 원문 그대로(오타로 보이는 "단기비교"도 그대로 둠). */
export function buildApprovalRequestText(d: PurchaseMessageData): string {
  const total = d.quantity * d.unitPrice;
  return [
    '매입승인요청합니다',
    '',
    `매입처: ${d.vendor}`,
    `주문요청부서 : ${d.department}`,
    `품목: ${d.model}`,
    `수량: ${d.quantity}`,
    `단가: ${fmtWon(d.unitPrice)}`,
    `총합금액: ${fmtWon(total)}`,
    `현재고수량: ${d.currentStock}`,
    `안전재고수량: ${d.safetyStock}`,
    `단기비교:  ${d.priceCompared}`,
    `입고예정일  ${d.expectedDate}`,
    '승인후 입고방 전달완료',
  ].join('\n');
}

/** 발주서(매입처 발송용) — 매입승인요청과 비슷한 구조의 초안. */
export function buildOrderRequestText(d: PurchaseMessageData): string {
  const total = d.quantity * d.unitPrice;
  return [
    '발주요청드립니다',
    '',
    '발주처: (주)퍼스트전산',
    `주문담당자: ${d.manager}`,
    `품목: ${d.model}`,
    `수량: ${d.quantity}`,
    `단가: ${fmtWon(d.unitPrice)}`,
    `총합금액: ${fmtWon(total)}`,
    `입고요청일: ${d.expectedDate}`,
    `납품처: ${d.deliveryPlace}`,
    '',
    '확인 후 회신 부탁드립니다.',
  ].join('\n');
}

export type PurchaseMessageHeader = {
  vendor: string;
  department: string;
  manager: string;
  expectedDate: string;
  priceCompared: string;
  deliveryPlace: string;
};

export type PurchaseMessageLine = {
  category: string;
  model: string;
  quantity: number;
  unitPrice: number;
  currentStock: string;
  safetyStock: string;
};

/**
 * 같은 매입처의 여러 품목을 한 번에 보낼 때 씁니다(건건히 복사하기 번거롭다는 요청으로 추가).
 * 공통 항목(매입처/부서/입고예정일 등)은 한 번만, 품목별 항목은 번호를 매겨 나열하고
 * 끝에 전체 합계를 붙입니다.
 */
export function buildApprovalRequestTextMulti(h: PurchaseMessageHeader, lines: PurchaseMessageLine[]): string {
  if (lines.length === 1) return buildApprovalRequestText({ ...h, ...lines[0] });

  const grandTotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const itemBlocks = lines.map((l, i) => {
    const total = l.quantity * l.unitPrice;
    return [
      `${i + 1}. 품목: ${l.model}`,
      `   수량: ${l.quantity}`,
      `   단가: ${fmtWon(l.unitPrice)}`,
      `   금액: ${fmtWon(total)}`,
      `   현재고수량: ${l.currentStock}`,
      `   안전재고수량: ${l.safetyStock}`,
    ].join('\n');
  });

  return [
    '매입승인요청합니다',
    '',
    `매입처: ${h.vendor}`,
    `주문요청부서 : ${h.department}`,
    '',
    ...itemBlocks,
    '',
    `총합금액: ${fmtWon(grandTotal)}`,
    `단기비교:  ${h.priceCompared}`,
    `입고예정일  ${h.expectedDate}`,
    '승인후 입고방 전달완료',
  ].join('\n');
}

/** buildOrderRequestText의 여러 품목 버전 — buildApprovalRequestTextMulti와 동일한 구성. */
export function buildOrderRequestTextMulti(h: PurchaseMessageHeader, lines: PurchaseMessageLine[]): string {
  if (lines.length === 1) return buildOrderRequestText({ ...h, ...lines[0] });

  const grandTotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const itemBlocks = lines.map((l, i) => {
    const total = l.quantity * l.unitPrice;
    return [
      `${i + 1}. 품목: ${l.model}`,
      `   수량: ${l.quantity}`,
      `   단가: ${fmtWon(l.unitPrice)}`,
      `   금액: ${fmtWon(total)}`,
    ].join('\n');
  });

  return [
    '발주요청드립니다',
    '',
    '발주처: (주)퍼스트전산',
    `주문담당자: ${h.manager}`,
    '',
    ...itemBlocks,
    '',
    `총합금액: ${fmtWon(grandTotal)}`,
    `입고요청일: ${h.expectedDate}`,
    `납품처: ${h.deliveryPlace}`,
    '',
    '확인 후 회신 부탁드립니다.',
  ].join('\n');
}
