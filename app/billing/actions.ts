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
