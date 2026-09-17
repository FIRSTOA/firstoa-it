import RentalListPage from '@/components/rentals/RentalListPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { RENTAL_SHEET_URL } from '@/lib/rentals/sync';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// "시트 대조/반영"이 22,800여 행을 한 번에 처리해서 시간이 걸릴 수 있음 — Vercel 요금제가
// 허용하는 한도까지 늘려둡니다(요금제 상한을 넘는 값은 자동으로 그 상한으로 조정됨).
export const maxDuration = 60;

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="임대리스트" title="📋 임대리스트">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/rentals_schema.sql" />
      </Shell>
    );
  }

  return (
    <Shell
      activeMenu="임대리스트"
      title="📋 임대리스트"
      note="구글시트 임대리스트의 로컬 사본 — 시트 대조로 동기화해요"
    >
      <RentalListPage sheetUrl={RENTAL_SHEET_URL} />
    </Shell>
  );
}
