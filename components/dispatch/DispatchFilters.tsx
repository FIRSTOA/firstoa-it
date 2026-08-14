'use client';

import { DISPATCH_TYPES, type DispatchFilters as Filters } from '@/lib/dispatch';

type Props = {
  filters: Filters;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onTypeChange: (value: string | null) => void;
};

export default function DispatchFilters({ filters, searchTerm, onSearchChange, onTypeChange }: Props) {
  return (
    <div className="panel">
      <div className="search-row">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="상호 / 품목 / 자산번호 / 연락처 검색"
        />
      </div>
      <div className="filter-row" style={{ borderTop: 'none' }}>
        <div className="filter-label">구분</div>
        <div className="chip-group">
          <button
            type="button"
            className={`chip${!filters.type ? ' active' : ''}`}
            onClick={() => onTypeChange(null)}
          >
            전체
          </button>
          {DISPATCH_TYPES.map((type) => (
            <button
              type="button"
              key={type}
              className={`chip${filters.type === type ? ' active' : ''}`}
              onClick={() => onTypeChange(filters.type === type ? null : type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
