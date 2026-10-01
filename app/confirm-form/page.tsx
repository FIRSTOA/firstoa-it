import { listRecentConfirmFormEntries } from '@/app/confirmForm/actions';
import ConfirmFormPage from '@/components/confirmForm/ConfirmFormPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="반출 확인서" title="📋 반출 확인서">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/dispatch_schema.sql, supabase/receiving_schema.sql" />
      </Shell>
    );
  }

  const entries = await listRecentConfirmFormEntries();

  return (
    <Shell
      activeMenu="반출 확인서"
      title="📋 반출 확인서"
      note="확인서 사진/텍스트를 붙여넣으면 자동으로 읽어서 등록해요. 철수는 렌탈입고예정에도 같이 등록돼요."
    >
      <ConfirmFormPage initialEntries={entries} />
    </Shell>
  );
}
