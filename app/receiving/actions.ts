'use server';

import { revalidatePath } from 'next/cache';
import { createAsset, updateAsset } from '@/app/actions';
import { DATA_SOURCE } from '@/lib/dataSource';
import { getAssetFromSheets } from '@/lib/inventory/sheets';
import {
  missingRequiredFields,
  receivingInputToRow,
  rowToReceiving,
  type ReceivingInput,
  type ReceivingRow,
} from '@/lib/receiving';
import { rowToAsset, type Asset, type AssetRow } from '@/lib/types';
import { ASSETS_TABLE, createAdminClient, RECEIVING_TABLE } from '@/lib/supabase/server';

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
  if (error) {
    console.error('[receiving] createReceiving 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/receiving');
  return { ok: true };
}

/**
 * 붙여넣기 파싱(lib/receivingParser.ts) 미리보기에서 이미 펼쳐진 행들을 한 번에 등록합니다.
 * createReceiving과 달리 quantity 반복이 없고, 호출부가 넘긴 배열을 그대로 insert합니다.
 */
export async function createReceivingBatch(entries: ReceivingInput[]): Promise<ActionResult> {
  if (entries.length === 0) return { ok: false, error: '등록할 내용이 없어요.' };

  const supabase = createAdminClient();
  const rows = entries.map(receivingInputToRow);
  const { error } = await supabase.from(RECEIVING_TABLE).insert(rows);
  if (error) {
    console.error('[receiving] createReceivingBatch 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/receiving');
  return { ok: true };
}

export async function updateReceiving(id: string, entry: ReceivingInput): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(RECEIVING_TABLE).update(receivingInputToRow(entry)).eq('id', id);
  if (error) {
    console.error('[receiving] updateReceiving 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/receiving');
  return { ok: true };
}

export async function deleteReceiving(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(RECEIVING_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[receiving] deleteReceiving 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  revalidatePath('/receiving');
  return { ok: true };
}

/**
 * 자산번호 없이 입고완료 처리하는 경우(기타주변기기 중 케이블/마우스처럼 개별 번호를 안 붙이는
 * 품목, 또는 거래처로 바로 직송되는 건) 자동으로 번호를 만들어줍니다. "AUTO-" 접두어로 실제
 * 자산 번호와 눈에 띄게 구분되게 합니다.
 */
function generateAssetId(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AUTO-${y}${m}${d}-${rand}`;
}

/** DATA_SOURCE에 맞는 쪽에서 자산번호로 기존 자산을 찾습니다 (귀환자산 판별용). */
async function findExistingAsset(assetId: string): Promise<Asset | null> {
  if (DATA_SOURCE === 'sheets') return getAssetFromSheets(assetId);

  const supabase = createAdminClient();
  const { data } = await supabase.from(ASSETS_TABLE).select('*').eq('asset_id', assetId).maybeSingle();
  return data ? rowToAsset(data as AssetRow) : null;
}

/**
 * 입고완료 처리: 입고 대장 행을 실제 IT재고에 반영합니다.
 * - 자산번호가 재고에 이미 있으면(렌탈 등으로 나갔다가 돌아오는 귀환자산) 새로 만들지 않고
 *   기존 자산의 위치만 입고 대장의 위치로 업데이트합니다(브랜드/모델/사양 등 나머지는 재고 쪽
 *   기존 값을 그대로 유지 — 입고 대장 값으로 덮어쓰지 않음).
 * - 없으면 신규 자산으로 등록합니다.
 * - 자산번호가 비어있으면(기타주변기기 중 개별 번호를 안 붙이는 품목, 또는 거래처 직송 건)
 *   AUTO- 접두어로 번호를 자동 생성해서 신규 등록하고, 입고 대장 행의 자산번호도 그 값으로
 *   채워둡니다.
 * 두 경우 다 기존 createAsset/updateAsset(app/actions.ts)을 그대로 호출합니다 — DATA_SOURCE에
 * 따른 시트/Supabase 분기, 검증, 재고 화면 revalidate가 이미 다 처리돼 있습니다. 재고 쪽이
 * 실패하면(예: 검증 오류) 입고 행은 '입고대기' 그대로 남겨서 입고 기록이 깨지지 않게 합니다.
 */
export async function completeReceiving(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(RECEIVING_TABLE).select('*').eq('id', id).single();
  if (error || !data) {
    console.error('[receiving] completeReceiving 조회 실패:', error);
    return { ok: false, error: '입고 건을 찾지 못했어요.' };
  }

  const entry = rowToReceiving(data as ReceivingRow);
  if (entry.status === '입고완료') return { ok: false, error: '이미 입고완료 처리된 건이에요.' };

  const missing = missingRequiredFields(entry);
  if (missing.length > 0) {
    console.error('[receiving] completeReceiving 필수값 누락:', entry.assetId || entry.seq, missing);
    return { ok: false, error: `다음 항목을 먼저 입력해주세요: ${missing.join(', ')}` };
  }

  const enteredAssetId = entry.assetId.trim();
  const isAutoGenerated = !enteredAssetId;
  const trimmedAssetId = isAutoGenerated ? generateAssetId() : enteredAssetId;
  // 번호가 없던 건은 (신규 생성이니) 기존 자산을 찾아볼 필요가 없습니다.
  const existing = isAutoGenerated ? null : await findExistingAsset(trimmedAssetId);

  const result = existing
    ? await updateAsset(trimmedAssetId, { ...existing, location: entry.location })
    : await createAsset({
        assetId: trimmedAssetId,
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
      });
  if (!result.ok) {
    console.error('[receiving] completeReceiving 자산 반영 실패:', trimmedAssetId, result.error);
    return result;
  }

  const { error: updateError } = await supabase
    .from(RECEIVING_TABLE)
    .update({
      status: '입고완료',
      completed_at: new Date().toISOString(),
      ...(isAutoGenerated ? { asset_id: trimmedAssetId } : {}),
    })
    .eq('id', id);
  if (updateError) {
    console.error('[receiving] completeReceiving 상태 업데이트 실패:', updateError);
    return { ok: false, error: toMessage(updateError) };
  }

  revalidatePath('/receiving');
  return { ok: true };
}
