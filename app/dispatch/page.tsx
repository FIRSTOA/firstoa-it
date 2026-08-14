import DispatchPage from '@/components/dispatch/DispatchPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { rowToDispatch, type DispatchEntryRow } from '@/lib/dispatch';
import { createAdminClient, DISPATCH_TABLE, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="출고" title="📦 출고/접수 대장">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/dispatch_schema.sql" />
      </Shell>
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(DISPATCH_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .order('seq', { ascending: false });

  if (error) {
    return (
      <Shell activeMenu="출고" title="📦 출고/접수 대장">
        <SetupGuide error={error.message} schemaFile="supabase/dispatch_schema.sql" />
      </Shell>
    );
  }

  const entries = ((data ?? []) as DispatchEntryRow[]).map(rowToDispatch);

  return (
    <Shell activeMenu="출고" title="📦 출고/접수 대장" note="고객사 납품·교체·반출 접수 기록">
      <DispatchPage entries={entries} />
    </Shell>
  );
}
