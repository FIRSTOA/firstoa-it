import type { Asset } from './types';

/** 다중 선택(OR 안에서, 필터끼리는 AND)이 적용되는 필드 6개 */
export const MULTI_FILTER_KEYS = ['status', 'category', 'spec', 'cpuType', 'gubunCode', 'subItem'] as const;
export type MultiFilterKey = (typeof MULTI_FILTER_KEYS)[number];

export type Filters = {
  status: string[]; // [] = 전체
  category: string[]; // [] = 전체
  spec: string[]; // [] = 전체
  cpuType: string[]; // [] = 전체 (데스크탑/노트북만 값이 있음)
  gubunCode: string[]; // [] = 전체 (데스크탑/노트북만 값이 있음, "I5고설데" 같은 세부 구분코드)
  subItem: string[]; // [] = 전체 (기타주변기기만 값이 있음, "나스"/"마우스" 등 세부 품목명)
  malicious: boolean; // 기존 '__malicious__' 특수값을 진짜 boolean 필드로 분리
  brand: string | null;
  newDevice: 'new' | null;
  screenGroup: string | null;
};

export const EMPTY_FILTERS: Filters = {
  status: [],
  category: [],
  spec: [],
  cpuType: [],
  gubunCode: [],
  subItem: [],
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
    filters.cpuType.length > 0 ||
    filters.gubunCode.length > 0 ||
    filters.subItem.length > 0 ||
    filters.malicious ||
    filters.brand !== null ||
    filters.newDevice !== null ||
    filters.screenGroup !== null ||
    searchTerm.trim() !== ''
  );
}

/** "내부재고" 상태 프리셋 — 실제 상태값이 아니라 이 두 상태를 한번에 켜는 단축 칩입니다. */
export const INTERNAL_STOCK_STATUSES = ['상품화준비중', '상품화완료'];

/** 상태 필터가 정확히 "내부재고" 프리셋(순서 무관, 이 두 값만) 상태인지 확인합니다. */
export function isInternalStockActive(status: string[]): boolean {
  if (status.length !== INTERNAL_STOCK_STATUSES.length) return false;
  return INTERNAL_STOCK_STATUSES.every((s) => normalizedMembership(status, s));
}

/** "내부재고" 칩 클릭: 이미 그 프리셋이면 전체 해제, 아니면 프리셋 두 값으로 교체합니다. */
export function toggleInternalStock(status: string[]): string[] {
  return isInternalStockActive(status) ? [] : [...INTERNAL_STOCK_STATUSES];
}

export type CategoryVisibility = {
  showSpec: boolean;
  showCpuType: boolean;
  showScreen: boolean;
  showSubItem: boolean;
};

/**
 * 품목 선택에 따라 어떤 필터 줄을 보여줄지 결정합니다 (원본 대시보드 캡처 기준). 품목을
 * 하나만 선택했을 때만 의미가 있고, 미선택이거나 여러 개 선택했을 때는 "사양"만 보입니다.
 * FilterPanel(필터 줄 표시)과 applyCategoryChange(숨겨진 줄의 선택값 정리)가 이 함수 하나를
 * 공통으로 써서 기준이 갈라지지 않게 합니다.
 */
export function categoryVisibility(categorySelection: string[]): CategoryVisibility {
  const single = categorySelection.length === 1 ? categorySelection[0] : null;
  return {
    showSpec: single === null || single === '노트북' || single === '데스크탑',
    showCpuType: single === '노트북' || single === '데스크탑',
    showScreen: single !== null && ['노트북', '모니터', '빔프로젝트'].includes(single),
    showSubItem: single === '기타주변기기',
  };
}

/**
 * 품목 필터가 바뀔 때 호출합니다. 새 품목 선택 기준으로 숨겨지는 줄(사양/CPU종류/구분코드/
 * 화면크기/세부품목)의 선택값을 같이 비워서, 화면엔 안 보이는데 필터만 몰래 걸려있는 상태를
 * 막습니다.
 */
export function applyCategoryChange(filters: Filters, newCategory: string[]): Filters {
  const v = categoryVisibility(newCategory);
  return {
    ...filters,
    category: newCategory,
    spec: v.showSpec ? filters.spec : [],
    cpuType: v.showCpuType ? filters.cpuType : [],
    gubunCode: v.showCpuType ? filters.gubunCode : [],
    screenGroup: v.showScreen ? filters.screenGroup : null,
    subItem: v.showSubItem ? filters.subItem : [],
  };
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

function normalizedEquals(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/** 실제로 배열 안에 그 값이 있는지 확인합니다 (빈 배열이면 당연히 false). */
function normalizedMembership(list: string[], value: string): boolean {
  return list.some((v) => normalizedEquals(v, value));
}

/**
 * 필터 매칭용: 빈 배열은 "전체"(=조건 없음)라서 무엇이든 통과시킵니다.
 * normalizedMembership과 반드시 구분해서 써야 합니다 — 토글(있으면 빼고 없으면 더하기)에
 * 이 함수를 쓰면 빈 배열에서 "이미 있다"고 잘못 판단해서 첫 클릭이 항상 무시됩니다.
 */
function normalizedIncludes(list: string[], value: string): boolean {
  if (list.length === 0) return true;
  return normalizedMembership(list, value);
}

/** 다중선택 칩 토글: 이미 있으면 빼고, 없으면 더합니다. 항상 중복 없는 배열을 돌려줍니다. */
export function toggleMultiValue(list: string[], value: string): string[] {
  return normalizedMembership(list, value)
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
    if (!normalizedIncludes(filters.cpuType, it.cpuType)) return false;
    if (!normalizedIncludes(filters.gubunCode, it.gubunCode)) return false;
    if (!normalizedIncludes(filters.subItem, it.subItem)) return false;
    if (filters.brand && !normalizedEquals(it.brand, filters.brand)) return false;
    if (filters.newDevice === 'new' && !it.isNew) return false;
    if (filters.screenGroup && screenGroupOf(it.screen) !== filters.screenGroup) return false;
    if (term) {
      const hay = normalizeForCompare(`${it.assetId} ${it.model} ${it.brand} ${it.screen}`);
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

/**
 * 캐스케이딩 옵션 목록: 한 필터 줄(dimension)의 선택만 뺀 나머지 조건(검색어 포함)으로 좁힌
 * 데이터에서 실제 존재하는 값만 뽑습니다. 예: 품목=데스크탑, 사양=설계용인 상태에서 브랜드
 * 줄의 옵션을 구하면 실제 데이터에 있는 브랜드("조립PC")만 나옵니다 — 상태/품목처럼 항상 고정
 * 옵션을 보여주는 줄에는 쓰지 않습니다.
 */
export function cascadingOptions(
  items: Asset[],
  filters: Filters,
  searchTerm: string,
  dimension: MultiFilterKey,
): string[] {
  const relaxed: Filters = { ...filters, [dimension]: [] };
  const scoped = filterAssets(items, relaxed, searchTerm);
  return [...new Set(scoped.map((it) => it[dimension]).filter(Boolean))];
}

/** brand처럼 MultiFilterKey가 아닌 단일선택 필드용 캐스케이딩 옵션. */
export function cascadingBrandOptions(items: Asset[], filters: Filters, searchTerm: string): string[] {
  const relaxed: Filters = { ...filters, brand: null };
  const scoped = filterAssets(items, relaxed, searchTerm);
  return [...new Set(scoped.map((it) => it.brand).filter(Boolean))];
}
