import { Suspense } from 'react';
import { listSafetyStock } from '@/app/inventoryStatus/actions';
import { listAllAssetsUnified } from '@/app/stocktake/actions';
import InventoryStatusPage from '@/components/inventoryStatus/InventoryStatusPage';
import PageLoading from '@/components/PageLoading';
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

  // 메뉴·제목은 바로 보내고, IT재고 시트를 읽는 동안 본문 자리에 "불러오는 중"을 보여 줍니다.
  return (
    <Shell
      activeMenu="재고 현황판"
      title="📊 재고 현황판"
      note="위치별/품목별 가용 재고 합산 — 렌탈 중 자산은 제외돼요."
    >
      <Suspense fallback={<PageLoading label="IT 재고 시트를 읽는 중이에요" />}>
        <InventoryStatusContent />
      </Suspense>
    </Shell>
  );
}

async function InventoryStatusContent() {
  const [assets, stocktakeConfirmations, safetyStock] = await Promise.all([
    listAllAssetsUnified().catch(() => []),
    loadStocktakeConfirmations(),
    listSafetyStock(),
  ]);
  return <InventoryStatusPage assets={assets} stocktakeConfirmations={stocktakeConfirmations} safetyStock={safetyStock} />;
}
