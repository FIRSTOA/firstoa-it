/**
 * 장비별 임대·청구 추적. "임대 건"은 별도 테이블이 아니라 기존 it_rental_list(임대리스트
 * 시트 사본)의 한 행을 그대로 씁니다 — 그 시트가 이미 거래처가 바뀔 때마다 같은 자산번호로
 * 새 행이 쌓이는 "임대 건" 단위입니다. 이 파일은 청구 명세(it_billing_lines)와 구매단가
 * 오버레이(it_asset_purchase_info)만 다룹니다.
 */

export const BILLING_STATUSES = ['확정', '취소', '조정'] as const;

export type BillingLine = {
  id: string;
  seq: number;
  sourceInvoiceId: string;
  sourceLineId: string;
  assetId: string | null;
  rentalSheetRow: number | null;
  vendorName: string;
  billingDate: string; // YYYY-MM-DD
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: string; // '확정' | '취소' | '조정'
  allocationStatus: 'confirmed' | 'needs_review';
  note: string;
  createdAt: string;
};

export type BillingLineRow = {
  id: string;
  seq: number;
  source_invoice_id: string;
  source_line_id: string;
  asset_id: string | null;
  rental_sheet_row: number | null;
  vendor_name: string;
  billing_date: string | null;
  period_start: string | null;
  period_end: string | null;
  amount: number;
  status: string;
  allocation_status: string;
  note: string;
  created_at: string;
};

export function rowToBillingLine(row: BillingLineRow): BillingLine {
  return {
    id: row.id,
    seq: row.seq,
    sourceInvoiceId: row.source_invoice_id,
    sourceLineId: row.source_line_id,
    assetId: row.asset_id,
    rentalSheetRow: row.rental_sheet_row,
    vendorName: row.vendor_name,
    billingDate: row.billing_date ?? '',
    periodStart: row.period_start ?? '',
    periodEnd: row.period_end ?? '',
    amount: Number(row.amount) || 0,
    status: row.status,
    allocationStatus: row.allocation_status === 'needs_review' ? 'needs_review' : 'confirmed',
    note: row.note,
    createdAt: row.created_at,
  };
}

export type BillingLineInput = {
  sourceInvoiceId: string;
  sourceLineId: string;
  assetId: string | null;
  rentalSheetRow: number | null;
  vendorName: string;
  billingDate: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: string;
  allocationStatus: 'confirmed' | 'needs_review';
  note: string;
};

export function billingLineInputToRow(input: BillingLineInput) {
  return {
    source_invoice_id: input.sourceInvoiceId.trim(),
    source_line_id: input.sourceLineId.trim(),
    asset_id: input.assetId ? input.assetId.trim() : null,
    rental_sheet_row: input.rentalSheetRow,
    vendor_name: input.vendorName.trim(),
    billing_date: input.billingDate || null,
    period_start: input.periodStart || null,
    period_end: input.periodEnd || null,
    amount: input.amount,
    status: input.status,
    allocation_status: input.allocationStatus,
    note: input.note.trim(),
  };
}

/**
 * 누적 청구액 = 취소를 뺀, 배분이 확정된 확정+조정 금액의 순액.
 * (조정은 보통 음수 — 감액 한 번을 별도 행으로 반영하는 방식, 요청 시나리오 그대로)
 */
export function sumConfirmedBilling(lines: BillingLine[]): number {
  return lines
    .filter((l) => l.status !== '취소' && l.allocationStatus === 'confirmed')
    .reduce((sum, l) => sum + l.amount, 0);
}

export type RecoveryRateResult =
  | { kind: 'ok'; ratePercent: number; totalBilled: number }
  | { kind: 'no_price' } // 구매단가 미입력
  | { kind: 'zero_price' } // 회수율 산정 불가(구매단가 0원)
  | { kind: 'no_billing' }; // 청구 미확인(청구 라인이 전혀 없음)

export function computeRecoveryRate(purchasePrice: number | null, lines: BillingLine[]): RecoveryRateResult {
  const confirmedLines = lines.filter((l) => l.allocationStatus === 'confirmed');
  const totalBilled = sumConfirmedBilling(lines);

  if (purchasePrice === null || Number.isNaN(purchasePrice)) return { kind: 'no_price' };
  if (purchasePrice === 0) return { kind: 'zero_price' };
  if (confirmedLines.length === 0) return { kind: 'no_billing' };

  return { kind: 'ok', ratePercent: (totalBilled / purchasePrice) * 100, totalBilled };
}

// ── 구매단가/구입처 오버레이 ──────────────────────────────────────

export type AssetPurchaseInfo = {
  assetId: string;
  purchasePrice: number | null;
  purchaseVendor: string;
  note: string;
  updatedBy: string;
  updatedAt: string;
};

export type AssetPurchaseInfoRow = {
  asset_id: string;
  purchase_price: number | null;
  purchase_vendor: string;
  note: string;
  updated_by: string;
  updated_at: string;
};

export function rowToAssetPurchaseInfo(row: AssetPurchaseInfoRow): AssetPurchaseInfo {
  return {
    assetId: row.asset_id,
    purchasePrice: row.purchase_price === null || row.purchase_price === undefined ? null : Number(row.purchase_price),
    purchaseVendor: row.purchase_vendor,
    note: row.note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

// ── 임대 건(it_rental_list 재사용) ─────────────────────────────────

export type RentalHistoryEntry = {
  sheetRow: number;
  /** firstoa-works에 같은 임대 건이 중복 행으로 있는 경우 묶인 행 전체 */
  sheetRows: number[];
  vendorName: string;
  siteName: string;
  contractDate: string;
  endDate: string;
  status: string;
  baseAmount: number | null; // 기본금액(월)
  firstContractDate: string; // 첫계약일
  entryDate: string; // 입력일 — 임대종료 건은 철수된 날짜
  removalDate: string;
};

/** it_rental_list 행들을 임대 건(거래처+현장+계약일) 단위로 묶습니다. */
export function groupRentalRows(rows: Record<string, unknown>[]): RentalHistoryEntry[] {
  const s = (v: unknown) => String(v ?? '').trim();
  const map = new Map<string, RentalHistoryEntry>();
  for (const r of rows) {
    const key = `${s(r.vendor_name)}|${s(r.site_name)}|${s(r.contract_date)}`;
    const base = Number(String(r.base_amount ?? '').replace(/[^0-9.-]/g, ''));
    const existing = map.get(key);
    if (existing) {
      existing.sheetRows.push(r.sheet_row as number);
      existing.endDate ||= s(r.end_date);
      existing.entryDate ||= s(r.entry_date);
      existing.removalDate ||= s(r.removal_date);
      existing.firstContractDate ||= s(r.first_contract_date);
      if (existing.baseAmount === null && s(r.base_amount) && Number.isFinite(base)) existing.baseAmount = base;
      continue;
    }
    map.set(key, {
      sheetRow: r.sheet_row as number,
      sheetRows: [r.sheet_row as number],
      vendorName: s(r.vendor_name),
      siteName: s(r.site_name),
      contractDate: s(r.contract_date),
      endDate: s(r.end_date),
      status: s(r.status),
      baseAmount: s(r.base_amount) && Number.isFinite(base) ? base : null,
      firstContractDate: s(r.first_contract_date),
      entryDate: s(r.entry_date),
      removalDate: s(r.removal_date),
    });
  }
  return [...map.values()];
}

export type RentalTerm = {
  start: string;
  end: string; // 진행중이면 ''
  months: number;
  baseAmount: number | null;
  total: number | null; // 개월수 × 기본금액
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseYmd(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

/**
 * 계약 기준 임대 기간·청구액. 시작 = 첫계약일(없으면 계약일), 끝 = 임대종료 건은 입력일
 * (임대리스트에 철수가 기록된 날, 없으면 철수일/종료일), 진행 중이면 오늘까지.
 * 개월수 = 일수 ÷ 30.4를 반올림(최소 1개월) — 예: 11/27~12/16 → 1개월, 4/10~7/23 → 3개월.
 */
export function computeRentalTerm(r: RentalHistoryEntry, today = new Date()): RentalTerm {
  const start = r.firstContractDate || r.contractDate;
  const ended = r.status.includes('종료');
  const end = ended ? r.entryDate || r.removalDate || r.endDate : '';
  const startDate = parseYmd(start);
  const endDate = end ? parseYmd(end) : new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  let months = 0;
  if (startDate && endDate && endDate >= startDate) {
    months = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS / 30.4));
  }
  const total = r.baseAmount !== null && months > 0 ? months * r.baseAmount : null;
  return { start, end, months, baseAmount: r.baseAmount, total };
}
