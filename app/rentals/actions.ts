'use server';

import { revalidatePath } from 'next/cache';
import { readWorksAssetRows, type WorksAssetRow } from '@/lib/rentals/worksSync';
import { readWorksBillingLines, WORKS_BILLING_SOURCE_ID } from '@/lib/rentals/worksBilling';
import { billingLineInputToRow } from '@/lib/billing';
import { createAdminClient, RENTAL_TABLE, BILLING_LINES_TABLE } from '@/lib/supabase/server';

function toDbRow(r: WorksAssetRow) {
  return {
    sheet_row: r.sheetRow,
    row_hash: r.rowHash,
    seq: r.seq,
    vendor_name: r.vendorName,
    site_name: r.siteName,
    manager: r.manager,
    phone: r.phone,
    asset_code: r.assetCode,
    model_name: r.modelName,
    serial_number: r.serialNumber,
    contract_date: r.contractDate,
    end_date: r.endDate,
    status: r.status,
    item: r.item,
    manufacturer: r.manufacturer,
    region: r.region,
    province: r.province,
    grade: r.grade,
    contract_type: r.contractType,
    option1: r.option1,
    option2: r.option2,
    option3: r.option3,
    option4: r.option4,
  };
}

export type CompareResult =
  | {
      ok: true;
      totalSheetRows: number;
      newCount: number;
      changedCount: number;
      removedCount: number;
      unchangedCount: number;
      billingNewCount: number;
      billingChangedCount: number;
      billingUnchangedCount: number;
    }
  | { ok: false; error: string };

const CHUNK_SIZE = 500;

/** 임대리스트+청구 명세를 firstoa-works와 비교만 합니다(아무것도 쓰지 않음) — "다시 대조" 버튼에서 반복 호출됨. */
export async function compareWorksSync(): Promise<CompareResult> {
  try {
    const { rows: assetRows, assetCodeById } = await readWorksAssetRows();
    const vendorNameById = new Map<number, string>(assetRows.map((r) => [r.sheetRow, r.vendorName]));
    const billingLines = await readWorksBillingLines(assetCodeById, vendorNameById);

    const supabase = createAdminClient();

    const { data: rentalExistingData, error: rentalError } = await supabase
      .from(RENTAL_TABLE)
      .select('sheet_row, row_hash');
    if (rentalError) throw rentalError;

    const existing = new Map<number, string>(
      (rentalExistingData ?? []).map((r) => [r.sheet_row as number, r.row_hash as string]),
    );
    let newCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;
    const seen = new Set<number>();

    for (const row of assetRows) {
      seen.add(row.sheetRow);
      const prevHash = existing.get(row.sheetRow);
      if (prevHash === undefined) newCount++;
      else if (prevHash !== row.rowHash) changedCount++;
      else unchangedCount++;
    }

    let removedCount = 0;
    for (const sheetRow of existing.keys()) {
      if (!seen.has(sheetRow)) removedCount++;
    }

    const { data: billingExistingData, error: billingError } = await supabase
      .from(BILLING_LINES_TABLE)
      .select('source_line_id, amount, status, allocation_status')
      .eq('source_invoice_id', WORKS_BILLING_SOURCE_ID);
    if (billingError) throw billingError;

    const billingExisting = new Map(
      (billingExistingData ?? []).map((r) => [
        r.source_line_id as string,
        `${r.amount}|${r.status}|${r.allocation_status}`,
      ]),
    );
    let billingNewCount = 0;
    let billingChangedCount = 0;
    let billingUnchangedCount = 0;

    for (const line of billingLines) {
      const key = `${line.amount}|${line.status}|${line.allocationStatus}`;
      const prev = billingExisting.get(line.sourceLineId);
      if (prev === undefined) billingNewCount++;
      else if (prev !== key) billingChangedCount++;
      else billingUnchangedCount++;
    }

    return {
      ok: true,
      totalSheetRows: assetRows.length,
      newCount,
      changedCount,
      removedCount,
      unchangedCount,
      billingNewCount,
      billingChangedCount,
      billingUnchangedCount,
    };
  } catch (err) {
    console.error('[rentals] compareWorksSync 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'firstoa-works 대조에 실패했어요.' };
  }
}

export type ApplyResult =
  | { ok: true; upserted: number; deleted: number; billingUpserted: number }
  | { ok: false; error: string };

/** firstoa-works를 다시 읽어 임대리스트+청구 명세를 실제로 반영합니다(upsert + 사라진 임대 건 삭제). */
export async function applyWorksSync(): Promise<ApplyResult> {
  try {
    const { rows: assetRows, assetCodeById } = await readWorksAssetRows();
    const vendorNameById = new Map<number, string>(assetRows.map((r) => [r.sheetRow, r.vendorName]));
    const billingLines = await readWorksBillingLines(assetCodeById, vendorNameById);

    const supabase = createAdminClient();

    // 1) 임대리스트 먼저 반영 — 청구 명세가 rental_sheet_row로 참조하므로 순서가 중요함.
    let upserted = 0;
    for (let i = 0; i < assetRows.length; i += CHUNK_SIZE) {
      const chunk = assetRows.slice(i, i + CHUNK_SIZE).map(toDbRow);
      const { error } = await supabase.from(RENTAL_TABLE).upsert(chunk, { onConflict: 'sheet_row' });
      if (error) throw error;
      upserted += chunk.length;
    }

    const currentRows = new Set(assetRows.map((r) => r.sheetRow));
    const { data: existingRows, error: fetchError } = await supabase.from(RENTAL_TABLE).select('sheet_row');
    if (fetchError) throw fetchError;
    const staleRows = (existingRows ?? [])
      .map((r) => r.sheet_row as number)
      .filter((n) => !currentRows.has(n));

    let deleted = 0;
    for (let i = 0; i < staleRows.length; i += CHUNK_SIZE) {
      const chunk = staleRows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase.from(RENTAL_TABLE).delete().in('sheet_row', chunk);
      if (error) throw error;
      deleted += chunk.length;
    }

    // 2) 청구 명세 반영 — (source_invoice_id, source_line_id) upsert라 재동기화해도 중복 안 됨.
    let billingUpserted = 0;
    for (let i = 0; i < billingLines.length; i += CHUNK_SIZE) {
      const chunk = billingLines.slice(i, i + CHUNK_SIZE).map((line) => billingLineInputToRow(line));
      const { error } = await supabase
        .from(BILLING_LINES_TABLE)
        .upsert(chunk, { onConflict: 'source_invoice_id,source_line_id' });
      if (error) throw error;
      billingUpserted += chunk.length;
    }

    revalidatePath('/rentals');
    revalidatePath('/billing');
    revalidatePath('/');
    return { ok: true, upserted, deleted, billingUpserted };
  } catch (err) {
    console.error('[rentals] applyWorksSync 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'firstoa-works 반영에 실패했어요.' };
  }
}

export type RentalSearchParams = {
  tab: 'active' | 'ended';
  searchTerm: string;
  region: string | null;
  province: string | null;
  item: string | null;
  manufacturer: string | null;
  contractType: string | null;
  grade: string | null;
  page: number;
  pageSize: number;
};

export type RentalRow = {
  id: string;
  seq: string;
  vendorName: string;
  siteName: string;
  manager: string;
  phone: string;
  assetCode: string;
  modelName: string;
  serialNumber: string;
  contractDate: string;
  endDate: string;
  status: string;
  item: string;
  manufacturer: string;
  region: string;
  province: string;
  grade: string;
  contractType: string;
  option1: string;
  option2: string;
  option3: string;
  option4: string;
};

export type SearchResult = { ok: true; rows: RentalRow[]; totalCount: number } | { ok: false; error: string };

/** 22,808행을 한 번에 안 보내고, 서버에서 필터/검색/페이지네이션까지 처리해서 필요한 만큼만 보냅니다. */
export async function searchRentals(params: RentalSearchParams): Promise<SearchResult> {
  try {
    const supabase = createAdminClient();
    let query = supabase.from(RENTAL_TABLE).select('*', { count: 'exact' });

    query = params.tab === 'ended' ? query.eq('status', '임대종료') : query.neq('status', '임대종료');

    if (params.searchTerm.trim()) {
      const term = `%${params.searchTerm.trim()}%`;
      query = query.or(
        [
          `vendor_name.ilike.${term}`,
          `manager.ilike.${term}`,
          `seq.ilike.${term}`,
          `model_name.ilike.${term}`,
          `serial_number.ilike.${term}`,
          `asset_code.ilike.${term}`,
        ].join(','),
      );
    }
    if (params.region) query = query.eq('region', params.region);
    if (params.province) query = query.eq('province', params.province);
    if (params.item) query = query.eq('item', params.item);
    if (params.manufacturer) query = query.eq('manufacturer', params.manufacturer);
    if (params.contractType) query = query.eq('contract_type', params.contractType);
    if (params.grade) query = query.eq('grade', params.grade);

    const from = params.page * params.pageSize;
    const to = from + params.pageSize - 1;
    query = query.order('sheet_row', { ascending: true }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows: RentalRow[] = (data ?? []).map((r) => ({
      id: r.id,
      seq: r.seq,
      vendorName: r.vendor_name,
      siteName: r.site_name,
      manager: r.manager,
      phone: r.phone,
      assetCode: r.asset_code,
      modelName: r.model_name,
      serialNumber: r.serial_number,
      contractDate: r.contract_date,
      endDate: r.end_date,
      status: r.status,
      item: r.item,
      manufacturer: r.manufacturer,
      region: r.region,
      province: r.province,
      grade: r.grade,
      contractType: r.contract_type,
      option1: r.option1,
      option2: r.option2,
      option3: r.option3,
      option4: r.option4,
    }));

    return { ok: true, rows, totalCount: count ?? 0 };
  } catch (err) {
    console.error('[rentals] searchRentals 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : '조회에 실패했어요.' };
  }
}

export type FilterOptionsResult =
  | {
      ok: true;
      regions: string[];
      provinces: string[];
      items: string[];
      manufacturers: string[];
      contractTypes: string[];
      grades: string[];
    }
  | { ok: false; error: string };

/** 필터 드롭다운 옵션 — 컬럼별로 최대 5000행 샘플에서 고유값을 뽑습니다(전체 스캔은 느림). */
export async function getRentalFilterOptions(): Promise<FilterOptionsResult> {
  try {
    const supabase = createAdminClient();

    async function distinctValues(column: string): Promise<string[]> {
      const { data, error } = await supabase
        .from(RENTAL_TABLE)
        .select(column)
        .not(column, 'eq', '')
        .limit(5000);
      if (error) throw error;
      const set = new Set<string>();
      (data ?? []).forEach((row) => {
        const value = (row as unknown as Record<string, string>)[column];
        if (value) set.add(value);
      });
      return [...set].sort();
    }

    const [regions, provinces, items, manufacturers, contractTypes, grades] = await Promise.all([
      distinctValues('region'),
      distinctValues('province'),
      distinctValues('item'),
      distinctValues('manufacturer'),
      distinctValues('contract_type'),
      distinctValues('grade'),
    ]);

    return { ok: true, regions, provinces, items, manufacturers, contractTypes, grades };
  } catch (err) {
    console.error('[rentals] getRentalFilterOptions 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : '필터 옵션 조회에 실패했어요.' };
  }
}
