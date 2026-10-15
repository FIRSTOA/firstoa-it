import { notFound } from 'next/navigation';
import { listStaffNames } from '@/app/actions';
import { listAllAssetsUnified } from '@/app/stocktake/actions';
import Shell from '@/components/Shell';
import StocktakeSessionPage from '@/components/stocktake/StocktakeSessionPage';
import { rowToStocktakeSession, toKstDateKey, type StocktakeSessionRow } from '@/lib/stocktake';
import { createAdminClient, STOCKTAKE_TABLE } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const [{ data, error }, allSessionsRes, assets, staffNames] = await Promise.all([
    supabase.from(STOCKTAKE_TABLE).select('*').eq('id', id).maybeSingle(),
    supabase.from(STOCKTAKE_TABLE).select('location,status,started_at'),
    listAllAssetsUnified().catch(() => []),
    listStaffNames(),
  ]);

  if (error || !data) notFound();

  const session = rowToStocktakeSession(data as StocktakeSessionRow);
  const locations = Array.from(new Set(assets.map((a) => a.location.trim()).filter(Boolean))).sort();

  // "조사 종료" 직후 바로 다음 위치를 시작할 수 있게 — 오늘 이미 완료된 위치는
  // 목록 페이지(StocktakeListPage)와 동일하게 빼서 또 찾아 헤매지 않게 합니다.
  const todayKey = toKstDateKey(new Date().toISOString());
  const todaySessions = (allSessionsRes.data ?? []) as { location: string; status: string; started_at: string }[];
  const completedTodayLocations = Array.from(
    new Set(
      todaySessions
        .filter((s) => s.status === '완료' && toKstDateKey(s.started_at) === todayKey)
        .map((s) => s.location),
    ),
  );

  return (
    <Shell activeMenu="실재고 조사" title={`📋 실재고 조사 — ${session.location}`}>
      <StocktakeSessionPage
        session={session}
        locations={locations}
        staffNames={staffNames}
        completedTodayLocations={completedTodayLocations}
      />
    </Shell>
  );
}
