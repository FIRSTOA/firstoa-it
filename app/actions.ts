'use server';

import { revalidatePath } from 'next/cache';
import { DATA_SOURCE } from '@/lib/dataSource';
import {
  cancelReservationInSheet,
  createAssetInSheet,
  deleteAssetFromSheet,
  reserveAssetInSheet,
  updateAssetInSheet,
} from '@/lib/inventory/sheets';
import { lookupRentalByAssetId } from '@/lib/rentals/server';
import { ASSETS_TABLE, createAdminClient } from '@/lib/supabase/server';
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

export async function createAsset(asset: Asset): Promise<ActionResult> {
  const invalid = validate(asset);
  if (invalid) return { ok: false, error: invalid };

  if (DATA_SOURCE === 'sheets') {
    try {
      await createAssetInSheet(asset);
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

export type RentalLookupActionResult =
  | { found: true; model: string | null; serialNo: string | null; specHint: string | null }
  | { found: false };

/** 자산번호로 임대리스트(구글시트)에서 모델명/시리얼을 조회합니다. AssetModal의 자동완성이 씁니다. */
export async function lookupRentalAsset(assetId: string): Promise<RentalLookupActionResult> {
  const result = await lookupRentalByAssetId(assetId);
  if (!result) return { found: false };
  return { found: true, model: result.model, serialNo: result.serialNo, specHint: result.specHint };
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
