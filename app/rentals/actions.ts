'use server';

import { revalidatePath } from 'next/cache';
import { readRentalSheetRows, type RentalSheetRow } from '@/lib/rentals/sync';
import { createAdminClient, RENTAL_TABLE } from '@/lib/supabase/server';

function toDbRow(r: RentalSheetRow) {
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
    }
  | { ok: false; error: string };

/** 시트와 로컬 사본을 비교만 합니다(아무것도 쓰지 않음) — "다시 대조" 버튼에서 반복 호출됨. */
export async function compareRentalSheet(): Promise<CompareResult> {
  try {
    const sheetRows = await readRentalSheetRows();
    const supabase = createAdminClient();
    const { data, error } = await supabase.from(RENTAL_TABLE).select('sheet_row, row_hash');
    if (error) throw error;

    const existing = new Map<number, string>((data ?? []).map((r) => [r.sheet_row as number, r.row_hash as string]));
    let newCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;
    const seen = new Set<number>();

    for (const row of sheetRows) {
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

    return {
      ok: true,
      totalSheetRows: sheetRows.length,
      newCount,
      changedCount,
      removedCount,
      unchangedCount,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '구글시트 대조에 실패했어요.' };
  }
}

export type ApplyResult = { ok: true; upserted: number; deleted: number } | { ok: false; error: string };

const CHUNK_SIZE = 500;

/** 시트를 다시 읽어 로컬 사본에 실제로 반영합니다(upsert + 사라진 행 삭제). */
export async function applyRentalSheetSync(): Promise<ApplyResult> {
  try {
    const sheetRows = await readRentalSheetRows();
    const supabase = createAdminClient();

    let upserted = 0;
    for (let i = 0; i < sheetRows.length; i += CHUNK_SIZE) {
      const chunk = sheetRows.slice(i, i + CHUNK_SIZE).map(toDbRow);
      const { error } = await supabase.from(RENTAL_TABLE).upsert(chunk, { onConflict: 'sheet_row' });
      if (error) throw error;
      upserted += chunk.length;
    }

    const currentRows = new Set(sheetRows.map((r) => r.sheetRow));
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

    revalidatePath('/rentals');
    return { ok: true, upserted, deleted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '구글시트 반영에 실패했어요.' };
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
    return { ok: false, error: err instanceof Error ? err.message : '필터 옵션 조회에 실패했어요.' };
  }
}
