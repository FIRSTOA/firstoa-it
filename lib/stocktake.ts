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

export function stocktakeSummary(results: StocktakeItem[]) {
  const confirmed = results.filter((r) => r.status === '확인됨').length;
  const missing = results.filter((r) => r.status === '미확인').length;
  const unexpected = results.filter((r) => r.status === '목록외발견').length;
  return { total: results.length, confirmed, missing, unexpected };
}
