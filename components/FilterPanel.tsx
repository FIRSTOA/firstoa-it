'use client';

import { MALICIOUS, type Filters } from '@/lib/filters';
import { SPECS, STATUSES, type Asset } from '@/lib/types';

type ChipGroupProps = {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
};

function ChipGroup({ label, options, selected, onSelect }: ChipGroupProps) {
  return (
    <div className="filter-row">
      <div className="filter-label">{label}</div>
      <div className="chip-group">
        <button
          type="button"
          className={`chip${!selected ? ' active' : ''}`}
          onClick={() => onSelect(null)}
        >
          전체
        </button>
        {options.map((option) => (
          <button
            type="button"
            key={option}
            className={`chip${selected === option ? ' active' : ''}`}
            onClick={() => onSelect(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

type Props = {
  items: Asset[];
  filters: Filters;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onFilterChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
};

export default function FilterPanel({ items, filters, searchTerm, onSearchChange, onFilterChange }: Props) {
  const uniq = (values: string[]) => [...new Set(values)];

  return (
    <div className="panel">
      <div className="search-row">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="자산번호 / 모델명 / 시리얼 검색"
        />
      </div>

      <ChipGroup
        label="상태"
        options={[...STATUSES]}
        // '악성' 빠른 필터가 켜져 있을 때는 상태 칩을 '전체'로 표시합니다.
        selected={filters.status === MALICIOUS ? null : filters.status}
        onSelect={(v) => onFilterChange('status', v)}
      />
      <ChipGroup
        label="품목"
        options={uniq(items.map((i) => i.category))}
        selected={filters.category}
        onSelect={(v) => onFilterChange('category', v)}
      />
      <ChipGroup
        label="사양"
        options={[...SPECS]}
        selected={filters.spec}
        onSelect={(v) => onFilterChange('spec', v)}
      />
      <ChipGroup
        label="브랜드"
        options={uniq(items.map((i) => i.brand))}
        selected={filters.brand}
        onSelect={(v) => onFilterChange('brand', v)}
      />
      <ChipGroup
        label="새기기"
        options={['새기기만']}
        selected={filters.newDevice === 'new' ? '새기기만' : null}
        onSelect={(v) => onFilterChange('newDevice', v === null ? null : 'new')}
      />
      <ChipGroup
        label="CPU종류"
        options={uniq(items.map((i) => i.cpu).filter(Boolean))}
        selected={filters.cpu}
        onSelect={(v) => onFilterChange('cpu', v)}
      />
      <ChipGroup
        label="화면크기"
        options={['15인치 이상', '15인치 미만']}
        selected={filters.screenGroup}
        onSelect={(v) => onFilterChange('screenGroup', v)}
      />
    </div>
  );
}
