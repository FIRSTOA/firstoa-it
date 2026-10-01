/**
 * 실재고 조사 — 위치별로 돌아보며 전산 재고(구글시트)와 실물이 맞는지 확인하는 감사 세션.
 * 세션 하나 = 위치 하나를 조사한 기록, results는 시작 시점의 전산 재고 스냅샷 + 조사 결과.
 */

import type { Asset } from './types';

export const STOCKTAKE_ITEM_STATUSES = ['미확인', '확인됨', '목록외발견'] as const;
export type StocktakeItemStatus = (typeof STOCKTAKE_ITEM_STATUSES)[number];

export type StocktakeItem = {
  assetId: string;
  category: string;
  model: string;
  brand: string;
  status: StocktakeItemStatus;
  scannedAt: string | null;
  note: string;
};

export type StocktakeSession = {
  id: string;
  seq: number;
  location: string;
  status: '진행중' | '완료';
  startedBy: string;
  results: StocktakeItem[];
  startedAt: string;
  completedAt: string | null;
};

export type StocktakeSessionRow = {
  id: string;
  seq: number;
  location: string;
  status: string;
  started_by: string;
  results: StocktakeItem[];
  started_at: string;
  completed_at: string | null;
};

export function rowToStocktakeSession(row: StocktakeSessionRow): StocktakeSession {
  return {
    id: row.id,
    seq: row.seq,
    location: row.location,
    status: row.status === '완료' ? '완료' : '진행중',
    startedBy: row.started_by,
    results: Array.isArray(row.results) ? row.results : [],
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/** 그 위치에 있는 자산들로 조사 세션의 초기 results를 만듭니다. */
export function buildInitialResults(assetsAtLocation: Asset[]): StocktakeItem[] {
  return assetsAtLocation.map((a) => ({
    assetId: a.assetId,
    category: a.category,
    model: a.model,
    brand: a.brand,
    status: '미확인',
    scannedAt: null,
    note: '',
  }));
}

/**
 * KST(UTC+9, DST 없음)로 고정 포맷팅합니다. Intl.toLocaleString은 서버(Vercel, 보통 UTC)와
 * 클라이언트(브라우저 로컬 타임존/로케일)가 서로 다른 문자열을 만들어 React 하이드레이션
 * 불일치(#418)를 일으킬 수 있어서, 타임존에 의존하지 않는 수동 포맷을 씁니다.
 */
export function formatKstDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
}

export function stocktakeSummary(results: StocktakeItem[]) {
  const confirmed = results.filter((r) => r.status === '확인됨').length;
  const missing = results.filter((r) => r.status === '미확인').length;
  const unexpected = results.filter((r) => r.status === '목록외발견').length;
  return { total: results.length, confirmed, missing, unexpected };
}
