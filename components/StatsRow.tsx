'use client';

import { useMemo } from 'react';
import { countExcluding, filterAssets, INTERNAL_STOCK_STATUSES, isInternalStockActive, type Filters } from '@/lib/filters';
import { STATUSES, type Asset } from '@/lib/types';

/** 소모품가격표는 별도 화면에서 관리하는 정적 수치입니다. */
const CONSUMABLE_COUNT = 18;

type Props = {
  items: Asset[];
  filters: Filters;
  searchTerm: string;
  onToggleStatus: (status: string) => void;
  onClearStatus: () => void;
  onToggleInternalStock: () => void;
  onToggleMalicious: () => void;
  onSelectConsumable: () => void;
};

export default function StatsRow({
  items,
  filters,
  searchTerm,
  onToggleStatus,
  onClearStatus,
  onToggleInternalStock,
  onToggleMalicious,
  onSelectConsumable,
}: Props) {
  // 8번의 전체 배열 스캔(전체/내부재고/악성/상태 6개)이라 items/filters/searchTerm이 실제로
  // 안 바뀌었으면 다시 안 돌게 메모이즈합니다 — 안 그러면 30초마다 도는 시계 갱신 같은 무관한
  // 재렌더에도 매번 다시 계산됩니다.
  const counts = useMemo(() => {
    // "전체"/"내부재고" 카드는 같은 relaxed 필터(상태만 뺀 것)를 공유하므로 한 번만 계산합니다.
    const withoutStatus = filterAssets(items, { ...filters, status: [] }, searchTerm);
    const allCount = withoutStatus.length;
    const internalStockCount = withoutStatus.filter((it) => INTERNAL_STOCK_STATUSES.includes(it.status)).length;
    const maliciousCount = filterAssets(items, { ...filters, malicious: false }, searchTerm).filter(
      (it) => it.malicious,
    ).length;
    const byStatus = Object.fromEntries(
      STATUSES.map((status) => [status, countExcluding(items, filters, searchTerm, 'status', status)]),
    );
    return { allCount, internalStockCount, maliciousCount, byStatus };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filters, searchTerm]);

  const statusCards = STATUSES.map((status) => ({
    key: status,
    label: status,
    num: counts.byStatus[status],
    active: filters.status.includes(status),
    onClick: () => onToggleStatus(status),
  }));

  const cards = [
    {
      key: 'all',
      label: '전체',
      num: counts.allCount,
      active: filters.status.length === 0,
      onClick: onClearStatus,
    },
    {
      key: 'internal-stock',
      label: '내부재고',
      num: counts.internalStockCount,
      active: isInternalStockActive(filters.status),
      onClick: onToggleInternalStock,
    },
    ...statusCards,
    {
      key: 'malicious',
      label: '악성',
      num: counts.maliciousCount,
      active: filters.malicious,
      onClick: onToggleMalicious,
    },
    { key: 'consumable', label: '소모품가격표', num: CONSUMABLE_COUNT, active: false, onClick: onSelectConsumable },
  ];

  return (
    <div className="stats">
      {cards.map((card) => (
        <button
          type="button"
          key={card.key}
          className={`stat-card${card.active ? ' active' : ''}`}
          data-key={card.key}
          aria-pressed={card.key === 'consumable' ? undefined : card.active}
          onClick={card.onClick}
        >
          <div className="stat-num">{card.num}</div>
          <div className="stat-label">{card.label}</div>
        </button>
      ))}
    </div>
  );
}
