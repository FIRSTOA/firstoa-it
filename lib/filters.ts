import type { Asset } from './types';

/** 상태 카드의 '악성' 빠른 필터를 나타내는 특수 값 */
export const MALICIOUS = '__malicious__';

export type Filters = {
  status: string | null;
  category: string | null;
  spec: string | null;
  brand: string | null;
  newDevice: 'new' | null;
  cpu: string | null;
  screenGroup: string | null;
};

export const EMPTY_FILTERS: Filters = {
  status: null,
  category: null,
  spec: null,
  brand: null,
  newDevice: null,
  cpu: null,
  screenGroup: null,
};

export function screenGroupOf(screen: string): string {
  if (!screen || screen === '-') return '기타';
  const num = parseFloat(screen);
  if (Number.isNaN(num)) return '기타';
  return num >= 15 ? '15인치 이상' : '15인치 미만';
}

export function filterAssets(items: Asset[], filters: Filters, searchTerm: string): Asset[] {
  const term = searchTerm.trim().toLowerCase();
  return items.filter((it) => {
    if (filters.status === MALICIOUS) {
      if (!it.malicious) return false;
    } else if (filters.status && it.status !== filters.status) {
      return false;
    }
    if (filters.category && it.category !== filters.category) return false;
    if (filters.spec && it.spec !== filters.spec) return false;
    if (filters.brand && it.brand !== filters.brand) return false;
    if (filters.newDevice === 'new' && !it.isNew) return false;
    if (filters.cpu && it.cpu !== filters.cpu) return false;
    if (filters.screenGroup && screenGroupOf(it.screen) !== filters.screenGroup) return false;
    if (term) {
      const hay = `${it.assetId} ${it.model} ${it.brand}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}
