import SalesPage from '@/components/sales/SalesPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { listAllAssetsUnified } from '@/app/stocktake/actions';
import { rowToSale, type SaleRow } from '@/lib/sales';
import type { Asset } from '@/lib/types';
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

  // "재고에서 판매로 표시된 자산"은 IT재고 시트 5개 탭을 읽어야 해서 느립니다. 기다리지 않고
  // 판매 기록부터 보낸 뒤, 도착하면 그 칸만 채웁니다(useStreamedValue).
  const soldFromInventory = listAllAssetsUnified()
    .then((all) => all.filter((a) => a.status === '판매'))
    .catch(() => [] as Asset[]);

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
      <SalesPage entries={entries} soldFromInventory={soldFromInventory} />
    </Shell>
  );
}
