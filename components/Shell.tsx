import type { ReactNode } from 'react';

const SIDEBAR_MENU = ['현황표', 'IT 재고 리스트', '재고입력', '자산 이력', '소모품 가격표'];
const TOP_TABS = ['통합 캘린더', '영업관리', '출고·현황', '고객서비스', '임대·청구', '재고관리', '관리'];

const ACTIVE_MENU = 'IT 재고 리스트';
const ACTIVE_TAB = '재고관리';

/** ERP 공통 껍데기 — 왼쪽 사이드바 + 상단 네비 + 브레드크럼. */
export default function Shell({ children }: { children: ReactNode }) {
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
        <div className="sidebar-section-label">재고관리</div>
        <ul className="sidebar-menu">
          {SIDEBAR_MENU.map((label) => (
            <li key={label} className={label === ACTIVE_MENU ? 'active' : undefined}>
              <span className="dot" />
              {label}
            </li>
          ))}
        </ul>
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
              {TOP_TABS.map((label) => (
                <div key={label} className={`topnav-tab${label === ACTIVE_TAB ? ' active' : ''}`}>
                  {label}
                </div>
              ))}
            </nav>
          </div>
          <div className="topnav-right">
            <div className="hr-pill">👥 인사관리시스템 ↗</div>
            <div className="logout-btn" title="로그아웃">
              ⏻
            </div>
          </div>
        </header>

        <div className="breadcrumb-bar">
          <h1>🖥️ IT 재고 리스트</h1>
          <div className="team-pills">
            <div className="team-pill active">IT팀</div>
            <div className="team-pill">운영지원팀</div>
          </div>
          <div className="breadcrumb-note">영업 → 재고관리로 전달된 건만. 본인 팀 큐.</div>
        </div>

        <div className="content-scroll">{children}</div>
      </div>
    </div>
  );
}
