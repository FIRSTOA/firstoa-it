import 'server-only';

import { rowToBillingLine, type BillingLine, type BillingLineRow } from '@/lib/billing';
import type {
  AllocationGroup,
  AllocationReview,
  AllocationSuggestion,
  AssignmentState,
  RentalAssignment,
  ReviewSummary,
} from '@/lib/billingAllocationTypes';
import {
  BILLING_LINES_TABLE,
  RENTAL_ASSET_ASSIGNMENTS_TABLE,
  RENTAL_TABLE,
  createAdminClient,
} from '@/lib/supabase/server';

/** works 청구 줄의 source_invoice_id (lib/rentals/worksBilling.ts 와 같은 값) */
export const WORKS_LINE_SOURCE = 'works-asset';

type ErrLike = { code?: string; message?: string } | null | undefined;

/**
 * 지정표가 아직 없음(SQL 미실행). 동기화 쪽(app/rentals/actions.ts isMissingAssignmentsTable)과 같은 판정 —
 * 표 이름이 든 다른 오류(권한 등)를 "없음"으로 보면 "SQL 먼저 실행" 안내가 엉뚱하게 뜸.
 */
export function isAssignmentsTableMissing(error: ErrLike): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message ?? '');
  return message.includes(RENTAL_ASSET_ASSIGNMENTS_TABLE) && /does not exist|could not find|schema cache/i.test(message);
}

/** Supabase 는 한 번에 1000줄까지만 — 끝까지 페이지로 읽음 */
async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: ErrLike }>,
): Promise<{ rows: T[]; error: ErrLike }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows, error: null };
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function throwIf(error: ErrLike): void {
  if (error) throw new Error(error.message || '조회에 실패했어요.');
}

async function readReviewRows(): Promise<BillingLineRow[]> {
  const supabase = createAdminClient();
  const { rows, error } = await readAllPages<BillingLineRow>((from, to) =>
    supabase
      .from(BILLING_LINES_TABLE)
      .select('*')
      .eq('allocation_status', 'needs_review')
      .order('id')
      .range(from, to),
  );
  throwIf(error);
  return rows;
}

function summarizeRows(rows: { rental_sheet_row: number | null }[]): ReviewSummary {
  const rentals = new Set<number>();
  let orphanLines = 0;
  for (const r of rows) {
    if (r.rental_sheet_row === null || r.rental_sheet_row === undefined) orphanLines += 1;
    else rentals.add(r.rental_sheet_row);
  }
  return { rentals: rentals.size, orphanLines, lines: rows.length };
}

/** 위 요약 숫자 — 홈과 청구리스트가 같이 씀(needs_review 줄의 임대 건만 셈) */
export async function summarizeReview(): Promise<ReviewSummary> {
  const supabase = createAdminClient();
  const { rows, error } = await readAllPages<{ rental_sheet_row: number | null }>((from, to) =>
    supabase
      .from(BILLING_LINES_TABLE)
      .select('rental_sheet_row')
      .eq('allocation_status', 'needs_review')
      .order('id')
      .range(from, to),
  );
  throwIf(error);
  return summarizeRows(rows);
}

type RentalRow = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

async function readRentalsBySheetRow(rows: number[]): Promise<Map<number, RentalRow>> {
  const supabase = createAdminClient();
  const map = new Map<number, RentalRow>();
  for (const part of chunk(rows, 200)) {
    const { data, error } = await supabase.from(RENTAL_TABLE).select('*').in('sheet_row', part);
    throwIf(error);
    for (const r of (data ?? []) as RentalRow[]) map.set(Number(r.sheet_row), r);
  }
  return map;
}

function normalizeSerial(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 추천에 쓸 만한 시리얼인가(빈 값·'-'·4자 미만 제외, .in 따옴표를 깨는 글자 제외) */
export function usableSerial(raw: string): boolean {
  const s = normalizeSerial(raw);
  return s.length >= 4 && s !== '-' && !/["\\]/.test(s);
}

async function readAssignmentsRaw(): Promise<{ rows: Record<string, unknown>[]; missing: boolean }> {
  const supabase = createAdminClient();
  const { rows, error } = await readAllPages<Record<string, unknown>>((from, to) =>
    supabase.from(RENTAL_ASSET_ASSIGNMENTS_TABLE).select('*').order('rental_sheet_row').range(from, to),
  );
  if (error) {
    if (isAssignmentsTableMissing(error)) return { rows: [], missing: true };
    throwIf(error);
  }
  return { rows, missing: false };
}

export async function buildAllocationReview(): Promise<AllocationReview> {
  const supabase = createAdminClient();
  const reviewRows = await readReviewRows();
  const summary = summarizeRows(reviewRows);

  // 임대 건별 묶기 — rental_sheet_row 하나만 기준
  const byRental = new Map<number, BillingLineRow[]>();
  const orphanRows: BillingLineRow[] = [];
  for (const r of reviewRows) {
    if (r.rental_sheet_row === null || r.rental_sheet_row === undefined) {
      orphanRows.push(r);
      continue;
    }
    const list = byRental.get(r.rental_sheet_row);
    if (list) list.push(r);
    else byRental.set(r.rental_sheet_row, [r]);
  }
  const rentalRows = [...byRental.keys()];
  const rentals = await readRentalsBySheetRow(rentalRows);

  // 추천 1: 같은 시리얼의 다른 임대 건에 자산번호가 있음
  const serials = [
    ...new Set(
      rentalRows
        .map((row) => str(rentals.get(row)?.serial_number).trim())
        .filter((s) => usableSerial(s)),
    ),
  ];
  const bySerial = new Map<string, RentalRow[]>();
  for (const part of chunk(serials, 200)) {
    // 시리얼 200개라도 임대 건은 1000건을 넘을 수 있음(같은 기기가 여러 번 임대) — 페이지로 끝까지
    const { rows: found, error } = await readAllPages<RentalRow>((from, to) =>
      supabase
        .from(RENTAL_TABLE)
        .select('sheet_row, vendor_name, contract_date, serial_number, asset_code')
        .in('serial_number', part)
        .neq('asset_code', '')
        .order('sheet_row')
        .range(from, to),
    );
    throwIf(error);
    for (const r of found) {
      const key = normalizeSerial(str(r.serial_number));
      const list = bySerial.get(key);
      if (list) list.push(r);
      else bySerial.set(key, [r]);
    }
  }

  // 추천 2: 같은 임대 건에서 이미 확정된 줄
  const siblings = new Map<number, Set<string>>();
  for (const part of chunk(rentalRows, 200)) {
    const { rows, error } = await readAllPages<{ rental_sheet_row: number; asset_id: string | null }>((from, to) =>
      supabase
        .from(BILLING_LINES_TABLE)
        .select('rental_sheet_row, asset_id')
        .in('rental_sheet_row', part)
        .eq('allocation_status', 'confirmed')
        .not('asset_id', 'is', null)
        .order('id')
        .range(from, to),
    );
    throwIf(error);
    for (const r of rows) {
      const id = str(r.asset_id).trim();
      if (!id) continue;
      const set = siblings.get(r.rental_sheet_row);
      if (set) set.add(id);
      else siblings.set(r.rental_sheet_row, new Set([id]));
    }
  }

  const groups: AllocationGroup[] = rentalRows.map((row) => {
    const lines = byRental.get(row) ?? [];
    const rental = rentals.get(row);
    const months = lines.map((l) => (l.billing_date ?? '').slice(0, 7)).filter(Boolean).sort();
    const suggestions: AllocationSuggestion[] = [];
    const seen = new Set<string>();
    const serialRaw = str(rental?.serial_number).trim();
    if (rental && usableSerial(serialRaw)) {
      for (const other of bySerial.get(normalizeSerial(serialRaw)) ?? []) {
        if (Number(other.sheet_row) === row) continue;
        const code = str(other.asset_code).trim().toUpperCase();
        if (!code || seen.has(code)) continue;
        seen.add(code);
        const when = str(other.contract_date).slice(0, 7);
        suggestions.push({
          assetId: code,
          source: 'rental_serial',
          detail: `같은 시리얼 — 임대리스트 ${str(other.vendor_name)}${when ? ` ${when}` : ''}`.trim(),
        });
      }
    }
    for (const id of siblings.get(row) ?? []) {
      const code = id.toUpperCase();
      if (seen.has(code)) continue;
      seen.add(code);
      suggestions.push({ assetId: code, source: 'sibling_line', detail: '같은 임대 건의 다른 청구 줄에 이미 지정됨' });
    }
    return {
      rentalSheetRow: row,
      vendorName: str(rental?.vendor_name),
      siteName: str(rental?.site_name),
      item: str(rental?.item),
      manufacturer: str(rental?.manufacturer),
      modelName: str(rental?.model_name),
      serialNumber: str(rental?.serial_number),
      contractDate: str(rental?.contract_date),
      endDate: str(rental?.end_date),
      rentalStatus: str(rental?.status),
      firstMonth: months[0] ?? '',
      lastMonth: months[months.length - 1] ?? '',
      lineCount: lines.length,
      amountSum: lines.filter((l) => l.status !== '취소').reduce((s, l) => s + (Number(l.amount) || 0), 0),
      suggestions,
    };
  });

  // 지정한 것
  const { rows: assignRows, missing } = await readAssignmentsRaw();
  const assignRentals = await readRentalsBySheetRow(assignRows.map((a) => Number(a.rental_sheet_row)));
  const assignments: RentalAssignment[] = assignRows.map((a) => {
    const row = Number(a.rental_sheet_row);
    const rental = assignRentals.get(row);
    const assetId = str(a.asset_id);
    const worksAssetCode = str(rental?.asset_code).trim();
    let state: AssignmentState = 'active';
    if (!rental) state = 'rental_gone';
    else if (worksAssetCode && worksAssetCode.toUpperCase() === assetId.toUpperCase()) state = 'works_same';
    else if (worksAssetCode) state = 'works_differs';
    return {
      rentalSheetRow: row,
      assetId,
      assignedBy: str(a.assigned_by),
      createdAt: str(a.created_at),
      vendorName: str(rental?.vendor_name),
      siteName: str(rental?.site_name),
      modelName: str(rental?.model_name),
      serialNumber: str(rental?.serial_number),
      worksAssetCode,
      state,
    };
  });

  const orphanLines: BillingLine[] = orphanRows.map(rowToBillingLine);
  return { summary, groups, orphanLines, assignments, tableMissing: missing };
}

/** 이 자산번호로 지정된 임대 건(it_rental_list.sheet_row) — 표가 없으면 [] */
export async function assignedRentalRowsForAsset(assetId: string): Promise<number[]> {
  const id = assetId.trim().toUpperCase();
  if (!id) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(RENTAL_ASSET_ASSIGNMENTS_TABLE)
    .select('rental_sheet_row')
    .eq('asset_id', id);
  if (error) {
    if (isAssignmentsTableMissing(error)) return [];
    console.error('[billingAllocation] 지정표 조회 실패:', error.message);
    return [];
  }
  return ((data ?? []) as { rental_sheet_row: number }[]).map((r) => Number(r.rental_sheet_row));
}
