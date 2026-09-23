'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';

const SIDEBAR_SECTIONS = [
  {
    label: '재고관리',
    items: [
      { label: '현황표', href: null },
      { label: 'IT 재고 리스트', href: '/' },
      { label: '입고', href: '/receiving' },
      { label: '출고', href: '/dispatch' },
      { label: '판매리스트', href: '/sales' },
      { label: '재고입력', href: null },
      { label: '자산 이력', href: '/asset-history' },
      { label: '소모품 가격표', href: '/consumables' },
    ],
  },
  {
    label: '임대·청구',
    items: [
      { label: '임대리스트', href: '/rentals' },
      { label: '청구리스트', href: null },
    ],
  },
] as const;

type SidebarItem = (typeof SIDEBAR_SECTIONS)[number]['items'][number];

const TOP_TABS: { label: string; href: string | null }[] = [
  { label: '통합 캘린더', href: '/calendar' },
  { label: '영업관리', href: null },
  { label: '출고·현황', href: null },
  { label: '고객서비스', href: null },
  { label: '임대·청구', href: null },
  { label: '재고관리', href: null },
  { label: '관리', href: null },
];

type Props = {
  children: ReactNode;
  activeMenu: SidebarItem['label'] | '통합 캘린더';
  title: string;
  note?: string;
};

/** ERP 공통 껍데기 — 왼쪽 사이드바 + 상단 네비 + 브레드크럼. 여러 페이지가 공유합니다. */
export default function Shell({ children, activeMenu, title, note }: Props) {
  const pathname = usePathname();
  const activeTab = pathname?.startsWith('/calendar') ? '통합 캘린더' : '재고관리';
  const [toast, setToast] = useState({ msg: '', show: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showComingSoon(label: string) {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg: `${label} 화면은 준비 중이에요.`, show: true });
    timer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 1800);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-collapse" title="접기">
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
          <div key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            <ul className="sidebar-menu">
              {section.items.map(({ label, href }) => (
                <li
                  key={label}
                  className={label === activeMenu ? 'active' : undefined}
                  onClick={href ? undefined : () => showComingSoon(label)}
                >
                  {href ? (
                    <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'inherit', textDecoration: 'none', width: '100%' }}>
                      <span className="dot" />
                      {label}
                    </Link>
                  ) : (
                    <>
                      <span className="dot" />
                      {label}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <div className="shell-main">
        <header className="topnav">
          <div className="topnav-left">
            <div className="company-block">
              <div className="company-mark">🐰</div>
              <div className="company-text">
                <div className="name">(주)퍼스트전산</div>
                <div className="sub">FIRSTOA ERP</div>
              </div>
            </div>
            <nav className="topnav-tabs">
              {TOP_TABS.map(({ label, href }) =>
                href ? (
                  <Link
                    key={label}
                    href={href}
                    className={`topnav-tab${label === activeTab ? ' active' : ''}`}
                    style={{ textDecoration: 'none' }}
                  >
                    {label}
                  </Link>
                ) : (
                  <div key={label} className={`topnav-tab${label === activeTab ? ' active' : ''}`}>
                    {label}
                  </div>
                ),
              )}
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
              👥 인사관리시스템 ↗
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
            <div className="team-pill">운영지원팀</div>
          </div>
          {note && <div className="breadcrumb-note">{note}</div>}
        </div>

        <div className="content-scroll">{children}</div>
      </div>

      <div className={`toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>
    </div>
  );
}
