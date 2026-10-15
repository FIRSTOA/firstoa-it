/**
 * 재고 현황판 — 위치별/상태별 재고 집계 + 검증자 지정. app/inventoryStatus/actions.ts가
 * 'use server'라 상수/타입만 내보내는 파일을 못 써서(lib/confirmForm.ts와 동일한 이유)
 * 분리합니다. 구글시트 원장과 무관한 Supabase 전용 오버레이 데이터입니다.
 */
import type { StocktakeConfirmation } from './stocktake';
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

export type LocationFloorMap = { code: string; floor: string };
export type LocationFloorMapRow = { code: string; floor: string };

export function rowToLocationFloorMap(row: LocationFloorMapRow): LocationFloorMap {
  return { code: row.code, floor: row.floor };
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
 * 기존 Asset.location 원문(예: "B1수리중", "2층 A1", "D1 불량")에서 "위치 코드"만 뽑아냅니다.
 * "N층"으로 시작하면 이미 층 정보가 있는 거라 그대로 코드로 쓰고, 영문+숫자로 시작하면
 * (A1/B2/K3 등) 그 코드만 뽑고 뒤에 붙은 상태 설명(수리중/불량 등)은 버립니다.
 */
export function extractLocationCode(rawLocation: string): string {
  const trimmed = rawLocation.trim();
  if (!trimmed) return '';
  const floorMatch = trimmed.match(/^\d+층/);
  if (floorMatch) return floorMatch[0];
  const codeMatch = trimmed.match(/^([A-Za-z]+\d+)/);
  return codeMatch ? codeMatch[1].toUpperCase() : trimmed;
}

export type ResolvedLocation = {
  /** 매트릭스 행으로 쓰는 표시값(층 이름 또는 "미분류 (코드)" 또는 수동 재지정값) */
  floor: string;
  code: string;
  /** 코드→층 매핑이 돼 있거나(또는 이미 "N층"으로 시작) 수동 재지정된 경우 true */
  mapped: boolean;
  manual: boolean;
};

/**
 * 자산 하나의 "층"을 결정합니다. 우선순위: ① it_zone_status에 수동 재지정된 위치가
 * 있으면 그걸 그대로 씀(개별 예외 처리용) ② Asset.location에서 뽑은 코드가
 * it_location_floor_map에 있으면 그 층 ③ 둘 다 없으면 "미분류 (코드)"로 모아서, 관리자가
 * 그 코드만 한 번 매핑하면 전체 자산이 한꺼번에 해결되게 합니다.
 */
export function resolveAssetLocation(
  asset: Asset,
  zone: ZoneStatus | undefined,
  floorByCode: Map<string, string>,
): ResolvedLocation {
  if (zone?.location.trim()) {
    return { floor: zone.location.trim(), code: zone.location.trim(), mapped: true, manual: true };
  }
  const trimmed = asset.location.trim();
  if (!trimmed) return { floor: UNASSIGNED_LOCATION, code: '', mapped: false, manual: false };

  const code = extractLocationCode(trimmed);
  if (/^\d+층/.test(code)) return { floor: code, code, mapped: true, manual: false };

  const floor = floorByCode.get(code);
  if (floor) return { floor, code, mapped: true, manual: false };
  return { floor: `미분류 (${code})`, code, mapped: false, manual: false };
}

/**
 * 가용 범위(임대중 제외, 자산번호 있는 것만) 자산 + 태깅 데이터로 위치×품목 매트릭스를
 * 만듭니다. 코드→층 매핑이 없는 자산은 "미분류 (코드)"로 모아서, 그 코드 하나만 매핑하면
 * 한꺼번에 해결된다는 걸 바로 알 수 있게 합니다.
 */
export function buildZoneMatrix(
  assets: Asset[],
  zoneByAssetId: Map<string, ZoneStatus>,
  floorByCode: Map<string, string>,
): { cells: ZoneMatrixCell[]; locations: string[]; categories: string[]; unmappedCodes: { code: string; count: number }[] } {
  const cellMap = new Map<string, ZoneMatrixCell>();
  const locations = new Set<string>();
  const categories = new Set<string>();
  const unmappedCounts = new Map<string, number>();

  for (const asset of assets) {
    if (asset.status === '임대중') continue; // 범위 밖(렌탈 중 자산은 추후)
    // 기타주변기기 중 공유기처럼 자산번호 없이 수량으로만 관리되는 소모성 재고는 개별
    // 태깅/검증 대상이 아니라서 아예 집계에서 뺍니다 — 자산번호가 없으면 애초에
    // updateZoneStatus로 태깅할 키도 없음.
    if (!asset.assetId.trim()) continue;

    const zone = zoneByAssetId.get(asset.assetId);
    const resolved = resolveAssetLocation(asset, zone, floorByCode);
    const condition = zone?.conditionStatus || '가용';
    const category = asset.category;

    if (!resolved.mapped && resolved.code) {
      unmappedCounts.set(resolved.code, (unmappedCounts.get(resolved.code) ?? 0) + 1);
    }

    locations.add(resolved.floor);
    categories.add(category);

    const key = `${resolved.floor}\u0000${category}`;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = { location: resolved.floor, category, total: 0, byCondition: {}, assetIds: [] };
      cellMap.set(key, cell);
    }
    cell.total += 1;
    cell.byCondition[condition] = (cell.byCondition[condition] ?? 0) + 1;
    cell.assetIds.push(asset.assetId);
  }

  const sortedLocations = [...locations].sort((a, b) => {
    const aUnassigned = a === UNASSIGNED_LOCATION || a.startsWith('미분류');
    const bUnassigned = b === UNASSIGNED_LOCATION || b.startsWith('미분류');
    if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
    return a.localeCompare(b, 'ko');
  });

  const unmappedCodes = [...unmappedCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return { cells: [...cellMap.values()], locations: sortedLocations, categories: [...categories].sort(), unmappedCodes };
}

export function findCell(cells: ZoneMatrixCell[], location: string, category: string): ZoneMatrixCell | null {
  return cells.find((c) => c.location === location && c.category === category) ?? null;
}

export type LocationCheckRow = {
  location: string; // 실재고조사와 똑같이 쓰는 원문 위치값(예: "A1", "G3 오버홀") — 코드로 안 줄임
  systemCount: number; // 지금 시스템(구글시트) 기준 그 위치·품목의 대수
  confirmedCount: number; // 그중 실재고조사로 실제 확인된 대수
  lastScannedAt: string | null;
  verifiedBy: string;
  mismatch: boolean;
};

/**
 * "1차 수량 체크" — 위치별/품목별로 시스템 수량과 실재고조사(2차 검증)로 실제 확인된
 * 수량을 나란히 비교합니다. 실재고조사가 이미 하는 자산 단위 스캔 결과를 그대로
 * 재사용하므로, 여기서 따로 숫자를 입력받지 않습니다(화면만 다르고 데이터 출처는
 * confirmationByAssetId = lib/stocktake.ts의 buildLatestConfirmationMap 결과 그대로).
 */
export function buildLocationCheckTables(
  assets: Asset[],
  confirmationByAssetId: Record<string, StocktakeConfirmation>,
): { category: string; rows: LocationCheckRow[]; total: { system: number; confirmed: number } }[] {
  type Bucket = { system: number; confirmed: number; lastScannedAt: string | null; verifiedBy: string };
  const byCategory = new Map<string, Map<string, Bucket>>();

  for (const asset of assets) {
    if (asset.status === '임대중') continue;
    if (!asset.assetId.trim()) continue;
    const location = asset.location.trim();
    if (!location) continue;

    const byLocation = byCategory.get(asset.category) ?? new Map<string, Bucket>();
    byCategory.set(asset.category, byLocation);
    const bucket = byLocation.get(location) ?? { system: 0, confirmed: 0, lastScannedAt: null, verifiedBy: '' };
    bucket.system += 1;

    const confirmation = confirmationByAssetId[asset.assetId];
    if (confirmation) {
      bucket.confirmed += 1;
      if (!bucket.lastScannedAt || confirmation.scannedAt > bucket.lastScannedAt) {
        bucket.lastScannedAt = confirmation.scannedAt;
        bucket.verifiedBy = confirmation.startedBy;
      }
    }
    byLocation.set(location, bucket);
  }

  return [...byCategory.entries()]
    .map(([category, byLocation]) => {
      const rows = [...byLocation.entries()]
        .map(([location, b]) => ({
          location,
          systemCount: b.system,
          confirmedCount: b.confirmed,
          lastScannedAt: b.lastScannedAt,
          verifiedBy: b.verifiedBy,
          mismatch: b.confirmed !== b.system,
        }))
        .sort((a, b) => a.location.localeCompare(b.location, 'ko'));
      const total = rows.reduce(
        (acc, r) => ({ system: acc.system + r.systemCount, confirmed: acc.confirmed + r.confirmedCount }),
        { system: 0, confirmed: 0 },
      );
      return { category, rows, total };
    })
    .sort((a, b) => a.category.localeCompare(b.category, 'ko'));
}
