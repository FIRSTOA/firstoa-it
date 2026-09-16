'use client';

import { toggleMultiValue, type Filters } from '@/lib/filters';
import { SPECS, STATUSES, type Asset } from '@/lib/types';

type ChipGroupProps = {
  label: string;
  options: string[];
  /** 현재 선택된 값들. 빈 배열이면 "전체" 칩이 활성 상태로 표시됩니다. */
  selected: string[];
  onToggle: (value: string) => void;
  onClearAll: () => void;
};

/**
 * 다중/단일 선택 둘 다 이 컴포넌트 하나로 처리합니다. 다중선택 필드는 selected 배열에 여러
 * 값이 들어갈 수 있고, 단일선택 필드는 호출부가 onToggle에서 "같은 값 다시 누르면 해제,
 * 다른 값 누르면 그 값 하나로 교체"로 감싸서 selected가 항상 0~1개만 갖도록 넘겨줍니다.
 */
function ChipGroup({ label, options, selected, onToggle, onClearAll }: ChipGroupProps) {
  const allActive = selected.length === 0;
  return (
    <div className="filter-row">
      <div className="filter-label">{label}</div>
      <div className="chip-group">
        <button
          type="button"
          className={`chip${allActive ? ' active' : ''}`}
          aria-pressed={allActive}
          onClick={onClearAll}
        >
          전체
        </button>
        {options.map((option) => {
          const isActive = selected.includes(option);
          return (
            <button
              type="button"
              key={option}
              className={`chip${isActive ? ' active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onToggle(option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  items: Asset[];
  filters: Filters;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSetFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
};

export default function FilterPanel({ items, filters, searchTerm, onSearchChange, onSetFilter }: Props) {
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

      {/* 상태·품목·사양: 다중 선택 (같은 필터 안에서는 OR) */}
      <ChipGroup
        label="상태"
        options={[...STATUSES]}
        selected={filters.status}
        onToggle={(v) => onSetFilter('status', toggleMultiValue(filters.status, v))}
        onClearAll={() => onSetFilter('status', [])}
      />
      <ChipGroup
        label="품목"
        options={uniq(items.map((i) => i.category))}
        selected={filters.category}
        onToggle={(v) => onSetFilter('category', toggleMultiValue(filters.category, v))}
        onClearAll={() => onSetFilter('category', [])}
      />
      <ChipGroup
        label="사양"
        options={[...SPECS]}
        selected={filters.spec}
        onToggle={(v) => onSetFilter('spec', toggleMultiValue(filters.spec, v))}
        onClearAll={() => onSetFilter('spec', [])}
      />
      <ChipGroup
        label="CPU종류"
        options={uniq(items.map((i) => i.cpuType).filter(Boolean))}
        selected={filters.cpuType}
        onToggle={(v) => onSetFilter('cpuType', toggleMultiValue(filters.cpuType, v))}
        onClearAll={() => onSetFilter('cpuType', [])}
      />
      <ChipGroup
        label="구분코드"
        options={uniq(items.map((i) => i.gubunCode).filter(Boolean))}
        selected={filters.gubunCode}
        onToggle={(v) => onSetFilter('gubunCode', toggleMultiValue(filters.gubunCode, v))}
        onClearAll={() => onSetFilter('gubunCode', [])}
      />

      {/* 브랜드·새기기·화면크기: 기존과 동일하게 단일 선택 유지 */}
      <ChipGroup
        label="브랜드"
        options={uniq(items.map((i) => i.brand))}
        selected={filters.brand ? [filters.brand] : []}
        onToggle={(v) => onSetFilter('brand', filters.brand === v ? null : v)}
        onClearAll={() => onSetFilter('brand', null)}
      />
      <ChipGroup
        label="새기기"
        options={['새기기만']}
        selected={filters.newDevice === 'new' ? ['새기기만'] : []}
        onToggle={() => onSetFilter('newDevice', filters.newDevice === 'new' ? null : 'new')}
        onClearAll={() => onSetFilter('newDevice', null)}
      />
      <ChipGroup
        label="화면크기"
        options={['15인치 이상', '15인치 미만']}
        selected={filters.screenGroup ? [filters.screenGroup] : []}
        onToggle={(v) => onSetFilter('screenGroup', filters.screenGroup === v ? null : v)}
        onClearAll={() => onSetFilter('screenGroup', null)}
      />
    </div>
  );
}
