import BillingPage from '@/components/billing/BillingPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { listBillingLines } from './actions';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="청구리스트" title="🧾 청구리스트">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/billing_schema.sql" />
      </Shell>
    );
  }

  const lines = await listBillingLines({ searchTerm: '', needsReviewOnly: false });

  return (
    <Shell activeMenu="청구리스트" title="🧾 청구리스트" note="장비별 청구 명세 — 자산 상세의 '임대·청구'와 같은 데이터예요">
      <BillingPage initialLines={lines} />
    </Shell>
  );
}
