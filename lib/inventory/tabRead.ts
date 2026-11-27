/**
 * IT재고 5탭 읽기 결과 — 못 읽은 탭을 숨기지 않고 같이 돌려줍니다(2026-11-27).
 * 예전 listAllAssets 는 못 읽은 탭(구글시트 읽기 한도 429 등)을 아무 말 없이 빈 목록으로 바꿔서
 * 화면의 대수·위치가 조용히 모자랐음. 서버(lib/inventory/sheets.ts listAllAssets)와 화면
 * (components/InventoryReadWarning.tsx·홈 IT 재고 카드·청구 추천·자산 이력)이 같이 씀 → server-only 아님, 순수 함수만.
 * 실패 한 건의 모양은 실재고 조사의 mergeTabReads(lib/stocktake.ts)와 같음(tab = 품목 이름, 예: '노트북').
 */
import { CATEGORIES, type Asset } from '@/lib/types';
import type { TabReadFailure } from '@/lib/stocktake';

export type InventoryRead = { assets: Asset[]; failed: TabReadFailure[] };

/** 구글시트 읽기 한도(서비스계정 분당 60회)에 걸린 실패인지 — 429 이거나 문구에 quota·rate limit. */
export function isQuotaFailure(f: Pick<TabReadFailure, 'status' | 'message'>): boolean {
  return f.status === 429 || /quota|rate ?limit/i.test(f.message);
}

/** 모든 탭을 같은 이유로 못 읽음(설정 없음·한 번에 읽기가 한도에 걸림 등) */
export function failAllTabs(status: number | null, message: string): TabReadFailure[] {
  return CATEGORIES.map((tab) => ({ tab, status, message }));
}

/**
 * 화면 위 띠·홈 카드에 쓸 쉬운 말 한 줄('' = 다 읽음). consequence = 이 화면에서 뭐가 모자랄 수 있는지.
 * 예: "IT재고 시트의 노트북 탭을 못 읽었어요(구글시트 읽기 한도에 걸린 것 같아요 — 1분에 60번, 앱 전체가 같이 씀)
 *      — 1분쯤 뒤 새로고침하면 다시 읽어요. 이 화면의 대수가 모자랄 수 있어요."
 */
export function inventoryReadWarning(
  failed: readonly TabReadFailure[],
  consequence = '이 화면의 대수가 모자랄 수 있어요.',
): string {
  if (failed.length === 0) return '';
  const tabs = Array.from(new Set(failed.map((f) => f.tab)));
  const what = failedEveryTab(failed) ? 'IT재고 시트를 못 읽었어요' : `IT재고 시트의 ${tabs.join('·')} 탭을 못 읽었어요`;
  const quota = failed.some(isQuotaFailure);
  const why = quota
    ? '구글시트 읽기 한도에 걸린 것 같아요 — 1분에 60번, 앱 전체가 같이 씀'
    : '구글시트 읽기 한도일 수 있어요';
  const tail = quota ? '' : ' 계속 그러면 시트의 탭 이름이나 "자산번호" 머리줄이 바뀌지 않았는지 봐 주세요.';
  return `${what}(${why}) — 1분쯤 뒤 새로고침하면 다시 읽어요.${consequence ? ` ${consequence}` : ''}${tail}`;
}

/** 홈 카드처럼 좁은 곳에 쓸 짧은 한 줄('' = 다 읽음) */
export function inventoryReadShortWarning(failed: readonly TabReadFailure[]): string {
  if (failed.length === 0) return '';
  const tail = '(구글시트 읽기 한도일 수 있어요) — 1분쯤 뒤 새로고침하면 다시 읽어요';
  if (failedEveryTab(failed)) return `IT재고 시트를 못 읽었어요${tail}`;
  const tabs = Array.from(new Set(failed.map((f) => f.tab)));
  return `${tabs.join('·')} 탭을 못 읽어 대수가 모자랄 수 있어요${tail}`;
}

/** 다섯 탭 전부 못 읽었는지(화면이 빨강으로 바꿀 때) */
export function failedEveryTab(failed: readonly TabReadFailure[]): boolean {
  const tabs = new Set(failed.map((f) => f.tab));
  return CATEGORIES.every((c) => tabs.has(c));
}
