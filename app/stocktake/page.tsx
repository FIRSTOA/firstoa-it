import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import StocktakeListPage from '@/components/stocktake/StocktakeListPage';
import { rowToStocktakeSession, type StocktakeSessionRow } from '@/lib/stocktake';
import { createAdminClient, isSupabaseConfigured, STOCKTAKE_TABLE } from '@/lib/supabase/server';
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

  const supabase = createAdminClient();
  const [{ data, error }, assets] = await Promise.all([
    supabase.from(STOCKTAKE_TABLE).select('*').order('seq', { ascending: false }),
    listAllAssetsUnified().catch(() => []),
  ]);

  if (error) {
    return (
      <Shell activeMenu="실재고 조사" title="📋 실재고 조사">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/stocktake_schema.sql" error={error.message} />
      </Shell>
    );
  }

  const sessions = ((data ?? []) as StocktakeSessionRow[]).map(rowToStocktakeSession);
  const locations = Array.from(new Set(assets.map((a) => a.location.trim()).filter(Boolean))).sort();

  return (
    <Shell activeMenu="실재고 조사" title="📋 실재고 조사" note="위치별로 돌아보며 전산 재고와 실물을 맞춰보는 조사예요.">
      <StocktakeListPage sessions={sessions} locations={locations} />
    </Shell>
  );
}
