import Link from 'next/link';
import { confirmFormViewHref, type ConfirmFormView } from '@/lib/salesConfirms/types';

/**
 * '확인서/출고및반출준비' 화면 맨 위 보기 칩 2개.
 *   📋 영업 확인서(기본)  ·  🗂 예전 방식(시트 기재·간단 등록·정식 납품확인서)
 * 서버 컴포넌트로도 쓰이게 'use client' 없이 Link 만(계약관리 칩과 같은 방식).
 * Link 라 주소 ?뒤만 바뀌면 page 가 새로 안 만들어질 수 있어, 아래 본문은 page.tsx 의 <Suspense key={view}> 가 새로 그림.
 */
export default function ConfirmViewChips({ view }: { view: ConfirmFormView }) {
  return (
    <div className="app sc-viewbar">
      <nav className="chip-group" aria-label="확인서 보기">
        <Link
          href={confirmFormViewHref('sales')}
          aria-current={view === 'sales' ? 'page' : undefined}
          className={`chip${view === 'sales' ? ' active' : ''}`}
        >
          📋 영업 확인서
        </Link>
        <Link
          href={confirmFormViewHref('legacy')}
          aria-current={view === 'legacy' ? 'page' : undefined}
          className={`chip${view === 'legacy' ? ' active' : ''}`}
        >
          🗂 예전 방식 (시트 기재·간단 등록·정식 납품확인서)
        </Link>
      </nav>
    </div>
  );
}
