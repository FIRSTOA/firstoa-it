/**
 * 판매 리스트 — IT재고/입고/출고와 자동 연동되지 않는 별도 대장. 1행 = 1대 기준입니다.
 * lib/dispatch.ts(출고/접수 대장)와 동일한 구조입니다.
 */

export type SaleEntry = {
  id: string;
  seq: number;
  purchaseVendor: string;
  purchasePrice: string;
  salePrice: string;
  model: string;
  spec: string;
  assetId: string;
  serialNumber: string;
  destination: string;
  saleDate: string;
  notes: string;
};

export type SaleRow = {
  id: string;
  seq: number;
  purchase_vendor: string;
  purchase_price: string;
  sale_price: string;
  model: string;
  spec: string;
  asset_id: string;
  serial_number: string;
  destination: string;
  sale_date: string | null;
  notes: string;
};

export function rowToSale(row: SaleRow): SaleEntry {
  return {
    id: row.id,
    seq: row.seq,
    purchaseVendor: row.purchase_vendor,
    purchasePrice: row.purchase_price,
    salePrice: row.sale_price,
    model: row.model,
    spec: row.spec,
    assetId: row.asset_id,
    serialNumber: row.serial_number,
    destination: row.destination,
    saleDate: row.sale_date ?? '',
    notes: row.notes,
  };
}

export type SaleInput = Omit<SaleEntry, 'id' | 'seq'>;

export function saleInputToRow(entry: SaleInput) {
  return {
    purchase_vendor: entry.purchaseVendor,
    purchase_price: entry.purchasePrice,
    sale_price: entry.salePrice,
    model: entry.model,
    spec: entry.spec,
    asset_id: entry.assetId,
    serial_number: entry.serialNumber,
    destination: entry.destination,
    sale_date: entry.saleDate || null,
    notes: entry.notes,
  };
}

export function filterSaleEntries(entries: SaleEntry[], searchTerm: string): SaleEntry[] {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return entries;
  return entries.filter((e) => {
    const hay = `${e.model} ${e.assetId} ${e.serialNumber} ${e.destination} ${e.purchaseVendor} ${e.spec}`.toLowerCase();
    return hay.includes(term);
  });
}
