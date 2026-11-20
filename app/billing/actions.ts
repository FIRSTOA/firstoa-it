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
  groupRentalRows,
} from '@/lib/billing';
import {
  WORKS_LINE_SOURCE,
  assignedRentalRowsForAsset,
  buildAllocationReview,
  isAssignmentsTableMissing,
} from '@/lib/billingAllocation';
import type { AllocationReview } from '@/lib/billingAllocationTypes';
import { listAllAssets } from '@/lib/inventory/sheets';
import {
  ASSET_PURCHASE_INFO_TABLE,
  BILLING_LINES_TABLE,
  RENTAL_ASSET_ASSIGNMENTS_TABLE,
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
  // 자산번호를 직접 지정한 임대 건(works 자산번호가 빈 건)도 포함 — 행 번호는 정수만 들어가므로 .or() 에 안전
  const assignedRows = (await assignedRentalRowsForAsset(trimmed)).filter((n) => Number.isInteger(n));
  // select('*') — base_amount 등 추가 컬럼 SQL을 아직 안 돌린 DB에서도 깨지지 않게.
  let query = supabase.from(RENTAL_TABLE).select('*');
  if (assignedRows.length > 0 && /^[A-Za-z0-9._-]+$/.test(trimmed)) {
    query = query.or(`asset_code.eq.${trimmed},sheet_row.in.(${assignedRows.join(',')})`);
  } else {
    query = query.eq('asset_code', trimmed);
  }
  const { data, error } = await query.order('contract_date', { ascending: true });
  if (error || !data) return [];
  return groupRentalRows(data as Record<string, unknown>[]);
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
  // 임대 건 지정(confirmRentalAllocation)과 같이 대문자로 — 반영 규칙 ③이 이 값을 그대로 유지하므로
  const trimmed = assetId.trim().toUpperCase();
  if (!trimmed) return { ok: false, error: '자산번호를 입력해주세요.' };

  const supabase = createAdminClient();
  const { data: current, error: readError } = await supabase
    .from(BILLING_LINES_TABLE)
    .select('source_invoice_id, rental_sheet_row')
    .eq('id', id)
    .maybeSingle();
  if (readError) return { ok: false, error: toMessage(readError) };
  if (current && current.source_invoice_id === WORKS_LINE_SOURCE && current.rental_sheet_row !== null) {
    return { ok: false, error: '임대 건으로 확인 화면에서 지정해 주세요' };
  }
  const { error } = await supabase
    .from(BILLING_LINES_TABLE)
    .update({ asset_id: trimmed, rental_sheet_row: rentalSheetRow, allocation_status: 'confirmed' })
    .eq('id', id);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/billing');
  revalidatePath('/');
  revalidatePath('/home');
  return { ok: true };
}

// ── 임대 건 단위 자산번호 지정 ──────────────────────────────────────

const SQL_FIRST = 'Supabase SQL Editor에서 supabase/rental_asset_assignments_schema.sql 을 먼저 실행해 주세요';

function revalidateAll() {
  revalidatePath('/billing');
  revalidatePath('/');
  revalidatePath('/home');
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류';
}

export async function getAllocationReview(): Promise<{ ok: true; data: AllocationReview } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 설정이 필요해요.' };
  try {
    return { ok: true, data: await buildAllocationReview() };
  } catch (err) {
    return { ok: false, error: `불러오지 못했어요: ${errText(err)}` };
  }
}

type OneResult = { ok: true; lines: number } | { ok: false; error: string; tableMissing?: boolean };

async function confirmOne(rentalSheetRow: number, rawAssetId: string, assignedBy: string): Promise<OneResult> {
  const assetId = String(rawAssetId ?? '').trim().toUpperCase();
  if (!assetId) return { ok: false, error: '자산번호를 입력해주세요.' };
  if (!Number.isInteger(rentalSheetRow)) return { ok: false, error: '임대 건 번호가 올바르지 않아요.' };

  const supabase = createAdminClient();
  const { data: rental, error: rentalError } = await supabase
    .from(RENTAL_TABLE)
    .select('sheet_row')
    .eq('sheet_row', rentalSheetRow)
    .maybeSingle();
  if (rentalError) return { ok: false, error: toMessage(rentalError) };
  if (!rental) return { ok: false, error: '임대리스트에서 이 임대 건을 찾지 못했어요.' };

  // created_at 은 보내지 않음 — 다시 지정해도 처음 지정한 시각이 남고 updated_at 은 트리거가 갱신
  const { error: upsertError } = await supabase
    .from(RENTAL_ASSET_ASSIGNMENTS_TABLE)
    .upsert(
      { rental_sheet_row: rentalSheetRow, asset_id: assetId, assigned_by: String(assignedBy ?? '').trim() },
      { onConflict: 'rental_sheet_row' },
    );
  if (upsertError) {
    if (isAssignmentsTableMissing(upsertError)) return { ok: false, error: SQL_FIRST, tableMissing: true };
    return { ok: false, error: toMessage(upsertError) };
  }

  const { data: updated, error: lineError } = await supabase
    .from(BILLING_LINES_TABLE)
    .update({ asset_id: assetId, allocation_status: 'confirmed' })
    .eq('rental_sheet_row', rentalSheetRow)
    .eq('allocation_status', 'needs_review')
    .select('id');
  if (lineError) return { ok: false, error: toMessage(lineError) };
  return { ok: true, lines: updated?.length ?? 0 };
}

export async function confirmRentalAllocation(
  rentalSheetRow: number,
  assetId: string,
  assignedBy: string,
): Promise<{ ok: true; lines: number } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 설정이 필요해요.' };
  try {
    const res = await confirmOne(rentalSheetRow, assetId, assignedBy);
    if (!res.ok) return { ok: false, error: res.error };
    revalidateAll();
    return { ok: true, lines: res.lines };
  } catch (err) {
    return { ok: false, error: toMessage({ message: errText(err) }) };
  }
}

export async function confirmRentalAllocations(
  items: { rentalSheetRow: number; assetId: string }[],
  assignedBy: string,
): Promise<{ ok: true; succeeded: number; failed: number; lines: number } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 설정이 필요해요.' };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: '선택한 건이 없어요.' };
  if (items.length > 100) return { ok: false, error: '한 번에 최대 100건까지 확정할 수 있어요.' };
  let succeeded = 0;
  let failed = 0;
  let lines = 0;
  let firstError = '';
  for (const item of items) {
    try {
      const res = await confirmOne(item.rentalSheetRow, item.assetId, assignedBy);
      if (res.ok) {
        succeeded += 1;
        lines += res.lines;
      } else {
        if (res.tableMissing) return { ok: false, error: res.error };
        failed += 1;
        firstError ||= res.error;
      }
    } catch (err) {
      failed += 1;
      firstError ||= errText(err);
    }
  }
  if (succeeded > 0) revalidateAll();
  if (succeeded === 0 && failed > 0) return { ok: false, error: firstError || '확정에 실패했어요.' };
  return { ok: true, succeeded, failed, lines };
}

export async function clearRentalAllocation(
  rentalSheetRow: number,
): Promise<{ ok: true; lines: number } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 설정이 필요해요.' };
  if (!Number.isInteger(rentalSheetRow)) return { ok: false, error: '임대 건 번호가 올바르지 않아요.' };
  try {
    const supabase = createAdminClient();
    const { data: existing, error: readError } = await supabase
      .from(RENTAL_ASSET_ASSIGNMENTS_TABLE)
      .select('asset_id')
      .eq('rental_sheet_row', rentalSheetRow)
      .maybeSingle();
    if (readError) {
      if (isAssignmentsTableMissing(readError)) return { ok: false, error: SQL_FIRST };
      return { ok: false, error: toMessage(readError) };
    }
    if (!existing) return { ok: true, lines: 0 };
    const removed = String((existing as { asset_id: string }).asset_id ?? '');

    const { error: delError } = await supabase
      .from(RENTAL_ASSET_ASSIGNMENTS_TABLE)
      .delete()
      .eq('rental_sheet_row', rentalSheetRow);
    if (delError) return { ok: false, error: toMessage(delError) };

    // works 자산번호가 비어 있을 때만 줄을 되돌림(works 번호가 있으면 줄 값은 works 것이라 그대로)
    const { data: rental, error: rentalError } = await supabase
      .from(RENTAL_TABLE)
      .select('asset_code')
      .eq('sheet_row', rentalSheetRow)
      .maybeSingle();
    if (rentalError) return { ok: false, error: toMessage(rentalError) };
    let lines = 0;
    const worksCode = String((rental as { asset_code?: string } | null)?.asset_code ?? '').trim();
    if (!worksCode && removed) {
      const { data: reverted, error: lineError } = await supabase
        .from(BILLING_LINES_TABLE)
        .update({ asset_id: null, allocation_status: 'needs_review' })
        .eq('rental_sheet_row', rentalSheetRow)
        .eq('source_invoice_id', WORKS_LINE_SOURCE)
        .eq('asset_id', removed)
        .select('id');
      if (lineError) return { ok: false, error: toMessage(lineError) };
      lines = reverted?.length ?? 0;
    }
    revalidateAll();
    return { ok: true, lines };
  } catch (err) {
    return { ok: false, error: toMessage({ message: errText(err) }) };
  }
}

/** IT재고 시리얼 일치 — 버튼을 눌렀을 때만, 호출당 시트 읽기 1회(listAllAssets) */
export async function suggestFromInventory(
  serials: string[],
): Promise<{ ok: true; matches: Record<string, string[]> } | { ok: false; error: string }> {
  const wanted = (Array.isArray(serials) ? serials : [])
    .map((s) => ({ raw: s, norm: String(s ?? '').trim().toUpperCase() }))
    .filter((s) => s.norm.length >= 4 && s.norm !== '-');
  if (wanted.length === 0) return { ok: true, matches: {} };
  try {
    const assets = await listAllAssets();
    const byNorm = new Map<string, Set<string>>();
    for (const a of assets) {
      const norm = a.serialNo.trim().toUpperCase();
      if (norm.length < 4 || norm === '-' || !a.assetId) continue;
      const set = byNorm.get(norm);
      if (set) set.add(a.assetId);
      else byNorm.set(norm, new Set([a.assetId]));
    }
    const matches: Record<string, string[]> = {};
    for (const { raw, norm } of wanted) {
      const found = byNorm.get(norm);
      if (found) matches[raw] = [...found];
    }
    return { ok: true, matches };
  } catch (err) {
    return { ok: false, error: `IT재고를 읽지 못했어요: ${errText(err)}` };
  }
}
