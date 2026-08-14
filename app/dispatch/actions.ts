'use server';

import { revalidatePath } from 'next/cache';
import { dispatchInputToRow, type DispatchInput } from '@/lib/dispatch';
import { createAdminClient, DISPATCH_TABLE } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

function validate(entry: DispatchInput): string | null {
  if (!entry.company.trim()) return '상호는 필수예요.';
  return null;
}

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '42P01') return '테이블이 없어요. supabase/dispatch_schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
}

export async function createDispatch(entry: DispatchInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(DISPATCH_TABLE).insert(dispatchInputToRow(entry));
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/dispatch');
  return { ok: true };
}

export async function updateDispatch(id: string, entry: DispatchInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(DISPATCH_TABLE).update(dispatchInputToRow(entry)).eq('id', id);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/dispatch');
  return { ok: true };
}

export async function deleteDispatch(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(DISPATCH_TABLE).delete().eq('id', id);
  if (error) return { ok: false, error: `삭제에 실패했어요: ${error.message}` };

  revalidatePath('/dispatch');
  return { ok: true };
}
