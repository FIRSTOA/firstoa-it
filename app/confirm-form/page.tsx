import { listRecentConfirmFormEntries } from '@/app/confirmForm/actions';
import ConfirmFormPage from '@/components/confirmForm/ConfirmFormPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// 확인서리스트 시트 읽기·쓰기 + 출고 준비 연결이 같이 돌아서 넉넉하게.
export const maxDuration = 60;

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="확인서/출고및반출준비" title="📋 확인서/출고및반출준비">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/dispatch_schema.sql, supabase/receiving_schema.sql, supabase/delivery_confirm_form_schema.sql" />
      </Shell>
    );
  }

  const entries = await listRecentConfirmFormEntries();

  return (
    <Shell
      activeMenu="확인서/출고및반출준비"
      title="📋 확인서/출고및반출준비"
      note="영업이 준 확인서에 우리가 준비한 장비의 자산번호·S/N·[납품사양]을 적어요(확인서리스트 시트에 바로 기재). 간단 등록은 사진/텍스트로 출고 대장에 등록해요."
    >
      <ConfirmFormPage initialEntries={entries} />
    </Shell>
  );
}
