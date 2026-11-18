import { Suspense } from 'react';
import InventoryPage from '@/components/InventoryPage';
import PageLoading from '@/components/PageLoading';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { listAssetPurchaseInfoMap } from '@/app/billing/actions';
import type { AssetPurchaseInfo } from '@/lib/billing';
import { DATA_SOURCE } from '@/lib/dataSource';
import { isInventorySheetConfigured, listAllAssets } from '@/lib/inventory/sheets';
import { loadStocktakeConfirmations } from '@/lib/inventory/stocktakeConfirmations';
import { getInventorySpreadsheetUrl } from '@/lib/spreadsheetLink';
import { ASSETS_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { rowToAsset, type Asset, type AssetRow } from '@/lib/types';

// 재고는 매 요청마다 최신 상태를 읽습니다.
export const dynamic = 'force-dynamic';

/**
 * 구매단가/구입처 오버레이(it_asset_purchase_info)를 덮어씁니다 — 저장된 값이 있으면 그걸
 * 우선하고, 없으면 시트에서 읽은 기존 값(데스크탑 등 일부 품목만 있음)을 그대로 둡니다.
 */
function applyPurchaseInfoOverlay(items: Asset[], overlay: Map<string, AssetPurchaseInfo>): Asset[] {
  if (overlay.size === 0) return items;
  return items.map((item) => {
    const info = overlay.get(item.assetId);
    if (!info) return item;
    return {
      ...item,
      vendor: info.purchaseVendor || item.vendor,
      purchasePrice: info.purchasePrice !== null ? String(info.purchasePrice) : item.purchasePrice,
    };
  });
}

/** 재고 원본(구글시트 5개 탭 또는 Supabase)을 읽습니다. 실패하면 화면에 보여 줄 안내를 돌려줍니다. */
async function loadItems(): Promise<{ items: Asset[] } | { error: string }> {
  if (DATA_SOURCE === 'sheets') {
    try {
      return { items: await listAllAssets() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const { data, error } = await createAdminClient()
    .from(ASSETS_TABLE)
    .select('*')
    // 새로 등록한 자산이 위로. 같은 시각에 들어온 시드는 입력 순서를 유지합니다.
    .order('created_at', { ascending: false })
    .order('seq', { ascending: true });
  if (error) return { error: error.message };
  return { items: ((data ?? []) as AssetRow[]).map(rowToAsset) };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset: initialAssetId } = await searchParams;

  if (DATA_SOURCE === 'sheets' ? !isInventorySheetConfigured() : !isSupabaseConfigured()) {
    return (
      <Shell activeMenu="IT 재고 리스트" title="🖥️ IT 재고 리스트">
        <SetupGuide source={DATA_SOURCE} />
      </Shell>
    );
  }

  // 메뉴·제목은 바로 보내고, 시트를 읽는 동안(0.5~1초) 본문 자리에 "불러오는 중"을 보여 줍니다.
  return (
    <Shell activeMenu="IT 재고 리스트" title="🖥️ IT 재고 리스트" note="영업 → 재고관리로 전달된 건만. 본인 팀 큐.">
      <Suspense fallback={<PageLoading label="IT 재고 시트를 읽는 중이에요" />}>
        <InventoryContent initialAssetId={initialAssetId ?? null} />
      </Suspense>
    </Shell>
  );
}

async function InventoryContent({ initialAssetId }: { initialAssetId: string | null }) {
  // 시트 읽기와 Supabase 두 가지(구매정보·실재고 확인)를 동시에 — 예전엔 하나씩 차례로 기다렸음.
  const [loaded, overlay, stocktakeConfirmations] = await Promise.all([
    loadItems(),
    listAssetPurchaseInfoMap(),
    loadStocktakeConfirmations(),
  ]);

  if ('error' in loaded) {
    return <SetupGuide source={DATA_SOURCE} error={loaded.error} />;
  }

  return (
    <InventoryPage
      items={applyPurchaseInfoOverlay(loaded.items, overlay)}
      dataSource={DATA_SOURCE}
      spreadsheetUrl={getInventorySpreadsheetUrl()}
      stocktakeConfirmations={stocktakeConfirmations}
      initialAssetId={initialAssetId}
    />
  );
}
