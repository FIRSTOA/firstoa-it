'use client';

import type { StocktakeLocationsState } from './useStocktakeLocations';

/**
 * 위치 목록을 읽는 중이거나 못 읽었을 때 한 줄 — 예전엔 못 읽으면 "오늘 남은 선반 위치"가 아무 말 없이 사라졌음.
 * 목록 화면(StocktakeListPage)과 조사 화면의 [조사 종료] 뒤 안내(StocktakeSessionPage)가 같이 씀.
 */
export function LocationsNotice({
  state,
  compact = false,
}: {
  state: Pick<StocktakeLocationsState, 'loading' | 'notice' | 'reload'>;
  compact?: boolean;
}) {
  if (!state.loading && !state.notice) return null;
  if (!state.notice) {
    return (
      <div style={{ fontSize: compact ? '11px' : '12.5px', color: 'var(--ink-400)', margin: compact ? '4px 0 0' : '0 0 12px' }}>
        선반 위치 목록을 IT재고 시트에서 읽는 중…
      </div>
    );
  }
  return (
    <div
      className="setup-alert"
      style={{
        margin: compact ? '6px 0 0' : '0 0 12px',
        fontSize: compact ? '12px' : '13px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: '1 1 220px' }}>⚠️ {state.notice}</span>
      <button type="button" className="chip" disabled={state.loading} onClick={state.reload}>
        {state.loading ? '읽는 중…' : '🔄 다시 읽기'}
      </button>
    </div>
  );
}
