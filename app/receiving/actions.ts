'use server';

import { revalidatePath } from 'next/cache';
import { createAsset } from '@/app/actions';
import {
  missingRequiredFields,
  receivingInputToRow,
  rowToReceiving,
  type ReceivingInput,
  type ReceivingRow,
} from '@/lib/receiving';
import type { Asset } from '@/lib/types';
import { createAdminClient, RECEIVING_TABLE } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

function validate(entry: ReceivingInput): string | null {
  if (entry.kind === '렌탈입고예정' && !entry.assetId.trim()) {
    return '렌탈입고예정은 자산번호가 필수예요.';
  }
  if (!entry.model.trim() && entry.kind === '구매입고예정') {
    return '모델명은 필수예요.';
  }
  return null;
}

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '42P01') return '테이블이 없어요. supabase/receiving_schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
}

/** 수량만큼 동일한 내용의 행을 한 번에 여러 개 만듭니다 (1행 = 1대 기준). */
export async function createReceiving(entry: ReceivingInput, quantity: number): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const count = Math.min(Math.max(Math.trunc(quantity) || 1, 1), 50);
  const supabase = createAdminClient();
  const rows = Array.from({ length: count }, () => receivingInputToRow(entry));
  const { error } = await supabase.from(RECEIVING_TABLE).insert(rows);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/receiving');
  return { ok: true };
}

export async function updateReceiving(id: string, entry: ReceivingInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(RECEIVING_TABLE).update(receivingInputToRow(entry)).eq('id', id);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/receiving');
  return { ok: true };
}

export async function deleteReceiving(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(RECEIVING_TABLE).delete().eq('id', id);
  if (error) return { ok: false, error: `삭제에 실패했어요: ${error.message}` };

  revalidatePath('/receiving');
  return { ok: true };
}

/**
 * 입고완료 처리: 입고 대장 행을 실제 IT재고 자산으로 등록합니다. 재고 등록은 새로 만들지 않고
 * 기존 createAsset(app/actions.ts)을 그대로 호출합니다 — DATA_SOURCE에 따른 시트/Supabase 분기,
 * 검증, 재고 화면 revalidate가 이미 다 처리돼 있습니다. 재고 등록이 실패하면(예: 이미 존재하는
 * 자산번호) 입고 행은 '입고대기' 그대로 남겨서 입고 기록이 깨지지 않게 합니다.
 */
export async function completeReceiving(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(RECEIVING_TABLE).select('*').eq('id', id).single();
  if (error || !data) return { ok: false, error: '입고 건을 찾지 못했어요.' };

  const entry = rowToReceiving(data as ReceivingRow);
  if (entry.status === '입고완료') return { ok: false, error: '이미 입고완료 처리된 건이에요.' };

  const missing = missingRequiredFields(entry);
  if (missing.length > 0) {
    return { ok: false, error: `다음 항목을 먼저 입력해주세요: ${missing.join(', ')}` };
  }

  const asset: Asset = {
    assetId: entry.assetId.trim(),
    category: entry.category,
    brand: entry.brand,
    model: entry.model,
    cpu: entry.cpu,
    spec: entry.spec || '확인필요',
    specLabel: '',
    cpuType: '',
    gubunCode: '',
    subItem: '',
    ram: entry.ram,
    storage: entry.storage,
    screen: entry.screen || '-',
    location: entry.location,
    status: '상품화준비중',
    history: entry.kind === '렌탈입고예정' ? '렌탈입고' : '구매입고',
    isNew: true,
    malicious: false,
    serialNo: entry.serialNumber,
  };

  const result = await createAsset(asset);
  if (!result.ok) return result;

  const { error: updateError } = await supabase
    .from(RECEIVING_TABLE)
    .update({ status: '입고완료', completed_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) return { ok: false, error: toMessage(updateError) };

  revalidatePath('/receiving');
  return { ok: true };
}
