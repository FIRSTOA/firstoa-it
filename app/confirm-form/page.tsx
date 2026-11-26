import { Suspense } from 'react';
import { listRecentConfirmFormEntries } from '@/app/confirmForm/actions';
import ConfirmFormPage from '@/components/confirmForm/ConfirmFormPage';
import PageLoading from '@/components/PageLoading';
import ConfirmViewChips from '@/components/salesConfirms/ConfirmViewChips';
import SalesConfirmListPage from '@/components/salesConfirms/SalesConfirmListPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { loadSalesConfirmList } from '@/lib/salesConfirms/listQuery';
import type { ConfirmFormView } from '@/lib/salesConfirms/types';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// 예전 보기: 확인서리스트 시트 읽기·쓰기 + 출고 준비 연결이 같이 돌아서 넉넉하게.
export const maxDuration = 60;

const MENU = '확인서/출고및반출준비';
const TITLE = '📋 확인서/출고및반출준비';

/**
 * 같은 메뉴 아래 두 보기(D10 — 주소 /confirm-form 그대로):
 *   기본(sales)  = 영업 웹앱에서 가져온 확인서 목록(설계 docs/tasks/2026-11-26-sales-confirm-import.md)
 *   ?view=legacy = 예전 화면 그대로(시트 기재·간단 등록·정식 납품확인서 — 전환하는 동안 유지)
 * 칩은 Link 라 ?뒤만 바뀜 → Next 가 page 를 새로 안 만들 수 있어 <Suspense key={view}> 로 아래를 새로 그림(view 는 state 아님).
 */
const VIEW_NOTE: Record<ConfirmFormView, string> = {
  sales: '영업 웹앱에서 저장한 IT 확인서를 몇 분마다 가져와요. 영업 값은 읽기만 하고, IT가 적은 값은 이 앱에만 남아요.',
  legacy:
    '예전 방식 — 영업이 준 확인서에 우리가 준비한 장비의 자산번호·S/N·[납품사양]을 적어요(확인서리스트 시트에 바로 기재). 간단 등록은 사진/텍스트로 출고 대장에 등록해요.',
};

async function LegacyBody() {
  const entries = await listRecentConfirmFormEntries();
  return <ConfirmFormPage initialEntries={entries} />;
}

async function SalesBody() {
  const result = await loadSalesConfirmList();
  if (!result.ok && result.missingTable) {
    return <SetupGuide schemaFile="supabase/sales_confirms_schema.sql" />;
  }
  return <SalesConfirmListPage initial={result} />;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const view: ConfirmFormView = sp.view === 'legacy' ? 'legacy' : 'sales';

  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu={MENU} title={TITLE}>
        <SetupGuide
          schemaFile={
            view === 'legacy'
              ? 'supabase/schema.sql, supabase/dispatch_schema.sql, supabase/receiving_schema.sql, supabase/delivery_confirm_form_schema.sql'
              : 'supabase/sales_confirms_schema.sql'
          }
        />
      </Shell>
    );
  }

  return (
    <Shell activeMenu={MENU} title={TITLE} note={VIEW_NOTE[view]}>
      <ConfirmViewChips view={view} />
      <Suspense key={view} fallback={<PageLoading />}>
        {view === 'legacy' ? <LegacyBody /> : <SalesBody />}
      </Suspense>
    </Shell>
  );
}
