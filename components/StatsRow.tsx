'use client';

import { countExcluding, filterAssets, type Filters } from '@/lib/filters';
import { STATUSES, type Asset } from '@/lib/types';

/** 소모품가격표는 별도 화면에서 관리하는 정적 수치입니다. */
const CONSUMABLE_COUNT = 18;

type Props = {
  items: Asset[];
  filters: Filters;
  searchTerm: string;
  onToggleStatus: (status: string) => void;
  onClearStatus: () => void;
  onToggleMalicious: () => void;
  onSelectConsumable: () => void;
};

export default function StatsRow({
  items,
  filters,
  searchTerm,
  onToggleStatus,
  onClearStatus,
  onToggleMalicious,
  onSelectConsumable,
}: Props) {
  // "전체" 카드/악성 카드는 자기 자신 조건을 뺀 나머지 필터+검색어만 적용했을 때의 건수입니다.
  const allCount = filterAssets(items, { ...filters, status: [] }, searchTerm).length;
  const maliciousCount = filterAssets(items, { ...filters, malicious: false }, searchTerm).filter(
    (it) => it.malicious,
  ).length;

  const statusCards = STATUSES.map((status) => ({
    key: status,
    label: status,
    num: countExcluding(items, filters, searchTerm, 'status', status),
    active: filters.status.includes(status),
    onClick: () => onToggleStatus(status),
  }));

  const cards = [
    { key: 'all', label: '전체', num: allCount, active: filters.status.length === 0, onClick: onClearStatus },
    ...statusCards,
    { key: 'malicious', label: '악성', num: maliciousCount, active: filters.malicious, onClick: onToggleMalicious },
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
