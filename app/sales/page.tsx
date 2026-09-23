import SalesPage from '@/components/sales/SalesPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { rowToSale, type SaleRow } from '@/lib/sales';
import { createAdminClient, isSupabaseConfigured, SALES_TABLE } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="판매리스트" title="💰 판매 리스트">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/sales_schema.sql" />
      </Shell>
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(SALES_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .order('seq', { ascending: false });

  if (error) {
    return (
      <Shell activeMenu="판매리스트" title="💰 판매 리스트">
        <SetupGuide error={error.message} schemaFile="supabase/sales_schema.sql" />
      </Shell>
    );
  }

  const entries = ((data ?? []) as SaleRow[]).map(rowToSale);

  return (
    <Shell activeMenu="판매리스트" title="💰 판매 리스트" note="IT재고와 별도로 관리하는 판매 기록">
      <SalesPage entries={entries} />
    </Shell>
  );
}
