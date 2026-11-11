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
    base_amount: r.baseAmount,
    first_contract_date: r.firstContractDate,
    entry_date: r.entryDate,
    removal_date: r.removalDate,
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
      billingRemovedCount: number;
      billingUnchangedCount: number;
    }
  | { ok: false; error: string };

const WRITE_CHUNK = 1000;
const DELETE_CHUNK = 300; // .in() 필터가 URL에 실리므로 너무 크게 잡지 않음
const READ_PAGE = 1000; // Supabase(PostgREST) 1회 조회 최대 행수

type Supabase = ReturnType<typeof createAdminClient>;

/** Supabase 오류는 Error 인스턴스가 아닌 일반 객체라, 실제 메시지를 꺼내서 보여줍니다. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter(Boolean);
    if (e.code === '42P01') return '테이블이 없어요. supabase/billing_schema.sql 을 먼저 실행하세요.';
    if (parts.length) return `${fallback} (${parts.join(' / ')})`;
  }
  return fallback;
}

/** 우리 쪽 테이블도 1회 1000행 상한이 있어서, 끝까지 페이지를 넘기며 읽습니다. */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const PARALLEL = 8;
  const all: T[] = [];
  for (let base = 0; ; base += READ_PAGE * PARALLEL) {
    const offsets = Array.from({ length: PARALLEL }, (_, i) => base + i * READ_PAGE);
    const pages = await Promise.all(offsets.map((from) => build(from, from + READ_PAGE - 1)));
    let done = false;
    for (const { data, error } of pages) {
      if (error) throw error;
      const rows = (data ?? []) as T[];
      all.push(...rows);
      if (rows.length < READ_PAGE) done = true;
    }
    if (done) break;
  }
  return all;
}

type ExistingBilling = {
  id: string;
  source_line_id: string;
  asset_id: string | null;
  rental_sheet_row: number | null;
  vendor_name: string;
  billing_date: string | null;
  amount: number | string;
  status: string;
  allocation_status: string;
};

function billingKey(b: {
  assetId: string | null;
  rentalSheetRow: number | null;
  vendorName: string;
  billingDate: string;
  amount: number;
  status: string;
  allocationStatus: string;
}): string {
  return [b.assetId ?? '', b.rentalSheetRow ?? '', b.vendorName, b.billingDate, Number(b.amount), b.status, b.allocationStatus].join('|');
}

type SyncPlan = {
  assetRows: WorksAssetRow[];
  rentalNew: number;
  rentalChanged: number;
  rentalUnchanged: number;
  rentalUpserts: WorksAssetRow[];
  rentalStale: number[];
  billingInserts: ReturnType<typeof billingLineInputToRow>[];
  billingUpdates: (ReturnType<typeof billingLineInputToRow> & { id: string })[];
  billingStaleIds: string[];
  billingUnchanged: number;
};

/** firstoa-works와 우리 DB를 둘 다 끝까지 읽어서 "무엇을 넣고/바꾸고/지울지" 계산합니다(쓰기 없음). */
async function buildSyncPlan(supabase: Supabase): Promise<SyncPlan> {
  const { rows: assetRows, assetCodeById } = await readWorksAssetRows();
  const vendorNameById = new Map<number, string>(assetRows.map((r) => [r.sheetRow, r.vendorName]));
  const billingLines = await readWorksBillingLines(assetCodeById, vendorNameById);

  const existingRentals = await selectAll<{ sheet_row: number; row_hash: string }>((from, to) =>
    supabase.from(RENTAL_TABLE).select('sheet_row, row_hash').order('sheet_row').range(from, to),
  );
  const rentalHash = new Map(existingRentals.map((r) => [r.sheet_row, r.row_hash]));
  const currentSheetRows = new Set(assetRows.map((r) => r.sheetRow));

  let rentalNew = 0;
  let rentalChanged = 0;
  let rentalUnchanged = 0;
  const rentalUpserts: WorksAssetRow[] = [];
  for (const row of assetRows) {
    const prev = rentalHash.get(row.sheetRow);
    if (prev === undefined) rentalNew++;
    else if (prev !== row.rowHash) rentalChanged++;
    else {
      rentalUnchanged++;
      continue;
    }
    rentalUpserts.push(row);
  }
  const rentalStale = existingRentals.map((r) => r.sheet_row).filter((n) => !currentSheetRows.has(n));

  const existingBilling = await selectAll<ExistingBilling>((from, to) =>
    supabase
      .from(BILLING_LINES_TABLE)
      .select('id, source_line_id, asset_id, rental_sheet_row, vendor_name, billing_date, amount, status, allocation_status')
      .eq('source_invoice_id', WORKS_BILLING_SOURCE_ID)
      .order('id')
      .range(from, to),
  );
  const existingByLineId = new Map(existingBilling.map((b) => [b.source_line_id, b]));

  const billingInserts: SyncPlan['billingInserts'] = [];
  const billingUpdates: SyncPlan['billingUpdates'] = [];
  let billingUnchanged = 0;
  const seenLineIds = new Set<string>();

  for (const line of billingLines) {
    seenLineIds.add(line.sourceLineId);
    // firstoa-works에서 두 번의 조회 사이에 새 자산이 생긴 경우 등 — 임대리스트에 없는
    // 임대 건을 FK로 가리키면 저장이 실패하므로 연결만 비워 둡니다.
    const rentalSheetRow =
      line.rentalSheetRow !== null && currentSheetRows.has(line.rentalSheetRow) ? line.rentalSheetRow : null;
    const input = { ...line, rentalSheetRow };
    const prev = existingByLineId.get(line.sourceLineId);
    if (!prev) {
      billingInserts.push(billingLineInputToRow(input));
      continue;
    }
    const prevKey = billingKey({
      assetId: prev.asset_id,
      rentalSheetRow: prev.rental_sheet_row,
      vendorName: prev.vendor_name,
      billingDate: prev.billing_date ?? '',
      amount: Number(prev.amount),
      status: prev.status,
      allocationStatus: prev.allocation_status,
    });
    if (prevKey === billingKey(input)) billingUnchanged++;
    else billingUpdates.push({ id: prev.id, ...billingLineInputToRow(input) });
  }
  const billingStaleIds = existingBilling.filter((b) => !seenLineIds.has(b.source_line_id)).map((b) => b.id);

  return {
    assetRows,
    rentalNew,
    rentalChanged,
    rentalUnchanged,
    rentalUpserts,
    rentalStale,
    billingInserts,
    billingUpdates,
    billingStaleIds,
    billingUnchanged,
  };
}

/** 임대리스트+청구 명세를 firstoa-works와 비교만 합니다(아무것도 쓰지 않음) — "다시 대조" 버튼에서 반복 호출됨. */
export async function compareWorksSync(): Promise<CompareResult> {
  try {
    const plan = await buildSyncPlan(createAdminClient());
    return {
      ok: true,
      totalSheetRows: plan.assetRows.length,
      newCount: plan.rentalNew,
      changedCount: plan.rentalChanged,
      removedCount: plan.rentalStale.length,
      unchangedCount: plan.rentalUnchanged,
      billingNewCount: plan.billingInserts.length,
      billingChangedCount: plan.billingUpdates.length,
      billingRemovedCount: plan.billingStaleIds.length,
      billingUnchangedCount: plan.billingUnchanged,
    };
  } catch (err) {
    console.error('[rentals] compareWorksSync 실패:', err);
    return { ok: false, error: errorMessage(err, 'firstoa-works 대조에 실패했어요.') };
  }
}

export type ApplyResult =
  | {
      ok: true;
      /** false면 시간 예산을 다 써서 중간에 멈춘 것 — 다시 호출하면 남은 차분만 이어서 반영됨 */
      done: boolean;
      upserted: number;
      deleted: number;
      billingInserted: number;
      billingUpdated: number;
      billingDeleted: number;
    }
  | { ok: false; error: string };

// Vercel 함수 상한(300초) 안에서 끝나도록, 쓰기는 이 시간까지만 하고 멈춥니다.
const WRITE_BUDGET_MS = 200_000;
const WRITE_PARALLEL = 4;

/** items를 size씩 잘라 parallel개씩 동시에 write하되, deadline이 지나면 멈춥니다. 처리한 개수를 반환. */
async function writeChunks<T>(
  items: T[],
  size: number,
  deadline: number,
  write: (chunk: T[]) => PromiseLike<{ error: unknown }>,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < items.length; i += size * WRITE_PARALLEL) {
    if (Date.now() > deadline) break;
    const chunks: T[][] = [];
    for (let j = 0; j < WRITE_PARALLEL; j++) {
      const chunk = items.slice(i + j * size, i + (j + 1) * size);
      if (chunk.length) chunks.push(chunk);
    }
    const results = await Promise.all(chunks.map((c) => write(c)));
    for (const r of results) if (r.error) throw r.error;
    processed += chunks.reduce((n, c) => n + c.length, 0);
  }
  return processed;
}

/**
 * firstoa-works를 다시 읽어 임대리스트+청구 명세를 실제로 반영합니다. 바뀐 행만 씁니다.
 * 청구 명세는 (source_invoice_id, source_line_id) 고유 인덱스가 부분 인덱스(where <> '')라
 * ON CONFLICT 대상으로 못 써서, 새 행은 insert / 바뀐 행은 기본키(id)로 upsert / 사라진 행은
 * delete로 나눠서 반영합니다.
 */
export async function applyWorksSync(): Promise<ApplyResult> {
  try {
    const startedAt = Date.now();
    const supabase = createAdminClient();
    const plan = await buildSyncPlan(supabase);
    const deadline = startedAt + WRITE_BUDGET_MS;

    // 1) 임대리스트 먼저 — 청구 명세가 rental_sheet_row로 참조하므로 순서가 중요함.
    const upserted = await writeChunks(plan.rentalUpserts.map(toDbRow), WRITE_CHUNK, deadline, (c) =>
      supabase.from(RENTAL_TABLE).upsert(c, { onConflict: 'sheet_row' }),
    );

    // 2) 청구 명세
    const billingInserted = await writeChunks(plan.billingInserts, WRITE_CHUNK, deadline, (c) =>
      supabase.from(BILLING_LINES_TABLE).insert(c),
    );
    const billingUpdated = await writeChunks(plan.billingUpdates, WRITE_CHUNK, deadline, (c) =>
      supabase.from(BILLING_LINES_TABLE).upsert(c, { onConflict: 'id' }),
    );
    const billingDeleted = await writeChunks(plan.billingStaleIds, DELETE_CHUNK, deadline, (c) =>
      supabase.from(BILLING_LINES_TABLE).delete().in('id', c),
    );

    // 3) firstoa-works에 없는 임대 건(예: 예전 구글시트에서 온 행) 삭제 — 청구 명세 FK는 on delete set null.
    const deleted = await writeChunks(plan.rentalStale, DELETE_CHUNK, deadline, (c) =>
      supabase.from(RENTAL_TABLE).delete().in('sheet_row', c),
    );

    const done =
      upserted === plan.rentalUpserts.length &&
      billingInserted === plan.billingInserts.length &&
      billingUpdated === plan.billingUpdates.length &&
      billingDeleted === plan.billingStaleIds.length &&
      deleted === plan.rentalStale.length;

    if (done) {
      revalidatePath('/rentals');
      revalidatePath('/billing');
      revalidatePath('/');
    }
    return { ok: true, done, upserted, deleted, billingInserted, billingUpdated, billingDeleted };
  } catch (err) {
    console.error('[rentals] applyWorksSync 실패:', err);
    return { ok: false, error: errorMessage(err, 'firstoa-works 반영에 실패했어요.') };
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
