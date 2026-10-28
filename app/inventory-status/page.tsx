import { listSafetyStock } from '@/app/inventoryStatus/actions';
import { listAllAssetsUnified } from '@/app/stocktake/actions';
import InventoryStatusPage from '@/components/inventoryStatus/InventoryStatusPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { loadStocktakeConfirmations } from '@/lib/inventory/stocktakeConfirmations';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="재고 현황판" title="📊 재고 현황판">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/zone_status_schema.sql" />
      </Shell>
    );
  }

  const [assets, stocktakeConfirmations, safetyStock] = await Promise.all([
    listAllAssetsUnified().catch(() => []),
    loadStocktakeConfirmations(),
    listSafetyStock(),
  ]);

  return (
    <Shell
      activeMenu="재고 현황판"
      title="📊 재고 현황판"
      note="위치별/품목별 가용 재고 합산 — 렌탈 중 자산은 제외돼요."
    >
      <InventoryStatusPage assets={assets} stocktakeConfirmations={stocktakeConfirmations} safetyStock={safetyStock} />
    </Shell>
  );
}
