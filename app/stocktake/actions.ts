'use server';

import { revalidatePath } from 'next/cache';
import { extractSaleInfoFromImage, isOcrConfigured } from '@/lib/ocr';
import { DATA_SOURCE } from '@/lib/dataSource';
import { getAssetFromSheets, listAllAssets } from '@/lib/inventory/sheets';
import {
  buildInitialResults,
  rowToStocktakeSession,
  type StocktakeItem,
  type StocktakeItemStatus,
  type StocktakeSession,
  type StocktakeSessionRow,
} from '@/lib/stocktake';
import { rowToAsset, type Asset, type AssetRow } from '@/lib/types';
import { ASSETS_TABLE, createAdminClient, STOCKTAKE_TABLE } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '42P01') return '테이블이 없어요. supabase/stocktake_schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
}

/** DATA_SOURCE에 맞는 쪽에서 전체 자산을 읽습니다 (app/page.tsx와 동일한 분기). */
export async function listAllAssetsUnified(): Promise<Asset[]> {
  if (DATA_SOURCE === 'sheets') return listAllAssets();

  const supabase = createAdminClient();
  const { data, error } = await supabase.from(ASSETS_TABLE).select('*');
  if (error) throw new Error(error.message);
  return ((data ?? []) as AssetRow[]).map(rowToAsset);
}

export async function startStocktake(
  location: string,
  startedBy: string,
): Promise<ActionResult & { id?: string }> {
  const loc = location.trim();
  if (!loc) return { ok: false, error: '위치를 입력해주세요.' };

  let assets: Asset[];
  try {
    assets = await listAllAssetsUnified();
  } catch (err) {
    console.error('[stocktake] 자산 목록 조회 실패:', err);
    return { ok: false, error: '전산 재고를 불러오지 못했어요.' };
  }

  const atLocation = assets.filter((a) => a.location.trim() === loc);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(STOCKTAKE_TABLE)
    .insert({
      location: loc,
      started_by: startedBy.trim(),
      results: buildInitialResults(atLocation),
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[stocktake] startStocktake 실패:', error);
    return { ok: false, error: toMessage(error ?? { message: '알 수 없는 오류' }) };
  }

  revalidatePath('/stocktake');
  return { ok: true, id: (data as { id: string }).id };
}

async function loadSession(id: string): Promise<StocktakeSession | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(STOCKTAKE_TABLE).select('*').eq('id', id).single();
  if (error || !data) return null;
  return rowToStocktakeSession(data as StocktakeSessionRow);
}

export async function updateStocktakeItem(
  sessionId: string,
  assetId: string,
  status: StocktakeItemStatus,
  note = '',
): Promise<ActionResult> {
  const session = await loadSession(sessionId);
  if (!session) return { ok: false, error: '조사 세션을 찾지 못했어요.' };

  const results: StocktakeItem[] = session.results.map((r) =>
    r.assetId === assetId ? { ...r, status, note, scannedAt: new Date().toISOString() } : r,
  );

  const supabase = createAdminClient();
  const { error } = await supabase.from(STOCKTAKE_TABLE).update({ results }).eq('id', sessionId);
  if (error) {
    console.error('[stocktake] updateStocktakeItem 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath(`/stocktake/${sessionId}`);
  return { ok: true };
}

/** 체크박스로 여러 건 골라 한 번에 확인 처리 — 한 번만 읽고 한 번만 써서 N번 왕복하지 않습니다. */
export async function bulkUpdateStocktakeItems(
  sessionId: string,
  assetIds: string[],
  status: StocktakeItemStatus,
): Promise<ActionResult> {
  const session = await loadSession(sessionId);
  if (!session) return { ok: false, error: '조사 세션을 찾지 못했어요.' };

  const idSet = new Set(assetIds);
  const now = new Date().toISOString();
  const results: StocktakeItem[] = session.results.map((r) =>
    idSet.has(r.assetId) ? { ...r, status, scannedAt: now } : r,
  );

  const supabase = createAdminClient();
  const { error } = await supabase.from(STOCKTAKE_TABLE).update({ results }).eq('id', sessionId);
  if (error) {
    console.error('[stocktake] bulkUpdateStocktakeItems 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath(`/stocktake/${sessionId}`);
  return { ok: true };
}

export async function addUnexpectedAssetToSession(sessionId: string, assetId: string): Promise<ActionResult> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호가 비어있어요.' };

  const session = await loadSession(sessionId);
  if (!session) return { ok: false, error: '조사 세션을 찾지 못했어요.' };

  if (session.results.some((r) => r.assetId === trimmed)) {
    return updateStocktakeItem(sessionId, trimmed, '확인됨');
  }

  const found = DATA_SOURCE === 'sheets' ? await getAssetFromSheets(trimmed).catch(() => null) : null;
  if (!found) {
    return { ok: false, error: `자산번호 ${trimmed}를 전산 재고에서 찾지 못했어요.` };
  }

  const newItem: StocktakeItem = {
    assetId: found.assetId,
    category: found.category,
    model: found.model,
    brand: found.brand,
    status: '목록외발견',
    scannedAt: new Date().toISOString(),
    note: `원래 위치: ${found.location || '-'}`,
  };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from(STOCKTAKE_TABLE)
    .update({ results: [...session.results, newItem] })
    .eq('id', sessionId);
  if (error) {
    console.error('[stocktake] addUnexpectedAssetToSession 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath(`/stocktake/${sessionId}`);
  return { ok: true };
}

export type OcrScanResult = { ok: true; assetId: string } | { ok: false; error: string };

export async function ocrScanAssetLabel(base64Image: string, mediaType: string): Promise<OcrScanResult> {
  if (!isOcrConfigured()) {
    return { ok: false, error: 'OCR 기능을 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.' };
  }
  try {
    const fields = await extractSaleInfoFromImage(base64Image, mediaType);
    if (!fields.assetId) {
      return { ok: false, error: '사진에서 자산번호를 읽지 못했어요.' };
    }
    return { ok: true, assetId: fields.assetId };
  } catch (err) {
    console.error('[stocktake] ocrScanAssetLabel 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'OCR 인식에 실패했어요.' };
  }
}

export async function deleteStocktakeSession(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(STOCKTAKE_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[stocktake] deleteStocktakeSession 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  revalidatePath('/stocktake');
  return { ok: true };
}

export async function completeStocktake(sessionId: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from(STOCKTAKE_TABLE)
    .update({ status: '완료', completed_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) {
    console.error('[stocktake] completeStocktake 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/stocktake');
  revalidatePath(`/stocktake/${sessionId}`);
  return { ok: true };
}
