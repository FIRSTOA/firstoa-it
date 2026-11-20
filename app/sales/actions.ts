'use server';

import { revalidatePath } from 'next/cache';
import { appendSalesToSheet, deleteSaleFromSheet, isSalesSheetConfigured, upsertSaleInSheet } from '@/lib/inventory/salesSheet';
import { rowToSale, saleInputToRow, type SaleInput, type SaleRow } from '@/lib/sales';
import { createAdminClient, SALES_TABLE } from '@/lib/supabase/server';
import { sheetFailReason } from '@/lib/syncFailure';

/** sheetWarning = 앱 저장은 됐지만 구글시트 "판매리스트" 탭 반영이 실패한 이유(화면이 경고로 알림). */
export type ActionResult = { ok: true; sheetWarning?: string } | { ok: false; error: string };
/** 붙여넣기 묶음 등록 — 시트 반영이 실패하면 시트에 직접 옮길 순번 범위(seqRange)도 같이. */
export type BatchResult = { ok: true; sheetWarning?: string; seqRange?: string } | { ok: false; error: string };
/** 삭제는 시트에서 직접 지울 줄을 알려 주려고 순번(seq)도 같이 돌려줌. */
export type DeleteResult = { ok: true; seq: number | null; sheetWarning?: string } | { ok: false; error: string };

function validate(entry: SaleInput): string | null {
  if (!entry.model.trim()) return '모델명은 필수예요.';
  return null;
}

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '42P01') return '테이블이 없어요. supabase/sales_schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
}

/**
 * 구글시트 반영은 최선노력입니다 — Supabase 쓰기가 이 앱의 기준값이고, 시트는 다른 직원이
 * 바로 볼 수 있게 미러링하는 부가 동작이라 실패해도 앱 저장은 성공으로 둡니다. 다만 실패를
 * 삼키지 않고 이유(쉬운 말)를 돌려줘서 화면이 "앱에는 저장, 시트는 실패"를 알립니다.
 * null = 반영 성공(또는 시트 연동 설정 없음).
 */
async function syncToSheetBestEffort(fn: () => Promise<void>, label: string): Promise<string | null> {
  if (!isSalesSheetConfigured()) return null;
  try {
    await fn();
    return null;
  } catch (err) {
    console.error(`[sales] ${label} 실패(구글시트):`, err);
    return sheetFailReason(err);
  }
}

function withSheetWarning(sheetWarning: string | null): ActionResult {
  return sheetWarning ? { ok: true, sheetWarning } : { ok: true };
}

export async function createSale(entry: SaleInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { data, error } = await supabase.from(SALES_TABLE).insert(saleInputToRow(entry)).select().single();
  if (error) {
    console.error('[sales] createSale 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  const sheetWarning = await syncToSheetBestEffort(() => upsertSaleInSheet(rowToSale(data as SaleRow)), 'createSale');

  revalidatePath('/sales');
  return withSheetWarning(sheetWarning);
}

/** 붙여넣기 파싱(lib/salesParser.ts) 미리보기에서 이미 펼쳐진 행들을 한 번에 등록합니다. */
export async function createSalesBatch(entries: SaleInput[]): Promise<BatchResult> {
  if (entries.length === 0) return { ok: false, error: '등록할 내용이 없어요.' };

  const supabase = createAdminClient();
  const rows = entries.map(saleInputToRow);
  const { data, error } = await supabase.from(SALES_TABLE).insert(rows).select();
  if (error) {
    console.error('[sales] createSalesBatch 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  const saved = ((data ?? []) as SaleRow[]).map(rowToSale);
  const sheetWarning = await syncToSheetBestEffort(() => appendSalesToSheet(saved), 'createSalesBatch');

  revalidatePath('/sales');
  if (!sheetWarning) return { ok: true };
  // 묶음은 다시 쓰기 버튼 없이(순번 검사 없이 이어 쓰는 함수라 두 번 쓰면 중복) 시트에 직접 옮길 순번 범위만 알려 줌
  const seqs = saved.map((e) => e.seq).sort((a, b) => a - b);
  const seqRange = !seqs.length ? '' : seqs[0] === seqs[seqs.length - 1] ? `${seqs[0]}` : `${seqs[0]}~${seqs[seqs.length - 1]}`;
  return seqRange ? { ok: true, sheetWarning, seqRange } : { ok: true, sheetWarning };
}

export async function updateSale(id: string, entry: SaleInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { data, error } = await supabase.from(SALES_TABLE).update(saleInputToRow(entry)).eq('id', id).select().single();
  if (error) {
    console.error('[sales] updateSale 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  const sheetWarning = await syncToSheetBestEffort(() => upsertSaleInSheet(rowToSale(data as SaleRow)), 'updateSale');

  revalidatePath('/sales');
  return withSheetWarning(sheetWarning);
}

export async function deleteSale(id: string): Promise<DeleteResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(SALES_TABLE).delete().eq('id', id).select().single();
  if (error) {
    console.error('[sales] deleteSale 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  const seq = data ? (data as SaleRow).seq : null;
  const sheetWarning = seq !== null ? await syncToSheetBestEffort(() => deleteSaleFromSheet(seq), 'deleteSale') : null;

  revalidatePath('/sales');
  return sheetWarning ? { ok: true, seq, sheetWarning } : { ok: true, seq };
}
