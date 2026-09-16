/**
 * 입고 대장 (구매입고예정 / 렌탈입고예정). 1행 = 1대 기준입니다 — 여러 대를 구매할 땐
 * 등록 화면에서 수량만큼 행을 여러 개 만듭니다(수량 자체는 저장하지 않음).
 * lib/dispatch.ts(출고/접수 대장)와 동일한 구조입니다.
 */

export const RECEIVING_KINDS = ['구매입고예정', '렌탈입고예정'] as const;
export const RECEIVING_STATUSES = ['입고대기', '입고완료', '취소'] as const;

export type ReceivingEntry = {
  id: string;
  seq: number;
  kind: string;
  status: string;
  category: string;
  brand: string;
  model: string;
  cpu: string;
  spec: string;
  ram: string;
  storage: string;
  screen: string;
  vendor: string;
  expectedDate: string;
  manager: string;
  notes: string;
  assetId: string;
  serialNumber: string;
  location: string;
  completedAt: string | null;
};

export type ReceivingRow = {
  id: string;
  seq: number;
  kind: string;
  status: string;
  category: string;
  brand: string;
  model: string;
  cpu: string;
  spec: string;
  ram: string;
  storage: string;
  screen: string;
  vendor: string;
  expected_date: string | null;
  manager: string;
  notes: string;
  asset_id: string;
  serial_number: string;
  location: string;
  completed_at: string | null;
};

export function rowToReceiving(row: ReceivingRow): ReceivingEntry {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    status: row.status,
    category: row.category,
    brand: row.brand,
    model: row.model,
    cpu: row.cpu,
    spec: row.spec,
    ram: row.ram,
    storage: row.storage,
    screen: row.screen,
    vendor: row.vendor,
    expectedDate: row.expected_date ?? '',
    manager: row.manager,
    notes: row.notes,
    assetId: row.asset_id,
    serialNumber: row.serial_number,
    location: row.location,
    completedAt: row.completed_at,
  };
}

export type ReceivingInput = Omit<ReceivingEntry, 'id' | 'seq' | 'completedAt'>;

export function receivingInputToRow(entry: ReceivingInput) {
  return {
    kind: entry.kind,
    status: entry.status,
    category: entry.category,
    brand: entry.brand,
    model: entry.model,
    cpu: entry.cpu,
    spec: entry.spec,
    ram: entry.ram,
    storage: entry.storage,
    screen: entry.screen,
    vendor: entry.vendor,
    expected_date: entry.expectedDate || null,
    manager: entry.manager,
    notes: entry.notes,
    asset_id: entry.assetId,
    serial_number: entry.serialNumber,
    location: entry.location,
  };
}

export type ReceivingFilters = {
  kind: string | null;
  status: string | null;
  category: string | null;
};

export const EMPTY_RECEIVING_FILTERS: ReceivingFilters = { kind: null, status: null, category: null };

export function filterReceivingEntries(
  entries: ReceivingEntry[],
  filters: ReceivingFilters,
  searchTerm: string,
): ReceivingEntry[] {
  const term = searchTerm.trim().toLowerCase();
  return entries.filter((e) => {
    if (filters.kind && e.kind !== filters.kind) return false;
    if (filters.status && e.status !== filters.status) return false;
    if (filters.category && e.category !== filters.category) return false;
    if (term) {
      const hay = `${e.assetId} ${e.model} ${e.brand} ${e.vendor}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

/** 입고완료 처리에 필요한 필수값이 다 채워졌는지 확인합니다 (품목/브랜드/모델명/자산번호/위치). */
export function missingRequiredFields(entry: ReceivingEntry): string[] {
  const missing: string[] = [];
  if (!entry.category.trim()) missing.push('품목');
  if (!entry.brand.trim()) missing.push('브랜드');
  if (!entry.model.trim()) missing.push('모델명');
  if (!entry.assetId.trim()) missing.push('자산번호');
  if (!entry.location.trim()) missing.push('위치');
  return missing;
}
