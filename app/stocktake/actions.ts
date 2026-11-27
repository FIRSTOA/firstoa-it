'use server';

import { revalidatePath } from 'next/cache';
import { createAsset, updateAsset } from '@/app/actions';
import { DATA_SOURCE } from '@/lib/dataSource';
import { getAssetFromSheets, listAllAssets, listAssetsFromSheet } from '@/lib/inventory/sheets';
import {
  buildInitialResults,
  describeSheetReadError,
  isSameShelf,
  mergeTabReads,
  rowToStocktakeSession,
  shelfKeyOf,
  shelfLocationsFrom,
  type StocktakeItem,
  type StocktakeItemStatus,
  type StocktakeSession,
  type StocktakeSessionRow,
} from '@/lib/stocktake';
import { CATEGORIES, rowToAsset, type Asset, type AssetRow } from '@/lib/types';
import { ASSETS_TABLE, createAdminClient, STOCKTAKE_TABLE } from '@/lib/supabase/server';
import { looksLikeShelfLocation } from '@/lib/zoneStatus';

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

/**
 * 실재고 조사용 IT재고 읽기 — listAllAssetsUnified 와 같은 곳을 읽되, 못 읽은 탭을 숨기지 않고 돌려줍니다
 * (listAllAssets 는 못 읽은 탭을 빈 목록으로 바꿈 → 조사 목록·위치 목록이 조용히 빠졌음. mergeTabReads 설명).
 * Supabase 모드는 listAllAssetsUnified 그대로(오류면 throw).
 */
async function readInventoryForStocktake(): Promise<{ assets: Asset[]; failedTabs: string[]; quota: boolean }> {
  if (DATA_SOURCE !== 'sheets') return { assets: await listAllAssetsUnified(), failedTabs: [], quota: false };
  const settled = await Promise.allSettled(CATEGORIES.map((category) => listAssetsFromSheet(category)));
  const { items, failed } = mergeTabReads<Asset>(CATEGORIES, settled);
  for (const f of failed) console.error(`[stocktake] IT재고 "${f.tab}" 탭 읽기 실패:`, f.status ?? '-', f.message);
  return { assets: items, failedTabs: failed.map((f) => f.tab), quota: failed.some((f) => f.status === 429) };
}

function inventoryReadError(failedTabs: string[], quota: boolean, consequence: string): string {
  return (
    `IT재고 시트의 ${failedTabs.join('·')} 탭을 못 읽어서 ${consequence}. ` +
    (quota
      ? '구글시트 읽기 한도(1분에 60번, 앱 전체가 같이 씀)에 걸린 것 같아요 — 1분쯤 뒤에 다시 해 주세요.'
      : '잠시 뒤에 다시 해 주세요.')
  );
}

export type StocktakeLocationsResult =
  | {
      ok: true;
      /** 선반 열쇠(shelfKeyOf) — 조사 시작·남은 위치·다음 후보 */
      shelves: string[];
      /** 시트에 있는 위치 이름 그대로 — "✎ 위치 수정"에서 사람이 고르는 목록 */
      names: string[];
      /** 일부 탭을 못 읽었을 때 보여 줄 문구('' = 전부 읽음) */
      warning: string;
    }
  | { ok: false; error: string };

/**
 * 조사 대상 선반 위치 목록(IT재고 위치 값 중 선반 코드처럼 생긴 것). 화면이 필요할 때만 부릅니다 —
 * page 에서 읽으면 조사 화면의 [확인] 한 번마다(서버 액션의 revalidatePath 가 page 를 다시 그림) 시트 5탭을
 * 또 읽어 읽기 한도를 금방 다 써 버림(components/stocktake/useStocktakeLocations.ts).
 */
export async function loadStocktakeLocations(): Promise<StocktakeLocationsResult> {
  let read: Awaited<ReturnType<typeof readInventoryForStocktake>>;
  try {
    read = await readInventoryForStocktake();
  } catch (err) {
    console.error('[stocktake] 위치 목록용 자산 조회 실패:', err instanceof Error ? err.message : err);
    return { ok: false, error: '전산 재고를 불러오지 못해 위치 목록을 못 만들었어요. 잠시 뒤에 [다시 읽기]를 눌러 주세요.' };
  }
  if (read.failedTabs.length >= CATEGORIES.length) {
    return { ok: false, error: inventoryReadError(read.failedTabs, read.quota, '위치 목록을 못 만들었어요') };
  }
  const { shelves, names } = shelfLocationsFrom(
    read.assets.map((a) => a.location),
    looksLikeShelfLocation,
  );
  const warning = read.failedTabs.length
    ? inventoryReadError(read.failedTabs, read.quota, '그 탭에만 있는 위치는 목록에서 빠졌을 수 있어요')
    : '';
  return { ok: true, shelves, names, warning };
}

type InventoryLookup = { kind: 'found'; asset: Asset } | { kind: 'missing' } | { kind: 'error'; message: string };

/**
 * 자산번호로 IT재고 5탭에서 찾기 — "없음"과 "못 읽음"을 나눔.
 * 예전엔 getAssetFromSheets(...).catch(() => null) 이라 읽기 실패(구글 읽기 한도 429 등)도 "없음"이 되어, 사진 스캔이
 * 다른 위치·다른 탭에 있는 장비를 "신규등록(ERP 미등록)"으로 분류하고 [재고 반영하기]가 시트에 중복 줄을 만들 수 있었음.
 * 시트 모드가 아니면 예전처럼 "없음"(Supabase 모드엔 이 조회가 없었음).
 */
async function lookupInventory(assetId: string): Promise<InventoryLookup> {
  if (DATA_SOURCE !== 'sheets') return { kind: 'missing' };
  try {
    const asset = await getAssetFromSheets(assetId);
    return asset ? { kind: 'found', asset } : { kind: 'missing' };
  } catch (err) {
    const { status, message } = describeSheetReadError(err);
    console.error('[stocktake] IT재고 자산번호 조회 실패:', status ?? '-', message);
    return {
      kind: 'error',
      message:
        'IT재고 시트를 못 읽었어요' +
        (status === 429 ? '(구글시트 읽기 한도 — 1분에 60번, 앱 전체가 같이 씀)' : '') +
        ' — 1분쯤 뒤에 다시 해 주세요.',
    };
  }
}

function alreadyInInventoryMessage(found: Asset): string {
  return `이미 IT재고(${found.category} · 위치 ${found.location || '없음'})에 있는 자산번호라 새 줄을 만들지 않았어요 — 사진을 다시 올리면 위치변경으로 나와요.`;
}

export async function startStocktake(
  location: string,
  startedBy: string,
): Promise<ActionResult & { id?: string }> {
  const loc = location.trim();
  if (!loc) return { ok: false, error: '위치를 입력해주세요.' };

  let read: Awaited<ReturnType<typeof readInventoryForStocktake>>;
  try {
    read = await readInventoryForStocktake();
  } catch (err) {
    console.error('[stocktake] 자산 목록 조회 실패:', err);
    return { ok: false, error: '전산 재고를 불러오지 못했어요.' };
  }
  // 한 탭이라도 못 읽었으면 시작하지 않음 — 조사 목록(results)은 시작할 때 한 번 만들어 저장되므로,
  // 그대로 만들면 그 탭 장비가 영영 빠진 조사가 됨("재고가 안 나타남").
  if (read.failedTabs.length > 0) {
    return {
      ok: false,
      error: inventoryReadError(read.failedTabs, read.quota, '조사를 시작하지 않았어요(그 탭 장비가 조사 목록에서 빠지니까요)'),
    };
  }

  // 선반 단위(사용자 결정 2026-11-27) — "B1" 조사에 "B1수리중"·"b1"·전각 "Ｂ１" 장비도 같이(shelfKeyOf).
  // 장비마다 원래 위치 이름은 results[].location 에 남겨 화면이 구분해 보여 줌. 조사 기록의 위치는 선반 열쇠로 저장.
  const shelf = shelfKeyOf(loc);
  const atLocation = read.assets.filter((a) => shelfKeyOf(a.location) === shelf);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(STOCKTAKE_TABLE)
    .insert({
      location: shelf,
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

export type UnexpectedAssetInfo = {
  assetId: string;
  category: string;
  model: string;
  brand: string;
  location: string;
};

/**
 * 사진 스캔으로 읽은 자산번호가 이 세션 목록에 없을 때, 실제로 전산상 어디 있는 자산인지
 * 미리 보여주기 위한 조회입니다(확정은 addUnexpectedAssetToSession에서). "이 장비는 A3
 * 위치에 있는 장비입니다 — 강제변경하시겠습니까?" 안내에 씁니다.
 */
export async function lookupUnexpectedAsset(
  assetId: string,
): Promise<
  | { ok: true; info: UnexpectedAssetInfo }
  /** readFailed = 시트를 못 읽음(있는지 없는지 모름) — "신규등록"으로 분류하면 안 됨 */
  | { ok: false; error: string; readFailed?: true }
> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호가 비어있어요.' };
  const look = await lookupInventory(trimmed);
  if (look.kind === 'error') return { ok: false, error: look.message, readFailed: true };
  if (look.kind === 'missing') return { ok: false, error: `자산번호 ${trimmed}를 전산 재고에서 찾지 못했어요.` };
  const found = look.asset;
  return {
    ok: true,
    info: { assetId: found.assetId, category: found.category, model: found.model, brand: found.brand, location: found.location },
  };
}

/**
 * relocateTo를 넘기면 "강제변경" — 이 세션에 목록외발견으로 기록할 뿐 아니라, 그 자산의 실제
 * 전산 위치도 이 세션의 위치로 고쳐씁니다(updateAsset 재사용 — 다른 값은 그대로 두고 위치만).
 * 기본(넘기지 않음)은 기존처럼 기록만 하고 실제 재고는 건드리지 않습니다.
 */
export async function addUnexpectedAssetToSession(
  sessionId: string,
  assetId: string,
  relocateTo?: string,
): Promise<ActionResult> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호가 비어있어요.' };

  const session = await loadSession(sessionId);
  if (!session) return { ok: false, error: '조사 세션을 찾지 못했어요.' };

  if (session.results.some((r) => r.assetId === trimmed)) {
    return updateStocktakeItem(sessionId, trimmed, '확인됨');
  }

  const look = await lookupInventory(trimmed);
  if (look.kind === 'error') return { ok: false, error: look.message };
  if (look.kind === 'missing') {
    return { ok: false, error: `자산번호 ${trimmed}를 전산 재고에서 찾지 못했어요.` };
  }
  const found = look.asset;

  // 같은 선반이면 위치 이름을 안 바꿈 — "B1수리중" 장비를 B1 조사에서 찾았다고 "B1"로 고쳐 쓰면 꼬리말(상태)이 사라짐.
  const relocating = Boolean(relocateTo && relocateTo.trim() && !isSameShelf(relocateTo, found.location));
  if (relocating && relocateTo) {
    const relocateResult = await updateAsset(found.assetId, { ...found, location: relocateTo.trim() });
    if (!relocateResult.ok) {
      return { ok: false, error: `위치 강제변경에 실패했어요: ${relocateResult.error}` };
    }
  }

  const newItem: StocktakeItem = {
    assetId: found.assetId,
    category: found.category,
    model: found.model,
    brand: found.brand,
    status: '목록외발견',
    scannedAt: new Date().toISOString(),
    note: relocating
      ? `원래 위치: ${found.location || '-'} → ${relocateTo}로 강제변경함`
      : `원래 위치: ${found.location || '-'}`,
    location: found.location.trim(),
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

/**
 * 사진 일괄 스캔(여러 장)에서 "ERP 미등록" 자산번호를 발견했을 때 — 스티커에 자산번호는
 * 있는데 전산(구글시트)엔 아예 없는 경우, 최소 정보로 신규 등록하고 이 세션에도 확인됨으로
 * 기록합니다. 브랜드/모델 등 자세한 정보는 스티커 사진만으론 알기 어려워서 이후 IT재고
 * 리스트에서 ✎ 수정으로 보완하면 됩니다.
 */
export async function createAssetFromScan(
  sessionId: string,
  assetId: string,
  category: string,
  model: string,
  location: string,
): Promise<ActionResult> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호가 비어있어요.' };

  // 새 줄을 만들기 직전에 5탭 전체에서 다시 확인 — 못 읽었거나 이미 있으면 만들지 않음(중복 줄 방지).
  const look = await lookupInventory(trimmed);
  if (look.kind === 'error') return { ok: false, error: `새 줄을 만들지 않았어요. ${look.message}` };
  if (look.kind === 'found') return { ok: false, error: alreadyInInventoryMessage(look.asset) };

  const asset: Asset = {
    assetId: trimmed,
    category,
    brand: '',
    model: model.trim() || '확인필요',
    cpu: '',
    spec: '확인필요',
    specLabel: '',
    cpuType: '',
    gubunCode: '',
    subItem: '',
    ram: '',
    storage: '',
    screen: '-',
    location,
    status: '상품화준비중',
    history: '실재고 조사 사진 스캔으로 신규 등록',
    isNew: true,
    malicious: false,
    serialNo: '',
  };

  const result = await createAsset(asset);
  if (!result.ok) return result;

  // 방금 만들었으니 getAssetFromSheets로 바로 찾아져서, 이 세션에 "확인됨"으로 기록됩니다.
  return addUnexpectedAssetToSession(sessionId, trimmed);
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export type ReviewApplyInput = {
  assetId: string;
  status: '정상' | '위치변경' | '신규등록';
  category?: string;
  model?: string;
};

export type ReviewApplyResult =
  | { ok: true; successCount: number; failures: string[] }
  | { ok: false; error: string };

/**
 * 사진 일괄 스캔 검토 화면("재고 반영하기")의 배치 처리. 기존엔 항목마다 별도 서버 액션을
 * 순서대로 호출해서(위치변경/신규등록은 세션 results를 매번 읽고 다시 썼음) 느렸고, 여러
 * 건을 동시에 돌리면 세션 results 경쟁 조건(서로 덮어쓰기)이 생길 위험도 있었습니다.
 *
 * 느린 부분(구글시트 조회/쓰기 — 위치변경·신규등록)만 병렬로 처리하고, 세션 results는 맨
 * 마지막에 딱 한 번만 읽고 한 번만 씁니다(bulkUpdateStocktakeItems와 동일한 원칙).
 */
export async function applyStocktakeReviewBatch(
  sessionId: string,
  items: ReviewApplyInput[],
  location: string,
): Promise<ReviewApplyResult> {
  const session = await loadSession(sessionId);
  if (!session) return { ok: false, error: '조사 세션을 찾지 못했어요.' };

  const failures: string[] = [];
  const newItems: StocktakeItem[] = [];

  const slowItems = items.filter((i) => i.status !== '정상');
  await runWithConcurrency(slowItems, 3, async (item) => {
    if (item.status === '위치변경') {
      const look = await lookupInventory(item.assetId);
      if (look.kind === 'error') {
        failures.push(`${item.assetId}: ${look.message}`);
        return;
      }
      if (look.kind === 'missing') {
        failures.push(`${item.assetId}: 전산 재고에서 못 찾았어요.`);
        return;
      }
      const found = look.asset;
      const trimmedLocation = location.trim();
      // 같은 선반("B1" 조사에서 찾은 "B1수리중" 장비 등)이면 위치 이름을 안 바꿈 — 확인만 기록(꼬리말 = 상태가 사라지지 않게).
      const relocating = Boolean(trimmedLocation) && !isSameShelf(trimmedLocation, found.location);
      if (relocating) {
        const relocateResult = await updateAsset(found.assetId, { ...found, location: trimmedLocation });
        if (!relocateResult.ok) {
          failures.push(`${item.assetId}: 위치 변경 실패 - ${relocateResult.error}`);
          return;
        }
      }
      newItems.push({
        assetId: found.assetId,
        category: found.category,
        model: found.model,
        brand: found.brand,
        status: '목록외발견',
        scannedAt: new Date().toISOString(),
        note: relocating
          ? `원래 위치: ${found.location || '-'} → ${trimmedLocation}로 강제변경함`
          : trimmedLocation
            ? `원래 위치: ${found.location || '-'} (같은 선반 — 위치 그대로)`
            : `원래 위치: ${found.location || '-'}`,
        location: found.location.trim(),
      });
    } else if (item.status === '신규등록') {
      const trimmed = item.assetId.trim();
      // 새 줄을 만들기 직전에 5탭 전체에서 다시 확인 — 못 읽었거나(한도 등) 이미 있으면 만들지 않음.
      // 화면 분류가 틀렸어도(예전 화면·조회 실패) 시트에 중복 줄이 생기지 않게 서버가 한 번 더 막음.
      const look = await lookupInventory(trimmed);
      if (look.kind === 'error') {
        failures.push(`${item.assetId}: 새 줄을 만들지 않았어요. ${look.message}`);
        return;
      }
      if (look.kind === 'found') {
        failures.push(`${item.assetId}: ${alreadyInInventoryMessage(look.asset)}`);
        return;
      }
      const asset: Asset = {
        assetId: trimmed,
        category: item.category ?? '',
        brand: '',
        model: (item.model ?? '').trim() || '확인필요',
        cpu: '',
        spec: '확인필요',
        specLabel: '',
        cpuType: '',
        gubunCode: '',
        subItem: '',
        ram: '',
        storage: '',
        screen: '-',
        location: location.trim(),
        status: '상품화준비중',
        history: '실재고 조사 사진 스캔으로 신규 등록',
        isNew: true,
        malicious: false,
        serialNo: '',
      };
      const result = await createAsset(asset);
      if (!result.ok) {
        failures.push(`${item.assetId}: ${result.error}`);
        return;
      }
      newItems.push({
        assetId: trimmed,
        category: asset.category,
        model: asset.model,
        brand: '',
        status: '목록외발견',
        scannedAt: new Date().toISOString(),
        note: '신규 등록(실재고 조사 사진 스캔)',
        location: asset.location,
      });
    }
  });

  // "정상" 항목(이미 이 세션 목록에 있는 자산)은 확인됨으로 상태만 바꿉니다.
  const confirmIds = new Set(
    items.filter((i) => i.status === '정상' && session.results.some((r) => r.assetId === i.assetId)).map((i) => i.assetId),
  );
  const now = new Date().toISOString();
  const updatedResults = session.results.map((r) =>
    confirmIds.has(r.assetId) ? { ...r, status: '확인됨' as const, scannedAt: now } : r,
  );
  const finalResults = [...updatedResults, ...newItems];

  const supabase = createAdminClient();
  const { error } = await supabase.from(STOCKTAKE_TABLE).update({ results: finalResults }).eq('id', sessionId);
  if (error) {
    console.error('[stocktake] applyStocktakeReviewBatch 세션 반영 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath(`/stocktake/${sessionId}`);
  return { ok: true, successCount: confirmIds.size + newItems.length, failures };
}

/**
 * 목록 페이지의 "미확인 자산" 패널에서, 그 자산을 실제로 찾았을 때(또는 원래 위치가
 * 잘못 기재돼 있었을 때) 바로 위치를 고쳐 반영합니다 — 전산 재고(구글시트) 위치를 실제로
 * 바꾸고, 그 자산이 미확인으로 남아있던 세션의 기록도 "확인됨"으로 정리합니다.
 */
export async function relocateMissingAsset(
  sessionId: string,
  assetId: string,
  newLocation: string,
): Promise<ActionResult & { moved?: boolean }> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호가 비어있어요.' };
  const trimmedLocation = newLocation.trim();
  if (!trimmedLocation) return { ok: false, error: '위치를 입력해주세요.' };

  const look = await lookupInventory(trimmed);
  if (look.kind === 'error') return { ok: false, error: look.message };
  if (look.kind === 'missing') return { ok: false, error: `자산번호 ${trimmed}를 전산 재고에서 찾지 못했어요.` };
  const found = look.asset;

  // 사람이 목록(시트에 있는 위치 이름 그대로)에서 고른 이름이라, 글자가 다를 때만 그 이름으로 씀(예전 그대로).
  // 같은 선반이어도 사람이 다른 이름을 골랐으면 씀(꼬리말을 붙이거나 떼는 것도 사람이 정함). 지금 위치 이름을 그대로
  // 고르면 "제자리에서 찾음" = 시트 안 씀(화면이 조사 때 위치 이름에 "(조사 때 위치)"를 붙여 보여 줌).
  const originalLocation = found.location || '-';
  const moved = trimmedLocation !== found.location.trim();
  if (moved) {
    const relocateResult = await updateAsset(found.assetId, { ...found, location: trimmedLocation });
    if (!relocateResult.ok) {
      return { ok: false, error: `위치 변경에 실패했어요: ${relocateResult.error}` };
    }
  }

  const session = await loadSession(sessionId);
  if (!session) return { ok: false, error: '조사 세션을 찾지 못했어요.' };

  const now = new Date().toISOString();
  const results = session.results.map((r) =>
    r.assetId === trimmed
      ? {
          ...r,
          status: '확인됨' as const,
          scannedAt: now,
          note: moved
            ? `위치 수정: ${originalLocation} → ${trimmedLocation}`
            : `제자리에서 찾음(위치 그대로: ${originalLocation})`,
        }
      : r,
  );
  const supabase = createAdminClient();
  const { error } = await supabase.from(STOCKTAKE_TABLE).update({ results }).eq('id', sessionId);
  if (error) {
    console.error('[stocktake] relocateMissingAsset 세션 반영 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath(`/stocktake/${sessionId}`);
  revalidatePath('/stocktake');
  return { ok: true, moved };
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
