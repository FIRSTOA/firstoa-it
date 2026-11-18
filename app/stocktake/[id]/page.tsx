import { notFound } from 'next/navigation';
import { listStaffNames } from '@/app/actions';
import { listAllAssetsUnified } from '@/app/stocktake/actions';
import Shell from '@/components/Shell';
import StocktakeSessionPage from '@/components/stocktake/StocktakeSessionPage';
import { rowToStocktakeSession, toKstDateKey, type StocktakeSessionRow } from '@/lib/stocktake';
import { createAdminClient, STOCKTAKE_TABLE } from '@/lib/supabase/server';
import { looksLikeShelfLocation } from '@/lib/zoneStatus';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 다음 조사 위치 고르기용 선반 목록은 IT재고 시트를 읽어야 해서 느립니다 — 기다리지 않고
  // 조사 화면부터 보낸 뒤, 도착하면 채웁니다(useStreamedValue).
  const locations = listAllAssetsUnified()
    .then((assets) =>
      Array.from(new Set(assets.map((a) => a.location.trim()).filter(Boolean)))
        .filter(looksLikeShelfLocation)
        .sort(),
    )
    .catch(() => [] as string[]);

  const supabase = createAdminClient();
  const [{ data, error }, allSessionsRes, staffNames] = await Promise.all([
    supabase.from(STOCKTAKE_TABLE).select('*').eq('id', id).maybeSingle(),
    supabase.from(STOCKTAKE_TABLE).select('location,status,started_at'),
    listStaffNames(),
  ]);

  if (error || !data) notFound();

  const session = rowToStocktakeSession(data as StocktakeSessionRow);

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
