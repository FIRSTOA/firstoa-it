'use server';

import { revalidatePath } from 'next/cache';
import { createAsset, updateAsset } from '@/app/actions';
import { DATA_SOURCE } from '@/lib/dataSource';
import { getAssetFromSheets } from '@/lib/inventory/sheets';
import {
  missingRequiredFields,
  receivingInputToRow,
  rowToReceiving,
  type ReceivingEntry,
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

/**
 * 신규 자산 등록 시 자산 이력(/asset-history)에 "언제 어디서 얼마에 매입했는지"가 남도록,
 * 입고 대장에 이미 있는 발주처/매입가를 등록 메모에 넣습니다. 나중에 자산번호로 이력을
 * 검색하면 이 메모가 맨 처음(가장 오래된) 행으로 나와요.
 */
function buildPurchaseMemo(entry: ReceivingEntry): string {
  const kind = entry.kind === '렌탈입고예정' ? '렌탈입고' : '구매입고';
  const parts = [kind];
  if (entry.vendor.trim()) parts.push(`발주처: ${entry.vendor.trim()}`);
  if (entry.purchasePrice.trim()) parts.push(`매입가: ${entry.purchasePrice.trim()}`);
  return parts.join(' / ');
}

/**
 * 수량만큼 행을 만듭니다. **기타주변기기는 예외**(소모성 재고 — 랜선/어댑터 등은 개별
 * 자산번호로 관리하지 않음) — 행을 늘리지 않고 1행에 quantity로 수량을 담습니다.
 * 나머지 품목은 기존대로 1행 = 1대 기준으로 수량만큼 행을 복제합니다.
 */
export async function createReceiving(entry: ReceivingInput, quantity: number): Promise<ActionResult> {
  const invalid = validate(entry);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();

  if (entry.category === '기타주변기기') {
    const qty = Math.min(Math.max(Math.trunc(quantity) || 1, 1), 999999);
    const { error } = await supabase.from(RECEIVING_TABLE).insert({ ...receivingInputToRow(entry), quantity: qty });
    if (error) {
      console.error('[receiving] createReceiving(소모성) 실패:', error);
      return { ok: false, error: toMessage(error) };
    }
    revalidatePath('/receiving');
    return { ok: true };
  }

  const count = Math.min(Math.max(Math.trunc(quantity) || 1, 1), 50);
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
 * - **기타주변기기(소모성)도 개별 자산 행으로 IT재고 시트(기타주변기기 탭)에 반영합니다** —
 *   수량만 의미 있는 재고라도, 사용자가 시트에 기록이 남기를 원해서 다른 품목과 동일하게
 *   자산번호(대개 비어있어 AUTO- 자동생성)로 한 행을 씁니다. 다만 quantity는 재고 자산에는
 *   없는 개념이라 시트에는 반영되지 않고(자산 1건으로만 기록), 수량 자체는 입고 대장 쪽에
 *   그대로 남습니다.
 * - 그 외 품목: 자산번호가 재고에 이미 있으면(렌탈 등으로 나갔다가 돌아오는 귀환자산) 새로
 *   만들지 않고 기존 자산의 위치만 입고 대장의 위치로 업데이트합니다(브랜드/모델/사양 등
 *   나머지는 재고 쪽 기존 값을 그대로 유지 — 입고 대장 값으로 덮어쓰지 않음). 없으면 신규
 *   등록하고, 자산번호가 비어있으면 AUTO- 접두어로 번호를 자동 생성합니다.
 * 기존 createAsset/updateAsset(app/actions.ts)을 그대로 호출합니다 — DATA_SOURCE에 따른
 * 시트/Supabase 분기, 검증, 재고 화면 revalidate가 이미 다 처리돼 있습니다. 재고 쪽이
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
    : await createAsset(
        {
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
        },
        buildPurchaseMemo(entry),
      );
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
