/**
 * 비고(history) 원문을 "/"로 구분된 건별 이력으로 쪼갭니다. InventoryTable의 HistoryCell과
 * AssetDetailModal이 동일한 로직을 공유합니다 — deriveIsNew/deriveMalicious(status.ts)와
 * 같은 "/" 구분자 규칙.
 */
export function parseHistoryEntries(history: string): string[] {
  return history
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}
