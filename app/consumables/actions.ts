'use server';

import { revalidatePath } from 'next/cache';
import type { ConsumableInput } from '@/lib/consumables';
import {
  createConsumableInSheet,
  deleteConsumableInSheet,
  deleteConsumablesInSheet,
  updateConsumableInSheet,
  updateConsumablesInSheet,
} from '@/lib/inventory/consumablesSheet';
import { isPriceSearchConfigured, searchInternetPrice } from '@/lib/priceSearch';

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

export async function deleteConsumables(rowNumbers: number[]): Promise<ActionResult> {
  if (rowNumbers.length === 0) return { ok: false, error: '선택한 항목이 없어요.' };

  try {
    await deleteConsumablesInSheet(rowNumbers);
  } catch (err) {
    console.error('[consumables] deleteConsumables 실패:', err);
    return { ok: false, error: `삭제에 실패했어요: ${err instanceof Error ? err.message : String(err)}` };
  }

  revalidatePath('/consumables');
  return { ok: true };
}

export type PriceSearchActionResult =
  | { ok: true; price: string; source: string }
  | { ok: false; error: string };

/** "품목조회" 버튼 — 인터넷가격을 실시간으로 찾아 채웁니다(lib/priceSearch.ts). */
export async function lookupInternetPrice(item: string, model: string, manufacturer: string): Promise<PriceSearchActionResult> {
  if (!isPriceSearchConfigured()) {
    return { ok: false, error: '가격 조회를 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.' };
  }
  if (!item.trim() && !model.trim()) {
    return { ok: false, error: '품목이나 모델명을 먼저 입력해주세요.' };
  }
  try {
    const result = await searchInternetPrice(item, model, manufacturer);
    if (!result.price) return { ok: false, error: '인터넷에서 가격을 찾지 못했어요.' };
    return { ok: true, price: result.price, source: result.source };
  } catch (err) {
    console.error('[consumables] lookupInternetPrice 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : '가격 조회에 실패했어요.' };
  }
}

export async function updateConsumablesBulk(
  updates: { rowNumber: number; entry: ConsumableInput }[],
): Promise<ActionResult> {
  if (updates.length === 0) return { ok: false, error: '선택한 항목이 없어요.' };

  try {
    await updateConsumablesInSheet(updates.map(({ rowNumber, entry }) => ({ rowNumber, input: entry })));
  } catch (err) {
    console.error('[consumables] updateConsumablesBulk 실패:', err);
    return { ok: false, error: toMessage(err) };
  }

  revalidatePath('/consumables');
  return { ok: true };
}
