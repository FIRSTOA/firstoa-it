import BillingPage from '@/components/billing/BillingPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { listBillingLines } from './actions';
import { buildAllocationReview, summarizeReview } from '@/lib/billingAllocation';
import type { AllocationReview, BillingView, ReviewSummary } from '@/lib/billingAllocationTypes';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="청구리스트" title="🧾 청구리스트">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/billing_schema.sql" />
      </Shell>
    );
  }

  const { view: rawView } = await searchParams;
  const viewParam = Array.isArray(rawView) ? rawView[0] : rawView;
  const initialView: BillingView = viewParam === 'review' || viewParam === 'assigned' ? viewParam : 'lines';

  // 요약 숫자는 보기와 상관없이 항상(읽기 실패해도 화면은 뜸). 자세한 목록은 확인·지정 보기일 때만.
  const [lines, summary, review] = await Promise.all([
    listBillingLines({ searchTerm: '', needsReviewOnly: false }),
    summarizeReview().catch((err): ReviewSummary | null => {
      console.error('[billing] 요약 실패:', err);
      return null;
    }),
    initialView === 'lines'
      ? Promise.resolve<AllocationReview | null>(null)
      : buildAllocationReview().catch((err): AllocationReview | null => {
          console.error('[billing] 확인 목록 실패:', err);
          return null; // 화면이 getAllocationReview() 로 다시 불러오며 오류를 보여 줌
        }),
  ]);

  return (
    <Shell
      activeMenu="청구리스트"
      title="🧾 청구리스트"
      note="firstoa-works 청구 데이터 — 임대리스트 화면의 'firstoa-works 대조'로 최신화돼요"
    >
      <BillingPage initialLines={lines} summary={summary} initialView={initialView} review={review} />
    </Shell>
  );
}
