import { Suspense } from 'react';
import { listSafetyStock } from '@/app/inventoryStatus/actions';
import { listAllAssetsUnified } from '@/app/stocktake/actions';
import InventoryStatusPage from '@/components/inventoryStatus/InventoryStatusPage';
import InventoryReadWarning from '@/components/InventoryReadWarning';
import PageLoading from '@/components/PageLoading';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { loadStocktakeConfirmations } from '@/lib/inventory/stocktakeConfirmations';
import { failAllTabs } from '@/lib/inventory/tabRead';
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
  const [read, stocktakeConfirmations, safetyStock] = await Promise.all([
    // 못 읽은 탭은 read.failed 로 옴 — 예전 .catch(() => []) 처럼 빈 현황판을 말없이 보여 주지 않고 위 띠로 알림
    listAllAssetsUnified().catch((err: unknown) => ({
      assets: [],
      failed: failAllTabs(null, err instanceof Error ? err.message : String(err)),
    })),
    loadStocktakeConfirmations(),
    listSafetyStock(),
  ]);
  return (
    <>
      <InventoryReadWarning failed={read.failed} consequence="현황판의 대수가 모자랄 수 있어요." />
      <InventoryStatusPage assets={read.assets} stocktakeConfirmations={stocktakeConfirmations} safetyStock={safetyStock} />
    </>
  );
}
