'use client';

import { DISPATCH_STATUSES, type DispatchEntry } from '@/lib/dispatch';

type Props = {
  entries: DispatchEntry[];
  statusFilter: string | null;
  onSelectStatus: (value: string | null) => void;
};

export default function DispatchStats({ entries, statusFilter, onSelectStatus }: Props) {
  const cards = [
    { key: 'all', label: '전체', num: entries.length, value: null as string | null },
    ...DISPATCH_STATUSES.map((status) => ({
      key: status,
      label: status,
      num: entries.filter((e) => e.status === status).length,
      value: status,
    })),
  ];

  return (
    <div className="stats" style={{ gridTemplateColumns: `repeat(${cards.length},minmax(0,1fr))` }}>
      {cards.map((card) => (
        <button
          type="button"
          key={card.key}
          className={`stat-card${statusFilter === card.value ? ' active' : ''}`}
          onClick={() => onSelectStatus(statusFilter === card.value ? null : card.value)}
        >
          <div className="stat-num">{card.num}</div>
          <div className="stat-label">{card.label}</div>
        </button>
      ))}
    </div>
  );
}
