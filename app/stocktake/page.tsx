import { listStaffNames } from '@/app/actions';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import StocktakeListPage from '@/components/stocktake/StocktakeListPage';
import {
  buildStocktakeListRows,
  readAllStocktakePages,
  STOCKTAKE_LIST_COLUMNS,
  type StocktakeListSourceRow,
} from '@/lib/stocktake';
import { createAdminClient, isSupabaseConfigured, STOCKTAKE_TABLE } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="실재고 조사" title="📋 실재고 조사">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/stocktake_schema.sql" />
      </Shell>
    );
  }

  // 선반 위치 목록(IT재고 시트 5탭)은 여기서 읽지 않음 — 화면이 loadStocktakeLocations 로 한 번 읽음.
  // page 에서 읽으면 서버 액션(조사 시작·위치 수정·삭제)의 revalidatePath 로 다시 그릴 때마다 또 읽어
  // 구글 읽기 한도(분당 60회)를 써 버리고, 한도에 걸린 탭은 빈 목록이 됐음(components/stocktake/useStocktakeLocations.ts).
  // 조사 기록은 페이지로 끝까지(Supabase 1000줄 잘림), 순번 오름차순으로 읽어야 읽는 사이 새 줄이 생겨도 안 밀림.
  // 화면엔 목록 줄(확인 현황 + 미확인 자산)만 보냄 — 조사 결과 전체를 보내면 목록 화면이 1MB 넘게 커짐.
  const supabase = createAdminClient();
  const [{ rows, error }, staffNames] = await Promise.all([
    readAllStocktakePages<StocktakeListSourceRow>((from, to) =>
      supabase
        .from(STOCKTAKE_TABLE)
        .select(STOCKTAKE_LIST_COLUMNS)
        .order('seq', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
        .returns<StocktakeListSourceRow[]>(),
    ),
    listStaffNames(),
  ]);

  if (error) {
    return (
      <Shell activeMenu="실재고 조사" title="📋 실재고 조사">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/stocktake_schema.sql" error={error.message} />
      </Shell>
    );
  }

  const sessions = buildStocktakeListRows(rows);

  return (
    <Shell activeMenu="실재고 조사" title="📋 실재고 조사" note="위치별로 돌아보며 전산 재고와 실물을 맞춰보는 조사예요.">
      <StocktakeListPage sessions={sessions} staffNames={staffNames} />
    </Shell>
  );
}
