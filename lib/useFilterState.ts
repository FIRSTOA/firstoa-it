'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyCategoryChange, EMPTY_FILTERS, MULTI_FILTER_KEYS, type Filters } from './filters';

/**
 * 필터/검색어 상태와 URL 쿼리스트링 동기화를 한 곳에서 관리합니다.
 *
 * 일부러 Next 라우터(useRouter/usePathname)를 쓰지 않고 history.replaceState로만
 * URL을 바꿉니다. app/page.tsx가 force-dynamic이라, 라우터로 내비게이션하면 쿼리스트링만
 * 바뀌어도 서버 컴포넌트가 다시 실행되면서 구글시트를 매번 다시 읽어오게 됩니다 — 필터
 * 버튼을 누를 때마다 그런 요청이 나가면 반응이 느려지고 API 호출도 낭비됩니다. URL만 조용히
 * 바꾸면 페이지 새로고침 없이 즉시 반영되면서도, 새로고침하거나 링크를 공유했을 때는 그대로
 * 복원됩니다. 다만 history 항목을 새로 안 쌓기 때문에, 브라우저 "뒤로가기"로 필터를 한
 * 단계씩 되돌리는 것까지는 지원하지 않습니다.
 */

function parseFromSearch(search: string): { filters: Filters; searchTerm: string } {
  const params = new URLSearchParams(search);
  const filters: Filters = { ...EMPTY_FILTERS };

  for (const key of MULTI_FILTER_KEYS) {
    const raw = params.get(key);
    if (raw) {
      filters[key] = raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
  }

  const brand = params.get('brand');
  if (brand) filters.brand = brand;
  const screen = params.get('screen');
  if (screen) filters.screenGroup = screen;
  if (params.get('new') === '1') filters.newDevice = 'new';
  if (params.get('malicious') === '1') filters.malicious = true;

  return { filters, searchTerm: params.get('q') ?? '' };
}

function buildSearch(filters: Filters, searchTerm: string): string {
  const params = new URLSearchParams();
  for (const key of MULTI_FILTER_KEYS) {
    if (filters[key].length > 0) params.set(key, filters[key].join(','));
  }
  if (filters.brand) params.set('brand', filters.brand);
  if (filters.screenGroup) params.set('screen', filters.screenGroup);
  if (filters.newDevice === 'new') params.set('new', '1');
  if (filters.malicious) params.set('malicious', '1');
  if (searchTerm.trim()) params.set('q', searchTerm.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useFilterState() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchTerm, setSearchTerm] = useState('');
  // 검색창은 즉시 반영(입력 반응성)하되, 실제 필터링/집계 계산에 쓰는 값은 250ms 디바운스합니다 —
  // 안 그러면 2,400여 건 전체를 글자 하나마다 다시 훑어서(StatsRow/CategoryCards/FilterPanel
  // 캐스케이딩 옵션 등) 타이핑이 버벅거립니다.
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  // 최초 마운트에서 URL을 읽어 복원하기 전까지는, 그 복원 자체가 URL에 다시 쓰이지 않게 막습니다.
  const hydrated = useRef(false);

  useEffect(() => {
    const { filters: restored, searchTerm: restoredTerm } = parseFromSearch(window.location.search);
    setFilters(restored);
    setSearchTerm(restoredTerm);
    setDebouncedSearchTerm(restoredTerm);
    hydrated.current = true;
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearchTerm(searchTerm), 250);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    if (!hydrated.current) return;
    const next = `${window.location.pathname}${buildSearch(filters, debouncedSearchTerm)}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }, [filters, debouncedSearchTerm]);

  const setFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // 품목 필터 전용 setter: 화면에서 숨겨지는 필터 줄(사양/CPU종류/화면크기/세부품목 등)의
  // 선택값도 applyCategoryChange로 같이 정리합니다 — setFilter('category', ...)로 직접 바꾸면
  // 이 정리가 빠집니다.
  const setCategory = useCallback((newCategory: string[]) => {
    setFilters((prev) => applyCategoryChange(prev, newCategory));
  }, []);

  const resetAll = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearchTerm('');
    setDebouncedSearchTerm('');
  }, []);

  return { filters, searchTerm, debouncedSearchTerm, setSearchTerm, setFilter, setCategory, resetAll };
}
