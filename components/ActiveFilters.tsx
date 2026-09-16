'use client';

import { MULTI_FILTER_KEYS, type Filters, type MultiFilterKey } from '@/lib/filters';

type Props = {
  filters: Filters;
  searchTerm: string;
  onSetFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onSetSearchTerm: (value: string) => void;
  onResetAll: () => void;
};

type Condition = { key: string; label: string; onRemove: () => void };

const DIMENSION_LABEL: Record<MultiFilterKey, string> = {
  status: '상태',
  category: '품목',
  spec: '사양',
  cpuType: 'CPU종류',
  gubunCode: '구분코드',
};

/** 현재 선택된 모든 조건을 요약해서 보여주고, 조건별로 개별 해제 + 전체 초기화를 제공합니다. */
export default function ActiveFilters({ filters, searchTerm, onSetFilter, onSetSearchTerm, onResetAll }: Props) {
  const conditions: Condition[] = [];

  for (const key of MULTI_FILTER_KEYS) {
    for (const value of filters[key]) {
      conditions.push({
        key: `${key}:${value}`,
        label: `${DIMENSION_LABEL[key]}: ${value}`,
        onRemove: () => onSetFilter(key, filters[key].filter((v) => v !== value)),
      });
    }
  }

  if (filters.malicious) {
    conditions.push({ key: 'malicious', label: '악성만', onRemove: () => onSetFilter('malicious', false) });
  }
  if (filters.brand) {
    const brand = filters.brand;
    conditions.push({ key: 'brand', label: `브랜드: ${brand}`, onRemove: () => onSetFilter('brand', null) });
  }
  if (filters.newDevice === 'new') {
    conditions.push({ key: 'new', label: '새기기만', onRemove: () => onSetFilter('newDevice', null) });
  }
  if (filters.screenGroup) {
    const screenGroup = filters.screenGroup;
    conditions.push({
      key: 'screen',
      label: `화면크기: ${screenGroup}`,
      onRemove: () => onSetFilter('screenGroup', null),
    });
  }
  if (searchTerm.trim()) {
    const term = searchTerm.trim();
    conditions.push({ key: 'q', label: `검색어: ${term}`, onRemove: () => onSetSearchTerm('') });
  }

  if (conditions.length === 0) return null;

  return (
    <div className="active-filters">
      <div className="active-filters-top">
        <span className="active-filters-label">선택 조건</span>
        <button type="button" className="btn btn-ghost active-filters-reset" onClick={onResetAll}>
          필터 초기화
        </button>
      </div>
      <div className="active-filters-pills">
        {conditions.map((c) => (
          <span key={c.key} className="filter-pill">
            {c.label}
            <button type="button" onClick={c.onRemove} aria-label={`${c.label} 조건 해제`}>
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
