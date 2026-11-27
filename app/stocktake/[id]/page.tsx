import { notFound } from 'next/navigation';
import { listStaffNames } from '@/app/actions';
import Shell from '@/components/Shell';
import StocktakeSessionPage from '@/components/stocktake/StocktakeSessionPage';
import { kstDayRangeIso, rowToStocktakeSession, toKstDateKey, type StocktakeSessionRow } from '@/lib/stocktake';
import { createAdminClient, STOCKTAKE_TABLE } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 다음 조사 위치 후보(IT재고 시트 5탭)는 여기서 읽지 않음 — 이 page 는 [확인] 한 번마다 서버 액션의
  // revalidatePath 로 다시 그려져서, 여기서 읽으면 그때마다 시트를 5번씩 또 읽어 구글 읽기 한도(분당 60회)를
  // 다 써 버렸음 → [조사 종료] 직후 위치 목록이 비거나 빠짐. 화면이 종료 뒤에만 읽음(useStocktakeLocations).

  // "조사 종료" 직후 바로 다음 위치를 시작할 수 있게 — 오늘(한국 날짜) 시작해서 끝낸 위치는 후보에서 뺌
  // (목록 페이지 StocktakeListPage 와 같은 규칙). DB 에서 오늘 것만 거름 — 전체를 읽으면 Supabase 가
  // 1000줄에서 순서 없이 잘라(2026-11-27 기준 834건) 오늘 끝낸 위치가 빠질 수 있음.
  const today = kstDayRangeIso(toKstDateKey(new Date().toISOString()));
  const supabase = createAdminClient();
  const [{ data, error }, completedTodayRes, staffNames] = await Promise.all([
    supabase.from(STOCKTAKE_TABLE).select('*').eq('id', id).maybeSingle(),
    supabase
      .from(STOCKTAKE_TABLE)
      .select('location')
      .eq('status', '완료')
      .gte('started_at', today.start)
      .lt('started_at', today.end),
    listStaffNames(),
  ]);

  if (error || !data) notFound();

  const session = rowToStocktakeSession(data as StocktakeSessionRow);

  if (completedTodayRes.error) {
    console.error('[stocktake] 오늘 끝낸 위치 조회 실패:', completedTodayRes.error.code, completedTodayRes.error.message);
  }
  const completedTodayLocations = completedTodayRes.error
    ? null
    : Array.from(new Set(((completedTodayRes.data ?? []) as { location: string }[]).map((s) => s.location)));

  return (
    <Shell activeMenu="실재고 조사" title={`📋 실재고 조사 — ${session.location}`}>
      <StocktakeSessionPage
        session={session}
        staffNames={staffNames}
        completedTodayLocations={completedTodayLocations}
      />
    </Shell>
  );
}
