'use server';

import { revalidatePath } from 'next/cache';
import {
  billingLineInputToRow,
  rowToAssetPurchaseInfo,
  rowToBillingLine,
  type AssetPurchaseInfo,
  type AssetPurchaseInfoRow,
  type BillingLine,
  type BillingLineInput,
  type BillingLineRow,
  type RentalHistoryEntry,
} from '@/lib/billing';
import {
  ASSET_PURCHASE_INFO_TABLE,
  BILLING_LINES_TABLE,
  RENTAL_TABLE,
  createAdminClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '42P01') return '테이블이 없어요. supabase/billing_schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
}

// ── 구매단가/구입처 오버레이 ──────────────────────────────────────

export async function getAssetPurchaseInfo(assetId: string): Promise<AssetPurchaseInfo | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(ASSET_PURCHASE_INFO_TABLE)
    .select('*')
    .eq('asset_id', assetId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToAssetPurchaseInfo(data as AssetPurchaseInfoRow);
}

/** asset_id 배열로 한 번에 조회 — app/page.tsx가 전체 재고 목록에 덮어쓸 때 씁니다. */
export async function listAssetPurchaseInfoMap(): Promise<Map<string, AssetPurchaseInfo>> {
  if (!isSupabaseConfigured()) return new Map();
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(ASSET_PURCHASE_INFO_TABLE).select('*');
  if (error || !data) return new Map();
  const map = new Map<string, AssetPurchaseInfo>();
  for (const row of data as AssetPurchaseInfoRow[]) {
    map.set(row.asset_id, rowToAssetPurchaseInfo(row));
  }
  return map;
}

export async function upsertAssetPurchaseInfo(
  assetId: string,
  purchaseVendor: string,
  purchasePriceRaw: string,
  updatedBy = '',
): Promise<ActionResult> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호가 없어요.' };

  const priceDigits = purchasePriceRaw.replace(/[^0-9.]/g, '');
  const purchasePrice = priceDigits === '' ? null : Number(priceDigits);
  if (purchasePrice !== null && Number.isNaN(purchasePrice)) {
    return { ok: false, error: '구매단가는 숫자로 입력해주세요.' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from(ASSET_PURCHASE_INFO_TABLE).upsert(
    {
      asset_id: trimmed,
      purchase_price: purchasePrice,
      purchase_vendor: purchaseVendor.trim(),
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'asset_id' },
  );
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/');
  return { ok: true };
}

// ── 임대 건(it_rental_list 재사용, 읽기 전용) ───────────────────────

export async function getAssetRentalHistory(assetId: string): Promise<RentalHistoryEntry[]> {
  const trimmed = assetId.trim();
  if (!trimmed || !isSupabaseConfigured()) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(RENTAL_TABLE)
    .select('sheet_row, vendor_name, site_name, contract_date, end_date, status')
    .eq('asset_code', trimmed)
    .order('contract_date', { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    sheetRow: r.sheet_row as number,
    vendorName: r.vendor_name as string,
    siteName: r.site_name as string,
    contractDate: r.contract_date as string,
    endDate: r.end_date as string,
    status: r.status as string,
  }));
}

// ── 청구 명세 ────────────────────────────────────────────────────

export async function getAssetBillingLines(assetId: string): Promise<BillingLine[]> {
  const trimmed = assetId.trim();
  if (!trimmed || !isSupabaseConfigured()) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(BILLING_LINES_TABLE)
    .select('*')
    .eq('asset_id', trimmed)
    .order('billing_date', { ascending: true });
  if (error || !data) return [];
  return (data as BillingLineRow[]).map(rowToBillingLine);
}

export type BillingListFilters = {
  searchTerm: string;
  needsReviewOnly: boolean;
};

export async function listBillingLines(filters: BillingListFilters): Promise<BillingLine[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = createAdminClient();
  let query = supabase.from(BILLING_LINES_TABLE).select('*').order('created_at', { ascending: false }).limit(500);
  if (filters.needsReviewOnly) query = query.eq('allocation_status', 'needs_review');
  if (filters.searchTerm.trim()) {
    const term = `%${filters.searchTerm.trim()}%`;
    query = query.or(`asset_id.ilike.${term},vendor_name.ilike.${term},source_invoice_id.ilike.${term}`);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as BillingLineRow[]).map(rowToBillingLine);
}

function validate(input: BillingLineInput): string | null {
  if (!input.assetId && input.allocationStatus === 'confirmed') {
    return '자산번호가 없으면 "배분 확인 필요" 상태로만 저장할 수 있어요.';
  }
  if (!input.billingDate) return '청구일은 필수예요.';
  if (!Number.isFinite(input.amount) || input.amount === 0) return '금액을 입력해주세요.';
  return null;
}

export async function createBillingLine(input: BillingLineInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(BILLING_LINES_TABLE).insert(billingLineInputToRow(input));
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/billing');
  revalidatePath('/');
  return { ok: true };
}

export async function updateBillingLine(id: string, input: BillingLineInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(BILLING_LINES_TABLE).update(billingLineInputToRow(input)).eq('id', id);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/billing');
  revalidatePath('/');
  return { ok: true };
}

export async function deleteBillingLine(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(BILLING_LINES_TABLE).delete().eq('id', id);
  if (error) return { ok: false, error: `삭제에 실패했어요: ${error.message}` };

  revalidatePath('/billing');
  revalidatePath('/');
  return { ok: true };
}

/** 자산번호+거래처+청구일로 it_rental_list에서 임대 건을 특정합니다. 1건이면 확정, 아니면 null(배분 확인 필요). */
async function matchRentalSheetRow(
  supabase: ReturnType<typeof createAdminClient>,
  assetId: string,
  vendorName: string,
  billingDate: string,
): Promise<number | null> {
  if (!assetId) return null;
  const { data, error } = await supabase
    .from(RENTAL_TABLE)
    .select('sheet_row, vendor_name, contract_date, end_date')
    .eq('asset_code', assetId);
  if (error || !data || data.length === 0) return null;

  const vendorNorm = vendorName.replace(/\s+/g, '');
  const candidates = data.filter((r) => {
    const rowVendor = String(r.vendor_name ?? '').replace(/\s+/g, '');
    if (vendorNorm && rowVendor && !rowVendor.includes(vendorNorm) && !vendorNorm.includes(rowVendor)) return false;
    const start = String(r.contract_date ?? '');
    const end = String(r.end_date ?? '');
    if (billingDate && start && billingDate < start) return false;
    if (billingDate && end && billingDate > end) return false;
    return true;
  });

  return candidates.length === 1 ? (candidates[0].sheet_row as number) : null;
}

export type ImportBillingRow = {
  sourceInvoiceId: string;
  sourceLineId: string;
  assetId: string;
  vendorName: string;
  billingDate: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: string;
};

export type ImportResult =
  | { ok: true; upserted: number; needsReview: number }
  | { ok: false; error: string };

/** 엑셀 업로드 — (청구번호, 행식별자) 기준 upsert라 같은 파일을 다시 올려도 중복 합산되지 않습니다. */
export async function importBillingLines(rows: ImportBillingRow[]): Promise<ImportResult> {
  if (rows.length === 0) return { ok: false, error: '가져올 행이 없어요.' };

  const supabase = createAdminClient();
  let needsReview = 0;
  const payload = [];

  for (const r of rows) {
    const assetId = r.assetId.trim() || null;
    let rentalSheetRow: number | null = null;
    let allocationStatus: 'confirmed' | 'needs_review' = 'needs_review';

    if (assetId) {
      rentalSheetRow = await matchRentalSheetRow(supabase, assetId, r.vendorName, r.billingDate);
      allocationStatus = rentalSheetRow !== null ? 'confirmed' : 'needs_review';
    }
    if (allocationStatus === 'needs_review') needsReview++;

    payload.push(
      billingLineInputToRow({
        sourceInvoiceId: r.sourceInvoiceId,
        sourceLineId: r.sourceLineId,
        assetId,
        rentalSheetRow,
        vendorName: r.vendorName,
        billingDate: r.billingDate,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        amount: r.amount,
        status: r.status || '확정',
        allocationStatus,
        note: '',
      }),
    );
  }

  // 청구번호/행식별자가 둘 다 있는 행만 upsert 멱등성 대상 — 없는 행은 매번 새로 insert.
  const withKey = payload.filter((p) => p.source_invoice_id && p.source_line_id);
  const withoutKey = payload.filter((p) => !p.source_invoice_id || !p.source_line_id);

  if (withKey.length > 0) {
    const { error } = await supabase.from(BILLING_LINES_TABLE).upsert(withKey, { onConflict: 'source_invoice_id,source_line_id' });
    if (error) return { ok: false, error: toMessage(error) };
  }
  if (withoutKey.length > 0) {
    const { error } = await supabase.from(BILLING_LINES_TABLE).insert(withoutKey);
    if (error) return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/billing');
  revalidatePath('/');
  return { ok: true, upserted: payload.length, needsReview };
}

/** "배분 확인 필요" 행을 사람이 직접 자산번호/임대 건으로 확정합니다. */
export async function resolveBillingAllocation(
  id: string,
  assetId: string,
  rentalSheetRow: number | null,
): Promise<ActionResult> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호를 입력해주세요.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from(BILLING_LINES_TABLE)
    .update({ asset_id: trimmed, rental_sheet_row: rentalSheetRow, allocation_status: 'confirmed' })
    .eq('id', id);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/billing');
  revalidatePath('/');
  return { ok: true };
}
