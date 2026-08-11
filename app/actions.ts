'use server';

import { revalidatePath } from 'next/cache';
import { ASSETS_TABLE, createAdminClient } from '@/lib/supabase/server';
import { seedData } from '@/lib/seed';
import { assetToRow, type Asset } from '@/lib/types';

export type ActionResult = { ok: true } | { ok: false; error: string };

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

export async function createAsset(asset: Asset): Promise<ActionResult> {
  const invalid = validate(asset);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(ASSETS_TABLE).insert(assetToRow(asset));
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/');
  return { ok: true };
}

export async function updateAsset(originalAssetId: string, asset: Asset): Promise<ActionResult> {
  const invalid = validate(asset);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from(ASSETS_TABLE)
    .update(assetToRow(asset))
    .eq('asset_id', originalAssetId);
  if (error) return { ok: false, error: toMessage(error) };

  revalidatePath('/');
  return { ok: true };
}

export async function deleteAsset(assetId: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(ASSETS_TABLE).delete().eq('asset_id', assetId);
  if (error) return { ok: false, error: `삭제에 실패했어요: ${error.message}` };

  revalidatePath('/');
  return { ok: true };
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
