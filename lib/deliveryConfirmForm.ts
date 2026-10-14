/**
 * 정식 납품 확인서 — 구 "확인서리스트" 구글시트에서 업체명+날짜별로 쌓이던 개별 탭
 * (예: "대호건축1013")을 대체합니다. app/confirmForm/actions.ts가 'use server'라
 * 상수/타입만 내보내는 파일을 못 써서(lib/confirmForm.ts와 동일한 이유) 분리합니다.
 */
import { CATEGORIES } from './types';

/** IT재고 5개 품목 + 복합기(IT재고에는 없는 별도 렌탈 품목) */
export const DELIVERY_FORM_CATEGORIES = [...CATEGORIES, '복합기'] as const;

export type DeliveryFormUnit = {
  assetId: string;
  serialNumber: string;
};

export type DeliveryFormItem = {
  category: string; // DELIVERY_FORM_CATEGORIES 중 하나
  model: string; // 품목명
  manufacturer: string; // 제조사
  hardwareSpec: string; // 하드웨어스펙(자유 텍스트, 줄바꿈 허용)
  unitPrice: string; // 임대료/단가(선택)
  quantity: number;
  units: DeliveryFormUnit[]; // length === quantity
};

export type DeliveryConfirmForm = {
  id: string;
  seq: number;
  company: string;
  orderDate: string;
  deliveryDate: string;
  department: string;
  inflowType: string;
  salesManager: string;
  requestManager: string;
  siteAddress: string;
  specialNotes: string;
  businessType: string;
  consumables: string;
  contractPeriod: string;
  deposit: string;
  paymentNotes: string;
  items: DeliveryFormItem[];
  createdAt: string;
};

export type DeliveryConfirmFormRow = {
  id: string;
  seq: number;
  company: string;
  order_date: string | null;
  delivery_date: string | null;
  department: string;
  inflow_type: string;
  sales_manager: string;
  request_manager: string;
  site_address: string;
  special_notes: string;
  business_type: string;
  consumables: string;
  contract_period: string;
  deposit: string;
  payment_notes: string;
  items: DeliveryFormItem[];
  created_at: string;
};

export function rowToDeliveryConfirmForm(row: DeliveryConfirmFormRow): DeliveryConfirmForm {
  return {
    id: row.id,
    seq: row.seq,
    company: row.company,
    orderDate: row.order_date ?? '',
    deliveryDate: row.delivery_date ?? '',
    department: row.department,
    inflowType: row.inflow_type,
    salesManager: row.sales_manager,
    requestManager: row.request_manager,
    siteAddress: row.site_address,
    specialNotes: row.special_notes,
    businessType: row.business_type,
    consumables: row.consumables,
    contractPeriod: row.contract_period,
    deposit: row.deposit,
    paymentNotes: row.payment_notes,
    items: Array.isArray(row.items) ? row.items : [],
    createdAt: row.created_at,
  };
}

export type DeliveryConfirmFormInput = Omit<DeliveryConfirmForm, 'id' | 'seq' | 'createdAt'>;

export function deliveryConfirmFormInputToRow(input: DeliveryConfirmFormInput) {
  return {
    company: input.company,
    order_date: input.orderDate || null,
    delivery_date: input.deliveryDate || null,
    department: input.department,
    inflow_type: input.inflowType,
    sales_manager: input.salesManager,
    request_manager: input.requestManager,
    site_address: input.siteAddress,
    special_notes: input.specialNotes,
    business_type: input.businessType,
    consumables: input.consumables,
    contract_period: input.contractPeriod,
    deposit: input.deposit,
    payment_notes: input.paymentNotes,
    items: input.items,
  };
}

/** 상세보기/인쇄 화면 상단 제목 — 원본 탭 이름 규칙("대호건축1013")과 비슷한 표시용 문자열. */
export function buildDeliveryFormTitle(company: string, deliveryDate: string): string {
  const datePart = deliveryDate ? deliveryDate.replace(/-/g, '').slice(2) : '';
  return [company.trim() || '(상호 미입력)', datePart].filter(Boolean).join(' ');
}

export function blankDeliveryFormItem(): DeliveryFormItem {
  return {
    category: DELIVERY_FORM_CATEGORIES[0],
    model: '',
    manufacturer: '',
    hardwareSpec: '',
    unitPrice: '',
    quantity: 1,
    units: [{ assetId: '', serialNumber: '' }],
  };
}

/** 수량이 바뀌면 units 배열 길이를 맞춥니다 — 늘면 빈 유닛 추가, 줄면 뒤에서부터 제거. */
export function resizeUnits(units: DeliveryFormUnit[], quantity: number): DeliveryFormUnit[] {
  const count = Math.max(Math.trunc(quantity) || 1, 1);
  if (units.length === count) return units;
  if (units.length < count) {
    return [...units, ...Array.from({ length: count - units.length }, () => ({ assetId: '', serialNumber: '' }))];
  }
  return units.slice(0, count);
}
