import Link from 'next/link';
import { after } from 'next/server';
import { Suspense } from 'react';
import Shell from '@/components/Shell';
import AgentTeamCard from '@/components/home/AgentTeamCard';
import FeedbackBoard from '@/components/home/FeedbackBoard';
import { buildTeamWork } from '@/lib/agentWork';
import {
  ConfirmCardAsync,
  ContractsCardAsync,
  InventoryCardAsync,
  ReleaseNotes,
  SystemStatusAsync,
  SystemStatusLoading,
  UpcomingShipments,
  WorkCardLoading,
  WorkCardView,
} from '@/components/home/HomeSections';
import { listFeedback } from './feedbackActions';
import {
  kstToday,
  loadBillingCard,
  loadPrepOverview,
  loadReceivingCard,
  loadSalesConfirmCard,
  loadSalesImportState,
  loadStocktakeCard,
  todayHeading,
} from '@/lib/homeDashboard';
import { runSalesConfirmImport } from '@/lib/salesConfirms/importer';

// 매번 최신 — 숫자는 각 메뉴 원본에서 바로 읽음(보관 안 함)
export const dynamic = 'force-dynamic';

/**
 * 홈 대시보드 — 오늘 할 일과 각 메뉴 상태를 한눈에(참고: 점검AS inspection-finder 홈 구성).
 * Supabase 카드(출고 준비·입고·실재고·청구)는 동시에 읽어 바로, 구글시트 카드(확인서·IT 재고)와
 * 운영·시스템(응답 시간 측정)은 Suspense 로 틀 먼저 띄우고 도착하면 채움.
 */
export default async function HomePage() {
  const today = kstToday();
  const head = todayHeading(today);
  const [prep, receiving, stocktake, billing, salesConfirm, importState, feedback] = await Promise.all([
    loadPrepOverview(today),
    loadReceivingCard(today),
    loadStocktakeCard(today),
    loadBillingCard(today),
    loadSalesConfirmCard(today),
    loadSalesImportState(),
    listFeedback(),
  ]);

  // 영업 확인서 가져오기: 마지막 성공이 10분 넘었으면 응답 뒤에 한 번(키·상태 표가 없으면 안 함). 실패는 이유만 서버 로그에.
  const lastOk = importState?.lastSuccessAt ? new Date(importState.lastSuccessAt).getTime() : 0;
  if (process.env.SALES_EXPORT_KEY && importState && Date.now() - lastOk > 10 * 60_000) {
    after(async () => {
      try {
        const r = await runSalesConfirmImport({ trigger: 'home' });
        if (!r.ok) console.warn('[sales-confirms] 홈 가져오기 실패', r.errorCode ?? 'unknown');
      } catch (err) {
        console.warn('[sales-confirms] 홈 가져오기 오류', err instanceof Error ? err.name : 'unknown');
      }
    });
  }
  const fast = [prep.card, salesConfirm, receiving, stocktake, billing];
  const todo = fast.filter((c) => c.alert && (c.tone === 'bad' || c.tone === 'warn'));
  const failed = fast.filter((c) => c.error).length;

  return (
    <Shell activeMenu="홈" title="🏠 홈" note="오늘 할 일과 메뉴별 상태를 한눈에">
      <div className="home">
        <header className="home-hero">
          <div>
            <div className="home-date">{head.title}</div>
            <div className="home-date-sub">{head.sub}</div>
          </div>
          <div className="home-todo">
            {failed > 0 && <span className="home-chip state-waiting">일부 숫자를 못 읽었어요({failed}곳)</span>}
            {todo.length === 0 ? (
              failed === 0 && <span className="home-chip state-done">✓ 지금 급한 일 없음</span>
            ) : (
              todo.map((c) => (
                <Link key={c.key} href={c.href} className={`home-chip state-${c.tone === 'bad' ? 'bad' : 'waiting'}`}>
                  {c.icon} {c.alert}
                </Link>
              ))
            )}
          </div>
        </header>

        <div className="home-cards">
          <WorkCardView card={prep.card} />
          <WorkCardView card={salesConfirm} />
          <Suspense fallback={<WorkCardLoading title="확인서 출고 기재" icon="📄" />}>
            <ConfirmCardAsync today={today} />
          </Suspense>
          <WorkCardView card={receiving} />
          <Suspense fallback={<WorkCardLoading title="IT 재고" icon="🖥️" />}>
            <InventoryCardAsync />
          </Suspense>
          <WorkCardView card={stocktake} />
          <WorkCardView card={billing} />
          <Suspense fallback={<WorkCardLoading title="계약" icon="📑" />}>
            <ContractsCardAsync />
          </Suspense>
        </div>

        <div className="home-grid2">
          <UpcomingShipments prep={prep} />
          <Suspense fallback={<SystemStatusLoading />}>
            <SystemStatusAsync />
          </Suspense>
        </div>

        <AgentTeamCard work={buildTeamWork(today)} />
        <ReleaseNotes />
        <FeedbackBoard initial={feedback} />
      </div>
    </Shell>
  );
}
