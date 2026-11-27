'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import InstallAppButton from '@/components/InstallAppButton';
import MobileTableCards from '@/components/MobileTableCards';

const SIDEBAR_SECTIONS = [
  {
    label: '재고관리',
    items: [
      { label: 'IT 재고 리스트', href: '/' },
      { label: '입고', href: '/receiving' },
      { label: '출고', href: '/dispatch' },
      // 일하는 순서: 확인서(기기 적기·출력) → 출고 준비 리스트(준비·완료 보고) — 2026-11-27 사용자 요청
      { label: '확인서/출고및반출준비', href: '/confirm-form' },
      { label: '출고 준비 리스트', href: '/shipment-prep' },
      { label: '판매리스트', href: '/sales' },
      { label: '자산 이력', href: '/asset-history' },
      { label: '실재고 조사', href: '/stocktake' },
      { label: '재고 현황판', href: '/inventory-status' },
      { label: '소모품 가격표', href: '/consumables' },
    ],
  },
  {
    label: '임대·청구',
    items: [
      { label: '임대리스트', href: '/rentals' },
      { label: '청구리스트', href: '/billing' },
    ],
  },
  {
    label: '계약관리',
    items: [
      { label: '소프트웨어 계약', href: '/contracts?tab=sw' },
      { label: 'PC 유지보수', href: '/contracts?tab=pcm' },
    ],
  },
] as const;

type SidebarItem = (typeof SIDEBAR_SECTIONS)[number]['items'][number];

/** 위 메뉴 — 재고관리·임대·청구·계약관리는 왼쪽 메뉴 묶음과 같은 이름(그 묶음의 첫 화면으로 감) */
const TOP_TABS = [
  { label: '홈', href: '/home' },
  { label: '통합 캘린더', href: '/calendar' },
  { label: '재고관리', href: '/' },
  { label: '임대·청구', href: '/rentals' },
  { label: '계약관리', href: '/contracts?tab=sw' },
  { label: '사용설명서', href: '/manual' },
] as const;

type TopTabLabel = (typeof TOP_TABS)[number]['label'];

/** 주소로 위 메뉴 고르기 — 목록에 없는 화면은 전부 재고관리 */
function tabForPath(pathname: string | null): TopTabLabel {
  const p = pathname ?? '/';
  if (p.startsWith('/home')) return '홈';
  if (p.startsWith('/calendar')) return '통합 캘린더';
  if (p.startsWith('/rentals') || p.startsWith('/billing')) return '임대·청구';
  if (p.startsWith('/contracts')) return '계약관리';
  if (p.startsWith('/manual')) return '사용설명서';
  return '재고관리';
}

type Props = {
  children: ReactNode;
  activeMenu: SidebarItem['label'] | '통합 캘린더' | '홈' | '사용설명서';
  title: string;
  note?: string;
};

/** ERP 공통 껍데기 — 왼쪽 사이드바 + 상단 네비 + 브레드크럼. 여러 페이지가 공유합니다. */
export default function Shell({ children, activeMenu, title, note }: Props) {
  const pathname = usePathname();
  const activeTab = tabForPath(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 메뉴를 누른 뒤 다음 화면이 뜰 때까지(서버에서 화면을 만드느라 몇 초 걸림) 진행 막대 + 누른 메뉴 빙글 표시.
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // 새 화면이 그려지면 끔. 같은 화면에서 주소 뒤쪽만 바뀌는 이동(계약관리 ?tab=sw ↔ ?tab=pcm)은 Next가 Shell 을
  // 새로 만들지 않고 pathname 도 그대로라, 그릴 때마다 실제 주소(경로+?뒤)를 지난번과 비교해 바뀌었으면 끔.
  // (Next 가 주소창을 그리기 직후 useInsertionEffect 로 바꾸므로 여기 useEffect 에선 이미 새 주소)
  const lastUrlRef = useRef('');
  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}`;
    if (url === lastUrlRef.current) return;
    lastUrlRef.current = url;
    setPendingHref(null);
  });

  // 핸드폰에선 위 메뉴 6개가 옆으로 넘침 → 지금 메뉴가 보이게 그 자리로 밀어 둠
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.topnav-tab.active');
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeTab]);

  function startNav(e: MouseEvent<HTMLAnchorElement>, href: string) {
    // 새 탭으로 여는 클릭(Ctrl/⌘/Shift)이나 지금 보고 있는 화면이면 표시하지 않음
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (href === `${window.location.pathname}${window.location.search}`) return;
    setPendingHref(href);
  }

  return (
    <div className={`shell${pendingHref ? ' navigating' : ''}`}>
      <MobileTableCards />
      {pendingHref && <div className="nav-progress" aria-hidden />}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-collapse" title="닫기" onClick={() => setSidebarOpen(false)}>
          ⟨⟨
        </div>
        <div className="profile-card">
          <div className="profile-avatar">🐰</div>
          <div className="profile-name">손영근</div>
          <div className="profile-role">IT · 파트장</div>
        </div>
        <div className="sidebar-fav">⭐ 즐겨찾기</div>
        <div className="sidebar-fav-hint">
          메뉴 옆 ☆ 아이콘으로
          <br />
          자주 쓰는 메뉴를 추가하세요
        </div>
        {SIDEBAR_SECTIONS.map((section) => (
          <div key={section.label} className={section.label === activeTab ? 'sidebar-section current' : 'sidebar-section'}>
            <div className="sidebar-section-label">{section.label}</div>
            <ul className="sidebar-menu">
              {section.items.map(({ label, href }) => {
                const pending = pendingHref === href;
                return (
                  <li
                    key={label}
                    className={[label === activeMenu && 'active', pending && 'pending'].filter(Boolean).join(' ') || undefined}
                  >
                    <Link
                      href={href}
                      onClick={(e) => startNav(e, href)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'inherit', textDecoration: 'none', width: '100%' }}
                    >
                      {pending ? <span className="nav-spinner" aria-label="불러오는 중" /> : <span className="dot" />}
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <InstallAppButton />
      </aside>

      <div className="shell-main">
        <header className="topnav">
          <div className="topnav-left">
            <button
              type="button"
              className="hamburger-btn"
              aria-label="메뉴 열기"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <div className="company-block">
              <div className="company-mark">🐰</div>
              <div className="company-text">
                <div className="name">(주)퍼스트전산</div>
                <div className="sub">FIRSTOA ERP</div>
              </div>
            </div>
            <nav className="topnav-tabs">
              {TOP_TABS.map(({ label, href }) => (
                <Link
                  key={label}
                  href={href}
                  onClick={(e) => startNav(e, href)}
                  className={`topnav-tab${label === activeTab ? ' active' : ''}`}
                  style={{ textDecoration: 'none' }}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="topnav-right">
            <a
              className="hr-pill"
              href="https://firstoa-hr.fly.dev/login"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              👥 <span>인사관리시스템 ↗</span>
            </a>
            <div className="logout-btn" title="로그아웃">
              ⏻
            </div>
          </div>
        </header>

        <div className="breadcrumb-bar">
          <h1>{title}</h1>
          <div className="team-pills">
            <div className="team-pill active">IT팀</div>
          </div>
          {note && <div className="breadcrumb-note">{note}</div>}
        </div>

        <div className="content-scroll">{children}</div>
      </div>
    </div>
  );
}
