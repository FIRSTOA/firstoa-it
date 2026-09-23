'use server';

import { revalidatePath } from 'next/cache';
import { saleInputToRow, type SaleInput } from '@/lib/sales';
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

export async function createSale(entry: SaleInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(SALES_TABLE).insert(saleInputToRow(entry));
  if (error) {
    console.error('[sales] createSale 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/sales');
  return { ok: true };
}

/** 붙여넣기 파싱(lib/salesParser.ts) 미리보기에서 이미 펼쳐진 행들을 한 번에 등록합니다. */
export async function createSalesBatch(entries: SaleInput[]): Promise<ActionResult> {
  if (entries.length === 0) return { ok: false, error: '등록할 내용이 없어요.' };

  const supabase = createAdminClient();
  const rows = entries.map(saleInputToRow);
  const { error } = await supabase.from(SALES_TABLE).insert(rows);
  if (error) {
    console.error('[sales] createSalesBatch 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/sales');
  return { ok: true };
}

export async function updateSale(id: string, entry: SaleInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(SALES_TABLE).update(saleInputToRow(entry)).eq('id', id);
  if (error) {
    console.error('[sales] updateSale 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/sales');
  return { ok: true };
}

export async function deleteSale(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(SALES_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[sales] deleteSale 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  revalidatePath('/sales');
  return { ok: true };
}
