import InventoryPage from '@/components/InventoryPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { ASSETS_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { rowToAsset, type AssetRow } from '@/lib/types';

// 재고는 매 요청마다 최신 상태를 읽습니다.
export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell>
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
      <Shell>
        <SetupGuide error={error.message} />
      </Shell>
    );
  }

  const items = ((data ?? []) as AssetRow[]).map(rowToAsset);

  return (
    <Shell>
      <InventoryPage items={items} />
    </Shell>
  );
}
