import InventoryPage from '@/components/InventoryPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { DATA_SOURCE } from '@/lib/dataSource';
import { isInventorySheetConfigured, listAllAssets } from '@/lib/inventory/sheets';
import { getInventorySpreadsheetUrl } from '@/lib/spreadsheetLink';
import { ASSETS_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { rowToAsset, type AssetRow } from '@/lib/types';

// 재고는 매 요청마다 최신 상태를 읽습니다.
export const dynamic = 'force-dynamic';

export default async function Page() {
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

    return (
      <Shell
        activeMenu="IT 재고 리스트"
        title="🖥️ IT 재고 리스트"
        note="영업 → 재고관리로 전달된 건만. 본인 팀 큐."
      >
        <InventoryPage items={items} dataSource="sheets" spreadsheetUrl={getInventorySpreadsheetUrl()} />
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

  const items = ((data ?? []) as AssetRow[]).map(rowToAsset);

  return (
    <Shell
      activeMenu="IT 재고 리스트"
      title="🖥️ IT 재고 리스트"
      note="영업 → 재고관리로 전달된 건만. 본인 팀 큐."
    >
      <InventoryPage items={items} dataSource="supabase" spreadsheetUrl={getInventorySpreadsheetUrl()} />
    </Shell>
  );
}
