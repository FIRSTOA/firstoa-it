import type { Asset } from './types';

/** 다중 선택(OR 안에서, 필터끼리는 AND)이 적용되는 필드 3개 */
export const MULTI_FILTER_KEYS = ['status', 'category', 'spec'] as const;
export type MultiFilterKey = (typeof MULTI_FILTER_KEYS)[number];

export type Filters = {
  status: string[]; // [] = 전체
  category: string[]; // [] = 전체
  spec: string[]; // [] = 전체
  malicious: boolean; // 기존 '__malicious__' 특수값을 진짜 boolean 필드로 분리
  brand: string | null;
  newDevice: 'new' | null;
  screenGroup: string | null;
};

export const EMPTY_FILTERS: Filters = {
  status: [],
  category: [],
  spec: [],
  malicious: false,
  brand: null,
  newDevice: null,
  screenGroup: null,
};

export function hasActiveFilters(filters: Filters, searchTerm: string): boolean {
  return (
    filters.status.length > 0 ||
    filters.category.length > 0 ||
    filters.spec.length > 0 ||
    filters.malicious ||
    filters.brand !== null ||
    filters.newDevice !== null ||
    filters.screenGroup !== null ||
    searchTerm.trim() !== ''
  );
}

/**
 * 앞뒤 공백/연속 공백/영문 대소문자 차이로 같은 값을 다르게 취급하지 않도록 비교용으로만
 * 씁니다. 원본 데이터(Asset)는 그대로 두고, 필터 매칭에만 적용합니다.
 * (실제 구글시트 데이터 확인 결과 브랜드에서 "APPLE"/"Apple", "조립PC"/"조립pc" 같은
 * 대소문자 차이 표기가 발견돼서, 이 정규화가 없으면 같은 브랜드인데 필터가 서로 안 걸립니다.)
 */
export function normalizeForCompare(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizedIncludes(list: string[], value: string): boolean {
  if (list.length === 0) return true;
  const target = normalizeForCompare(value);
  return list.some((v) => normalizeForCompare(v) === target);
}

function normalizedEquals(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/** 다중선택 칩 토글: 이미 있으면 빼고, 없으면 더합니다. 항상 중복 없는 배열을 돌려줍니다. */
export function toggleMultiValue(list: string[], value: string): string[] {
  return normalizedIncludes(list, value)
    ? list.filter((v) => !normalizedEquals(v, value))
    : [...list, value];
}

export function screenGroupOf(screen: string): string {
  if (!screen || screen === '-') return '기타';
  const num = parseFloat(screen);
  if (Number.isNaN(num)) return '기타';
  return num >= 15 ? '15인치 이상' : '15인치 미만';
}

export function filterAssets(items: Asset[], filters: Filters, searchTerm: string): Asset[] {
  const term = normalizeForCompare(searchTerm);
  return items.filter((it) => {
    if (filters.malicious && !it.malicious) return false;
    if (!normalizedIncludes(filters.status, it.status)) return false;
    if (!normalizedIncludes(filters.category, it.category)) return false;
    if (!normalizedIncludes(filters.spec, it.spec)) return false;
    if (filters.brand && !normalizedEquals(it.brand, filters.brand)) return false;
    if (filters.newDevice === 'new' && !it.isNew) return false;
    if (filters.screenGroup && screenGroupOf(it.screen) !== filters.screenGroup) return false;
    if (term) {
      const hay = normalizeForCompare(`${it.assetId} ${it.model} ${it.brand}`);
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

/**
 * 특정 필터 항목(dimension = value)을 뺀 나머지 조건(검색어 포함)만 적용했을 때, 그 항목에
 * 해당하는 건수를 셉니다. 상태/품목 카드에 "이 항목을 추가로 선택하면 몇 건인지"를 보여줄 때
 * 씁니다 — 이렇게 하면 카드 숫자와 실제로 그 항목을 선택했을 때의 표 행 수가 항상 일치합니다.
 */
export function countExcluding(
  items: Asset[],
  filters: Filters,
  searchTerm: string,
  dimension: MultiFilterKey,
  value: string,
): number {
  const relaxed: Filters = { ...filters, [dimension]: [] };
  return filterAssets(items, relaxed, searchTerm).filter((it) => normalizedEquals(it[dimension], value))
    .length;
}
