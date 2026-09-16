'use client';

import { RECEIVING_KINDS, type ReceivingFilters as Filters } from '@/lib/receiving';
import { CATEGORIES } from '@/lib/types';

type Props = {
  filters: Filters;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onKindChange: (value: string | null) => void;
  onCategoryChange: (value: string | null) => void;
};

export default function ReceivingFilters({
  filters,
  searchTerm,
  onSearchChange,
  onKindChange,
  onCategoryChange,
}: Props) {
  return (
    <div className="panel">
      <div className="search-row">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="자산번호 / 모델명 / 브랜드 / 발주처 검색"
        />
      </div>
      <div className="filter-row" style={{ borderTop: 'none' }}>
        <div className="filter-label">유형</div>
        <div className="chip-group">
          <button
            type="button"
            className={`chip${!filters.kind ? ' active' : ''}`}
            onClick={() => onKindChange(null)}
          >
            전체
          </button>
          {RECEIVING_KINDS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={`chip${filters.kind === kind ? ' active' : ''}`}
              onClick={() => onKindChange(filters.kind === kind ? null : kind)}
            >
              {kind}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-row">
        <div className="filter-label">품목</div>
        <div className="chip-group">
          <button
            type="button"
            className={`chip${!filters.category ? ' active' : ''}`}
            onClick={() => onCategoryChange(null)}
          >
            전체
          </button>
          {CATEGORIES.map((category) => (
            <button
              type="button"
              key={category}
              className={`chip${filters.category === category ? ' active' : ''}`}
              onClick={() => onCategoryChange(filters.category === category ? null : category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
