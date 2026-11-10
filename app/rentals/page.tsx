import RentalListPage from '@/components/rentals/RentalListPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { WORKS_ASSETS_URL } from '@/lib/rentals/worksSync';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// "firstoa-works 대조/반영"이 임대리스트(2만여 건)+청구 명세(15만여 건)를 한 번에 처리해서
// 시간이 걸릴 수 있음 — Vercel 요금제가 허용하는 한도까지 늘려둡니다(상한 초과 값은 자동으로
// 그 상한으로 조정됨).
export const maxDuration = 300;

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
      note="firstoa-works(ajpcadmhfumcdwjseqez)의 로컬 사본 — firstoa-works 대조로 동기화해요"
    >
      <RentalListPage sheetUrl={WORKS_ASSETS_URL} />
    </Shell>
  );
}
