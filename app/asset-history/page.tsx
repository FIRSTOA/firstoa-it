import AssetHistoryTable from '@/components/AssetHistoryTable';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { rowToAssetMovement, type AssetMovementRow } from '@/lib/assetMovements';
import { ASSET_MOVEMENTS_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';

// 이력은 매 요청마다 최신 상태를 읽습니다.
export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="자산 이력" title="🕘 자산 이력">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/asset_lifecycle_schema.sql" />
      </Shell>
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(ASSET_MOVEMENTS_TABLE)
    .select('*')
    .order('moved_at', { ascending: false })
    .limit(500);

  if (error) {
    return (
      <Shell activeMenu="자산 이력" title="🕘 자산 이력">
        <SetupGuide error={error.message} schemaFile="supabase/asset_lifecycle_schema.sql" />
      </Shell>
    );
  }

  const movements = ((data ?? []) as AssetMovementRow[]).map(rowToAssetMovement);

  return (
    <Shell activeMenu="자산 이력" title="🕘 자산 이력" note="자산 위치·상태 변경 이력 (최근 500건)">
      <AssetHistoryTable movements={movements} />
    </Shell>
  );
}
