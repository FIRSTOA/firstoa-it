/**
 * 직송 판정(4-0, F28) — 순수(import 없음, 화면·서버 둘 다 씀).
 * 영업 웹앱 lib/statusRow.ts `statusDeliverer`(현황표 '납품담당')와 같은 규칙:
 *  위탁사(consign)가 없으면 직송 아님(퍼스트가 준비). 있으면 위탁·직송 칸(shipType)이 있을 때 '직송' 여부,
 *  그 칸이 비면 앞머리글(head)에 '직송'이 들어 있는지.
 */
export interface DeliveryModeInput {
  consign?: unknown;
  shipType?: unknown;
  head?: unknown;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** 위탁사(매입처) 이름 — 없으면 '' */
export function consignOf(d: DeliveryModeInput | null | undefined): string {
  return s(d?.consign).trim();
}

/** 직송이면 true(영업 statusDeliverer 의 direct 와 같음) */
export function isDirectShip(d: DeliveryModeInput | null | undefined): boolean {
  if (!consignOf(d)) return false;
  const ship = s(d?.shipType); // 영업은 trim 없이 truthy 로 비교 — 그대로
  return ship ? ship === '직송' : /직송/.test(s(d?.head));
}

/**
 * 위탁·직송 세 칸이 payload 어디에 있어도 읽음 — doc 안(교체·유지보수·소프트웨어, 납품도 doc 이 있으면) 먼저, 없으면 맨 위.
 * 칸마다 따로 고르지 않고 "consign 이 있는 쪽" 한 곳만 씀(두 곳 값이 섞이지 않게).
 */
export function deliveryModeFromPayload(payload: unknown): { directShip: boolean; consignName: string } {
  const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const top = obj(payload);
  const doc = obj(top?.doc);
  const src = consignOf(doc) ? doc : top;
  return { directShip: isDirectShip(src), consignName: consignOf(src) };
}
