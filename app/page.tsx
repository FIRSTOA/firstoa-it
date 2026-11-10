import InventoryPage from '@/components/InventoryPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { listAssetPurchaseInfoMap } from '@/app/billing/actions';
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
async function applyPurchaseInfoOverlay(items: Asset[]): Promise<Asset[]> {
  const overlay = await listAssetPurchaseInfoMap();
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

export default async function Page({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset: initialAssetId } = await searchParams;

  if (DATA_SOURCE === 'sheets') {
    if (!isInventorySheetConfigured()) {
      return (
        <Shell activeMenu="IT 재고 리스트" title="🖥️ IT 재고 리스트">
          <SetupGuide source="sheets" />
        </Shell>
      );
    }

    let items;
    try {
      items = await listAllAssets();
    } catch (err) {
      return (
        <Shell activeMenu="IT 재고 리스트" title="🖥️ IT 재고 리스트">
          <SetupGuide source="sheets" error={err instanceof Error ? err.message : String(err)} />
        </Shell>
      );
    }

    items = await applyPurchaseInfoOverlay(items);
    const stocktakeConfirmations = await loadStocktakeConfirmations();

    return (
      <Shell
        activeMenu="IT 재고 리스트"
        title="🖥️ IT 재고 리스트"
        note="영업 → 재고관리로 전달된 건만. 본인 팀 큐."
      >
        <InventoryPage
          items={items}
          dataSource="sheets"
          spreadsheetUrl={getInventorySpreadsheetUrl()}
          stocktakeConfirmations={stocktakeConfirmations}
          initialAssetId={initialAssetId ?? null}
        />
      </Shell>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="IT 재고 리스트" title="🖥️ IT 재고 리스트">
        <SetupGuide />
      </Shell>
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(ASSETS_TABLE)
    .select('*')
    // 새로 등록한 자산이 위로. 같은 시각에 들어온 시드는 입력 순서를 유지합니다.
    .order('created_at', { ascending: false })
    .order('seq', { ascending: true });

  if (error) {
    return (
      <Shell activeMenu="IT 재고 리스트" title="🖥️ IT 재고 리스트">
        <SetupGuide error={error.message} />
      </Shell>
    );
  }

  const items = await applyPurchaseInfoOverlay(((data ?? []) as AssetRow[]).map(rowToAsset));
  const stocktakeConfirmations = await loadStocktakeConfirmations();

  return (
    <Shell
      activeMenu="IT 재고 리스트"
      title="🖥️ IT 재고 리스트"
      note="영업 → 재고관리로 전달된 건만. 본인 팀 큐."
    >
      <InventoryPage
        items={items}
        dataSource="supabase"
        spreadsheetUrl={getInventorySpreadsheetUrl()}
        stocktakeConfirmations={stocktakeConfirmations}
        initialAssetId={initialAssetId ?? null}
      />
    </Shell>
  );
}
