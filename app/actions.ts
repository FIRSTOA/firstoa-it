'use server';

import { revalidatePath } from 'next/cache';
import { DATA_SOURCE } from '@/lib/dataSource';
import {
  cancelReservationInSheet,
  createAssetInSheet,
  deleteAssetFromSheet,
  getAssetFromSheets,
  reserveAssetInSheet,
  updateAssetInSheet,
} from '@/lib/inventory/sheets';
import { lookupRentalByAssetId } from '@/lib/rentals/server';
import { ASSET_MOVEMENTS_TABLE, ASSETS_TABLE, createAdminClient, RECEIVING_TABLE } from '@/lib/supabase/server';
import { seedData } from '@/lib/seed';
import { assetToRow, type Asset } from '@/lib/types';

export type ActionResult = { ok: true } | { ok: false; error: string };
export type BulkResult = { ok: true; count: number } | { ok: false; error: string };

function validate(asset: Asset): string | null {
  if (!asset.assetId.trim()) return '자산번호는 필수예요.';
  if (!asset.model.trim()) return '모델명은 필수예요.';
  return null;
}

/** Supabase 오류를 사용자가 읽을 수 있는 한국어 메시지로 바꿉니다. */
function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '23505') return '이미 존재하는 자산번호예요.';
  if (error.code === '23514') return '상태 또는 품목 값이 올바르지 않아요.';
  if (error.code === '42P01') return '테이블이 없어요. supabase/schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
}

/** lib/inventory/sheets.ts 가 던진 에러를 토스트에 보여줄 메시지로 바꿉니다. */
function toSheetMessage(err: unknown): string {
  return err instanceof Error ? err.message : '구글시트 작업에 실패했어요.';
}

export async function createAsset(asset: Asset, movementMemo?: string): Promise<ActionResult> {
  const invalid = validate(asset);
  if (invalid) return { ok: false, error: invalid };

  if (DATA_SOURCE === 'sheets') {
    try {
      await createAssetInSheet(asset, movementMemo ? { fromLocation: null, fromStatus: null, memo: movementMemo } : undefined);
    } catch (err) {
      return { ok: false, error: toSheetMessage(err) };
    }
    revalidatePath('/');
    return { ok: true };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from(ASSETS_TABLE).insert(assetToRow(asset));
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/');
  return { ok: true };
}

export async function updateAsset(originalAssetId: string, asset: Asset): Promise<ActionResult> {
  const invalid = validate(asset);
  if (invalid) return { ok: false, error: invalid };

  if (DATA_SOURCE === 'sheets') {
    try {
      await updateAssetInSheet(originalAssetId, asset);
    } catch (err) {
      return { ok: false, error: toSheetMessage(err) };
    }
    revalidatePath('/');
    return { ok: true };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from(ASSETS_TABLE)
    .update(assetToRow(asset))
    .eq('asset_id', originalAssetId);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/');
  return { ok: true };
}

export async function deleteAsset(assetId: string, category?: string): Promise<ActionResult> {
  if (DATA_SOURCE === 'sheets') {
    try {
      await deleteAssetFromSheet(assetId, category);
    } catch (err) {
      return { ok: false, error: toSheetMessage(err) };
    }
    revalidatePath('/');
    return { ok: true };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from(ASSETS_TABLE).delete().eq('asset_id', assetId);
  if (error) return { ok: false, error: `삭제에 실패했어요: ${error.message}` };

  revalidatePath('/');
  return { ok: true };
}

/** 엑셀 업로드로 읽은 자산을 자산번호 기준으로 한 번에 등록/수정합니다. */
export async function bulkUpsertAssets(assets: Asset[]): Promise<BulkResult> {
  if (assets.length === 0) return { ok: false, error: '가져올 데이터가 없어요.' };

  if (DATA_SOURCE === 'sheets') {
    return {
      ok: false,
      error:
        '지금은 구글시트로 운영 중이라 엑셀 일괄 업로드는 꺼져 있어요. "템플릿 다운로드" 형식으로 미리 준비해두시면, 나중에 다른 데이터 소스로 전환할 때 그대로 쓸 수 있어요.',
    };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from(ASSETS_TABLE)
    .upsert(assets.map(assetToRow), { onConflict: 'asset_id' });
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/');
  return { ok: true, count: assets.length };
}

export async function reserveAsset(
  assetId: string,
  category: string,
  reserverName: string,
): Promise<ActionResult> {
  if (DATA_SOURCE !== 'sheets') {
    return { ok: false, error: '지금은 구글시트 연동 중이 아니라 예약 기능이 꺼져 있어요.' };
  }
  try {
    await reserveAssetInSheet(category, assetId, reserverName);
  } catch (err) {
    return { ok: false, error: toSheetMessage(err) };
  }
  revalidatePath('/');
  return { ok: true };
}

export async function cancelReservation(assetId: string, category: string): Promise<ActionResult> {
  if (DATA_SOURCE !== 'sheets') {
    return { ok: false, error: '지금은 구글시트 연동 중이 아니라 예약 기능이 꺼져 있어요.' };
  }
  try {
    await cancelReservationInSheet(category, assetId);
  } catch (err) {
    return { ok: false, error: toSheetMessage(err) };
  }
  revalidatePath('/');
  return { ok: true };
}

/**
 * IT재고 리스트의 "수리요청" 버튼 — 외주 수리를 보낼 때 씁니다.
 * 1) 재고 쪽 위치를 "수리발주(업체명)"로 바꿉니다(parseLocationStatus_가 "수리"를 인식해서
 *    상태가 자동으로 수리중이 되고, 상품화완료/준비중 같은 "내부재고" 집계에서 자연히
 *    빠집니다 — 자산 자체를 지우지 않아서 돌아왔을 때 같은 행에 이력이 이어집니다).
 * 2) 입고 대장에 수리입고예정 건을 만들어서, 수리 끝나고 돌아오면 입고완료 처리로
 *    (귀환자산 로직 그대로 재사용) 위치만 원래대로 돌려놓을 수 있게 합니다.
 */
export async function requestRepair(asset: Asset, repairVendor: string): Promise<ActionResult> {
  const vendor = repairVendor.trim();
  const newLocation = vendor ? `수리발주(${vendor})` : '수리발주';

  const updateResult = await updateAsset(asset.assetId, { ...asset, location: newLocation });
  if (!updateResult.ok) return updateResult;

  const supabase = createAdminClient();
  const { error } = await supabase.from(RECEIVING_TABLE).insert({
    kind: '수리입고예정',
    status: '입고대기',
    category: asset.category,
    brand: asset.brand,
    model: asset.model,
    cpu: asset.cpu,
    spec: asset.spec,
    ram: asset.ram,
    storage: asset.storage,
    screen: asset.screen,
    vendor,
    purchase_price: '',
    expected_date: null,
    manager: '',
    notes: `수리 발주 — 기존 위치: ${asset.location || '-'}`,
    asset_id: asset.assetId,
    serial_number: asset.serialNo,
    location: '',
    quantity: 1,
  });
  if (error) {
    console.error('[actions] requestRepair 입고 대장 생성 실패:', error);
    return { ok: false, error: `재고는 수리중으로 바뀌었지만 입고 대장 등록에 실패했어요: ${error.message}` };
  }

  revalidatePath('/receiving');
  return { ok: true };
}

/**
 * 자산 상세 팝업의 "메모 추가" — 파손/분실 같은, 위치·상태 변경 없이 그냥 기록만 남기고
 * 싶은 내용을 자산 이력(/asset-history)에 남깁니다. 새 테이블을 만들지 않고 기존
 * asset_movements를 그대로 재사용합니다 — from/to가 전부 비어있는 행은 "위치 이동" 없이
 * 순수 메모 한 줄로 취급됩니다(AssetHistoryTable이 "(신규) → (없음)"처럼 보여주는 대신
 * memo만 읽도록 이미 메모 우선으로 표시함).
 */
export type AssetNoteEntry = { id: string; movedAt: string; memo: string; fromLocation: string | null; toLocation: string | null };

/**
 * 자산 상세 팝업의 "작업 이력(앱 기록)" — asset_movements를 자산번호로 조회합니다. 구글시트
 * 비고(이동/작업 이력 섹션, parseHistoryEntries)는 과거부터 수기로 적어온 원문이고, 이쪽은
 * 이 앱이 신규등록/위치수정/수리요청/메모 때마다 자동으로 쌓은 구조화된 기록이라 따로
 * 보여줍니다 — 상세 팝업을 열 때만 조회해서(목록엔 전체 Asset 데이터만 있고 이 로그는 없음)
 * 평소 재고 목록 로딩은 그대로 가볍게 유지합니다.
 */
export async function listAssetMovements(assetId: string): Promise<AssetNoteEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(ASSET_MOVEMENTS_TABLE)
    .select('id,moved_at,memo,from_location,to_location')
    .eq('asset_number', assetId)
    .order('moved_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[actions] listAssetMovements 실패:', error);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    movedAt: row.moved_at as string,
    memo: row.memo as string,
    fromLocation: row.from_location as string | null,
    toLocation: row.to_location as string | null,
  }));
}

export async function logAssetNote(assetId: string, category: string, note: string): Promise<ActionResult> {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, error: '내용을 입력해주세요.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from(ASSET_MOVEMENTS_TABLE).insert({
    asset_number: assetId,
    category,
    from_location: null,
    to_location: null,
    from_status: null,
    to_status: null,
    actor: '',
    memo: trimmed,
  });
  if (error) {
    console.error('[actions] logAssetNote 실패:', error);
    return { ok: false, error: `메모 저장에 실패했어요: ${error.message}` };
  }

  revalidatePath('/asset-history');
  return { ok: true };
}

export type RentalLookupActionResult =
  | { found: true; model: string | null; serialNo: string | null; specHint: string | null }
  | { found: false };

/** 자산번호로 임대리스트(구글시트)에서 모델명/시리얼을 조회합니다. AssetModal의 자동완성이 씁니다. */
export async function lookupRentalAsset(assetId: string): Promise<RentalLookupActionResult> {
  const result = await lookupRentalByAssetId(assetId);
  if (!result) return { found: false };
  return { found: true, model: result.model, serialNo: result.serialNo, specHint: result.specHint };
}

export type KnownAssetLookupResult =
  | {
      found: true;
      source: 'inventory' | 'rental';
      category: string;
      brand: string;
      model: string;
      cpu: string;
      spec: string;
      ram: string;
      storage: string;
      screen: string;
      serialNo: string;
    }
  | { found: false };

/**
 * 자산번호로 "기존에 이미 있는 데이터"를 통합 조회합니다 — 먼저 IT재고 구글시트(더 정확/최신)를
 * 찾아보고, 없으면 임대리스트에서 재시도합니다. 입고 대장의 붙여넣기 등록(자산번호가 이미
 * 정해진 귀환자산 케이스)과 수동 등록 폼(ReceivingModal)의 자산번호 자동조회가 함께 씁니다.
 */
export async function lookupKnownAsset(assetId: string): Promise<KnownAssetLookupResult> {
  const trimmed = assetId.trim();
  if (!trimmed) return { found: false };

  if (DATA_SOURCE === 'sheets') {
    const asset = await getAssetFromSheets(trimmed);
    if (asset) {
      return {
        found: true,
        source: 'inventory',
        category: asset.category,
        brand: asset.brand,
        model: asset.model,
        cpu: asset.cpu,
        spec: asset.spec,
        ram: asset.ram,
        storage: asset.storage,
        screen: asset.screen,
        serialNo: asset.serialNo,
      };
    }
  }

  const rental = await lookupRentalByAssetId(trimmed);
  if (rental) {
    return {
      found: true,
      source: 'rental',
      category: '',
      brand: '',
      model: rental.model ?? '',
      cpu: '',
      spec: '',
      ram: '',
      storage: '',
      screen: '',
      serialNo: rental.serialNo ?? '',
    };
  }

  return { found: false };
}

/** 테이블을 비우고 lib/seed.ts 의 샘플 데이터로 되돌립니다. */
export async function resetToSeed(): Promise<ActionResult> {
  const supabase = createAdminClient();

  const { error: deleteError } = await supabase.from(ASSETS_TABLE).delete().gt('seq', 0);
  if (deleteError) return { ok: false, error: `초기화에 실패했어요: ${deleteError.message}` };

  const { error: insertError } = await supabase
    .from(ASSETS_TABLE)
    .insert(seedData.map(assetToRow));
  if (insertError) return { ok: false, error: toMessage(insertError) };

  revalidatePath('/');
  return { ok: true };
}
