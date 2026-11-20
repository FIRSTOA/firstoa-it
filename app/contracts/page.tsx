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
  const [overview, unlock] = await Promise.all([getContractsOverview(tab), getUnlockState()]);
  return (
    <ContractsPage
      initialTab={tab}
      overview={overview.ok ? overview.overview : null}
      overviewError={overview.ok ? null : overview.error}
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
