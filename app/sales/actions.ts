'use server';

import { revalidatePath } from 'next/cache';
import { appendSalesToSheet, deleteSaleFromSheet, isSalesSheetConfigured, upsertSaleInSheet } from '@/lib/inventory/salesSheet';
import { extractSaleInfoFromImage, isOcrConfigured, type OcrExtractedFields } from '@/lib/ocr';
import { rowToSale, saleInputToRow, type SaleInput, type SaleRow } from '@/lib/sales';
import { createAdminClient, SALES_TABLE } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

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
 * 바로 볼 수 있게 미러링하는 부가 동작이라 실패해도 사용자에게 보이는 결과(Supabase 저장
 * 성공)는 바뀌지 않습니다. lib/inventory/movements.ts의 logAssetMovement와 동일한 원칙.
 */
async function syncToSheetBestEffort(fn: () => Promise<void>, label: string): Promise<void> {
  if (!isSalesSheetConfigured()) return;
  try {
    await fn();
  } catch (err) {
    console.error(`[sales] ${label} 실패(구글시트):`, err);
  }
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

  await syncToSheetBestEffort(() => upsertSaleInSheet(rowToSale(data as SaleRow)), 'createSale');

  revalidatePath('/sales');
  return { ok: true };
}

/** 붙여넣기 파싱(lib/salesParser.ts) 미리보기에서 이미 펼쳐진 행들을 한 번에 등록합니다. */
export async function createSalesBatch(entries: SaleInput[]): Promise<ActionResult> {
  if (entries.length === 0) return { ok: false, error: '등록할 내용이 없어요.' };

  const supabase = createAdminClient();
  const rows = entries.map(saleInputToRow);
  const { data, error } = await supabase.from(SALES_TABLE).insert(rows).select();
  if (error) {
    console.error('[sales] createSalesBatch 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  await syncToSheetBestEffort(
    () => appendSalesToSheet(((data ?? []) as SaleRow[]).map(rowToSale)),
    'createSalesBatch',
  );

  revalidatePath('/sales');
  return { ok: true };
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

  await syncToSheetBestEffort(() => upsertSaleInSheet(rowToSale(data as SaleRow)), 'updateSale');

  revalidatePath('/sales');
  return { ok: true };
}

export type OcrResult = { ok: true; fields: OcrExtractedFields } | { ok: false; error: string };

/** 사진(base64, 데이터 URL 접두어 제외)에서 모델명/스펙/자산번호/시리얼번호를 읽어냅니다. */
export async function ocrExtractSaleInfo(base64Image: string, mediaType: string): Promise<OcrResult> {
  if (!isOcrConfigured()) {
    return { ok: false, error: 'OCR 기능을 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.' };
  }
  try {
    const fields = await extractSaleInfoFromImage(base64Image, mediaType);
    return { ok: true, fields };
  } catch (err) {
    console.error('[sales] ocrExtractSaleInfo 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'OCR 인식에 실패했어요.' };
  }
}

export async function deleteSale(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(SALES_TABLE).delete().eq('id', id).select().single();
  if (error) {
    console.error('[sales] deleteSale 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  if (data) {
    await syncToSheetBestEffort(() => deleteSaleFromSheet((data as SaleRow).seq), 'deleteSale');
  }

  revalidatePath('/sales');
  return { ok: true };
}
