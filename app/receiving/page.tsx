import { listAllAssetsUnified } from '@/app/stocktake/actions';
import ReceivingPage from '@/components/receiving/ReceivingPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { rowToReceiving, type ReceivingRow } from '@/lib/receiving';
import { createAdminClient, isSupabaseConfigured, RECEIVING_TABLE } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// 입고완료 처리(완료 팝업에서 호출하는 서버 액션)가 구글시트 API 콜드 캐시 상태에서 느릴 수
// 있어서, 이 페이지에서 호출되는 서버 액션들의 실행시간 제한을 기본값보다 넉넉하게 둡니다.
// (Server Action 파일 자체(`'use server'`)에는 maxDuration을 못 넣으므로 라우트인 여기서 설정)
export const maxDuration = 60;

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="입고" title="📥 입고 대장">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/receiving_schema.sql" />
      </Shell>
    );
  }

  const supabase = createAdminClient();
  const [{ data, error }, assets] = await Promise.all([
    supabase
      .from(RECEIVING_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .order('seq', { ascending: false }),
    listAllAssetsUnified().catch(() => []),
  ]);

  if (error) {
    return (
      <Shell activeMenu="입고" title="📥 입고 대장">
        <SetupGuide error={error.message} schemaFile="supabase/receiving_schema.sql" />
      </Shell>
    );
  }

  const entries = ((data ?? []) as ReceivingRow[]).map(rowToReceiving);
  const locations = Array.from(new Set(assets.map((a) => a.location.trim()).filter(Boolean))).sort();

  return (
    <Shell activeMenu="입고" title="📥 입고 대장" note="구매입고예정·렌탈입고예정 접수/완료 기록">
      <ReceivingPage entries={entries} locations={locations} />
    </Shell>
  );
}
