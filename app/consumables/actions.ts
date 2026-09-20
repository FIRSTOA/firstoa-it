'use server';

import { revalidatePath } from 'next/cache';
import type { ConsumableInput } from '@/lib/consumables';
import {
  createConsumableInSheet,
  deleteConsumableInSheet,
  updateConsumableInSheet,
} from '@/lib/inventory/consumablesSheet';

export type ActionResult = { ok: true } | { ok: false; error: string };

function validate(entry: ConsumableInput): string | null {
  if (!entry.item.trim()) return '품목은 필수예요.';
  return null;
}

function toMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `저장에 실패했어요: ${message}`;
}

export async function createConsumable(entry: ConsumableInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  try {
    await createConsumableInSheet(entry);
  } catch (err) {
    console.error('[consumables] createConsumable 실패:', err);
    return { ok: false, error: toMessage(err) };
  }

  revalidatePath('/consumables');
  return { ok: true };
}

export async function updateConsumable(rowNumber: number, entry: ConsumableInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  try {
    await updateConsumableInSheet(rowNumber, entry);
  } catch (err) {
    console.error('[consumables] updateConsumable 실패:', err);
    return { ok: false, error: toMessage(err) };
  }

  revalidatePath('/consumables');
  return { ok: true };
}

export async function deleteConsumable(rowNumber: number): Promise<ActionResult> {
  try {
    await deleteConsumableInSheet(rowNumber);
  } catch (err) {
    console.error('[consumables] deleteConsumable 실패:', err);
    return { ok: false, error: `삭제에 실패했어요: ${err instanceof Error ? err.message : String(err)}` };
  }

  revalidatePath('/consumables');
  return { ok: true };
}
