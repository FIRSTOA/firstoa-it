import { listStaffNames } from '@/app/actions';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import StocktakeListPage from '@/components/stocktake/StocktakeListPage';
import { rowToStocktakeSession, type StocktakeSessionRow } from '@/lib/stocktake';
import { createAdminClient, isSupabaseConfigured, STOCKTAKE_TABLE } from '@/lib/supabase/server';
import { looksLikeShelfLocation } from '@/lib/zoneStatus';
import { listAllAssetsUnified } from './actions';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="실재고 조사" title="📋 실재고 조사">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/stocktake_schema.sql" />
      </Shell>
    );
  }

  // 선반 위치 목록은 IT재고 시트 5개 탭을 읽어야 해서 느립니다. 기다리지 않고 조사 목록부터
  // 보낸 뒤, 도착하면 화면이 채웁니다(useStreamedValue).
  // "반출"/"분실"/"폐기" 등 선반 위치가 아닌 상태성 값은 조사 대상 위치 목록에서 뺍니다
  // (실재고조사는 선반에 실물이 있는지 확인하는 작업이라, 선반 코드만 의미 있음).
  const locations = listAllAssetsUnified()
    .then((assets) =>
      Array.from(new Set(assets.map((a) => a.location.trim()).filter(Boolean)))
        .filter(looksLikeShelfLocation)
        .sort(),
    )
    .catch(() => [] as string[]);

  const supabase = createAdminClient();
  const [{ data, error }, staffNames] = await Promise.all([
    supabase.from(STOCKTAKE_TABLE).select('*').order('seq', { ascending: false }),
    listStaffNames(),
  ]);

  if (error) {
    return (
      <Shell activeMenu="실재고 조사" title="📋 실재고 조사">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/stocktake_schema.sql" error={error.message} />
      </Shell>
    );
  }

  const sessions = ((data ?? []) as StocktakeSessionRow[]).map(rowToStocktakeSession);

  return (
    <Shell activeMenu="실재고 조사" title="📋 실재고 조사" note="위치별로 돌아보며 전산 재고와 실물을 맞춰보는 조사예요.">
      <StocktakeListPage sessions={sessions} locations={locations} staffNames={staffNames} />
    </Shell>
  );
}
