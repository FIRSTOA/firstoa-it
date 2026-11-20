import { Suspense } from 'react';
import ContractsPage from '@/components/contracts/ContractsPage';
import PageLoading from '@/components/PageLoading';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import type { ContractTab } from '@/lib/contracts/types';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { getContractsOverview } from './actions';
import { getUnlockState } from './secretActions';

// 거래처 목록은 화면을 열 때마다 firstoa-works 에서 새로 읽음(보관 안 함)
export const dynamic = 'force-dynamic';

/** 틀(탭·제목)은 먼저, works 를 읽는 목록은 도착하면 채움 */
async function ContractsBody({ tab }: { tab: ContractTab }) {
  // D13: 소프트웨어 탭은 비밀번호가 풀려 있어야 목록을 읽음 — 잠겨 있으면 works 도 안 읽고 overview null(비밀번호 화면)
  const unlock = await getUnlockState();
  const overview = tab === 'sw' && !unlock.unlocked ? null : await getContractsOverview(tab);
  return (
    <ContractsPage
      initialTab={tab}
      overview={overview?.ok ? overview.overview : null}
      overviewError={overview && !overview.ok ? overview.error : null}
      unlock={unlock}
    />
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: ContractTab = sp.tab === 'pcm' ? 'pcm' : 'sw';
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="계약 관리" title="📑 계약 관리">
        <SetupGuide schemaFile="supabase/contracts_schema.sql" />
      </Shell>
    );
  }
  return (
    <Shell activeMenu="계약 관리" title="📑 계약 관리" note="소프트웨어 계약·PC 유지보수 — 거래처 목록은 firstoa-works에서 바로 읽어요">
      <Suspense key={tab} fallback={<PageLoading />}>
        <ContractsBody tab={tab} />
      </Suspense>
    </Shell>
  );
}
