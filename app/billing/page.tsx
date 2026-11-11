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
    <Shell
      activeMenu="청구리스트"
      title="🧾 청구리스트"
      note="firstoa-works 청구 데이터 — 임대리스트 화면의 'firstoa-works 대조'로 최신화돼요"
    >
      <BillingPage initialLines={lines} />
    </Shell>
  );
}
