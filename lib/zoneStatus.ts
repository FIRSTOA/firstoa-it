/**
 * 재고 현황판 — 위치별/상태별 재고 집계 + 검증자 지정. app/inventoryStatus/actions.ts가
 * 'use server'라 상수/타입만 내보내는 파일을 못 써서(lib/confirmForm.ts와 동일한 이유)
 * 분리합니다. 구글시트 원장과 무관한 Supabase 전용 오버레이 데이터입니다.
 */
import type { Asset } from './types';

export const CONDITION_STATUSES = ['수리대기', '수리완료', '단순오버홀', '가용'] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export type ZoneStatus = {
  assetId: string;
  location: string;
  conditionStatus: string;
  note: string;
  updatedBy: string;
  updatedAt: string;
};

export type ZoneStatusRow = {
  asset_id: string;
  location: string;
  condition_status: string;
  note: string;
  updated_by: string;
  updated_at: string;
};

export function rowToZoneStatus(row: ZoneStatusRow): ZoneStatus {
  return {
    assetId: row.asset_id,
    location: row.location,
    conditionStatus: row.condition_status,
    note: row.note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export type ZoneVerification = {
  location: string;
  category: string;
  verifierName: string;
  verified: boolean;
  verifiedAt: string | null;
  verifiedCount: number | null;
};

export type ZoneVerificationRow = {
  location: string;
  category: string;
  verifier_name: string;
  verified: boolean;
  verified_at: string | null;
  verified_count: number | null;
};

export function rowToZoneVerification(row: ZoneVerificationRow): ZoneVerification {
  return {
    location: row.location,
    category: row.category,
    verifierName: row.verifier_name,
    verified: row.verified,
    verifiedAt: row.verified_at,
    verifiedCount: row.verified_count,
  };
}

/** 위치×품목 매트릭스 한 칸. */
export type ZoneMatrixCell = {
  location: string;
  category: string;
  total: number;
  byCondition: Record<string, number>;
  assetIds: string[];
};

const UNASSIGNED_LOCATION = '(위치 미지정)';

/**
 * 가용 범위(임대중 제외) 자산 + 태깅 데이터로 위치×품목 매트릭스를 만듭니다. 아직 태깅 안
 * 된 자산은 "(위치 미지정)" 행으로 모아서, 전수조사가 끝나기 전에도 화면이 비어 보이지
 * 않고 "아직 몇 건 남았는지"가 바로 보이게 합니다.
 */
export function buildZoneMatrix(
  assets: Asset[],
  zoneByAssetId: Map<string, ZoneStatus>,
): { cells: ZoneMatrixCell[]; locations: string[]; categories: string[] } {
  const cellMap = new Map<string, ZoneMatrixCell>();
  const locations = new Set<string>();
  const categories = new Set<string>();

  for (const asset of assets) {
    if (asset.status === '임대중') continue; // 범위 밖(렌탈 중 자산은 추후)
    const zone = zoneByAssetId.get(asset.assetId);
    const location = zone?.location.trim() || UNASSIGNED_LOCATION;
    const condition = zone?.conditionStatus || '가용';
    const category = asset.category;

    locations.add(location);
    categories.add(category);

    const key = `${location}\u0000${category}`;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = { location, category, total: 0, byCondition: {}, assetIds: [] };
      cellMap.set(key, cell);
    }
    cell.total += 1;
    cell.byCondition[condition] = (cell.byCondition[condition] ?? 0) + 1;
    cell.assetIds.push(asset.assetId);
  }

  const sortedLocations = [...locations].sort((a, b) =>
    a === UNASSIGNED_LOCATION ? 1 : b === UNASSIGNED_LOCATION ? -1 : a.localeCompare(b, 'ko'),
  );

  return { cells: [...cellMap.values()], locations: sortedLocations, categories: [...categories].sort() };
}

export function findCell(cells: ZoneMatrixCell[], location: string, category: string): ZoneMatrixCell | null {
  return cells.find((c) => c.location === location && c.category === category) ?? null;
}
