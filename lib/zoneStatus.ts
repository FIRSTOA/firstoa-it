/**
 * 재고 현황판 — 위치별/상태별 재고 집계 + 검증자 지정. app/inventoryStatus/actions.ts가
 * 'use server'라 상수/타입만 내보내는 파일을 못 써서(lib/confirmForm.ts와 동일한 이유)
 * 분리합니다. 구글시트 원장과 무관한 Supabase 전용 오버레이 데이터입니다.
 */
import type { StocktakeConfirmation } from './stocktake';
import { STATUSES, type Asset } from './types';

export const CONDITION_STATUSES = ['수리대기', '수리완료', '단순오버홀', '가용'] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

/** 품목별 집계 열로 쓰는 재고상태 — 임대중도 포함한 전체 상태 7개(STATUSES와 동일). */
export const BREAKDOWN_STATUSES = STATUSES;

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

/**
 * 진짜 선반 위치 코드처럼 생겼는지("A1"/"B2"/"G3 오버홀"처럼 영문+숫자로 시작) 확인합니다.
 * "반출"/"분실"/"수리중"/"폐기"/"판매"/"김정식프로문의" 같은 값은 선반 위치가 아니라
 * 상태·메모성 텍스트라 걸러냅니다. "N층"으로 시작하는 값("2층 A1" 등)과 "K"로 시작하는
 * 코드(K1/K2 등)는 실제로 재고파악(실재고조사)을 하지 않는 위치라 둘 다 제외합니다.
 */
export function looksLikeShelfLocation(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^\d+층/.test(trimmed)) return false;
  const match = trimmed.match(/^([A-Za-z]{1,2})\d+/);
  if (!match) return false;
  return !match[1].toUpperCase().startsWith('K');
}

export type StockCheckOverride = {
  location: string;
  excluded: boolean;
  updatedBy: string;
  updatedAt: string;
};

export type StockCheckOverrideRow = {
  location: string;
  excluded: boolean;
  updated_by: string;
  updated_at: string;
};

export function rowToStockCheckOverride(row: StockCheckOverrideRow): StockCheckOverride {
  return { location: row.location, excluded: row.excluded, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/**
 * "1차 수량 체크" 대상 여부 — 기본값은 looksLikeShelfLocation(선반 코드처럼 생겼는지)지만,
 * it_stock_check_overrides에 그 위치의 예외가 있으면 그걸 그대로 따릅니다(기본 분류를
 * 양쪽 방향으로 수동으로 뒤집을 수 있게).
 */
export function isStockCheckExcluded(location: string, overrideByLocation: Map<string, boolean>): boolean {
  const override = overrideByLocation.get(location);
  if (override !== undefined) return override;
  return !looksLikeShelfLocation(location);
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

export type QuantityCheck = {
  location: string;
  countedCount: number;
  checkedBy: string;
  checkedAt: string;
};

export type QuantityCheckRow = {
  location: string;
  counted_count: number;
  checked_by: string;
  checked_at: string;
};

export function rowToQuantityCheck(row: QuantityCheckRow): QuantityCheck {
  return {
    location: row.location,
    countedCount: row.counted_count,
    checkedBy: row.checked_by,
    checkedAt: row.checked_at,
  };
}

export type LocationAssetRef = { assetId: string; category: string; model: string };

export type LocationQuantityRow = {
  location: string;
  systemCount: number;
  countedCount: number | null;
  checkedBy: string;
  checkedAt: string | null;
  mismatch: boolean;
  assetIds: LocationAssetRef[];
};

/**
 * "숫자만 맞는지" 체크 — 실재고조사(자산번호 단위 스캔)와 별개로, 위치 하나를 보고 눈으로
 * 센 대수(QuantityCheck, 품목 구분 없이 위치 전체)와 시스템 수량을 비교합니다. 품목으로는
 * 안 나누고 위치 단위로만 집계하고, 각 위치에 실제로 어떤 자산번호가 있는지도 같이
 * 돌려줘서 화면에서 위치를 클릭하면 바로 펼쳐볼 수 있게 합니다.
 */
export function buildLocationQuantitySummary(assets: Asset[], checks: QuantityCheck[]): LocationQuantityRow[] {
  const checkByLocation = new Map(checks.map((c) => [c.location, c]));
  const byLocation = new Map<string, LocationAssetRef[]>();

  for (const asset of assets) {
    if (asset.status === '임대중') continue;
    if (!asset.assetId.trim()) continue;
    const location = asset.location.trim();
    if (!location) continue;

    const list = byLocation.get(location) ?? [];
    list.push({ assetId: asset.assetId, category: asset.category, model: asset.model });
    byLocation.set(location, list);
  }

  return [...byLocation.entries()]
    .map(([location, assetIds]) => {
      const check = checkByLocation.get(location);
      const systemCount = assetIds.length;
      return {
        location,
        systemCount,
        countedCount: check ? check.countedCount : null,
        checkedBy: check?.checkedBy ?? '',
        checkedAt: check?.checkedAt ?? null,
        mismatch: check ? check.countedCount !== systemCount : false,
        assetIds,
      };
    })
    .sort((a, b) => a.location.localeCompare(b.location, 'ko'));
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

export type CategoryBreakdownAssetRef = {
  assetId: string;
  model: string;
  specLabel: string;
  status: string;
};

export type CategoryBreakdownRow = {
  detailCode: string;
  total: number;
  byStatus: Record<string, number>;
  assets: CategoryBreakdownAssetRef[];
};

export type CategoryBreakdownGroup = {
  category: string;
  rows: CategoryBreakdownRow[];
  total: number;
  totalByStatus: Record<string, number>;
};

/** "가용재고" — 지금 당장 쓸 수 있거나(상품화준비중/상품화완료) 곧 쓸 수 있는(수리중) 자산. */
export const AVAILABLE_BREAKDOWN_STATUSES = ['상품화준비중', '상품화완료', '수리중'] as const;

/**
 * 품목 → 세부구분코드별 수량 집계(참고: first-as-search의 SKU별 재고 현황판과 비슷한
 * 구조). 층/선반 위치 매핑 없이, 품목별로 "구분코드" 한 단계만 내려가서 재고상태별 대수를
 * 보여줍니다. 세부구분코드는 노트북/데스크탑이면 gubunCode(예: "I5고설데"), 모니터면
 * 화면크기(인치), 기타주변기기면 subItem(나스/마우스 등), 그 외(빔프로젝트) 또는 값이
 * 없으면 모델명으로 묶습니다. 임대중 자산도 포함합니다 — "총재고"가 실제 보유 대수와
 * 맞아야 하고, 몇 대가 임대 나가 있는지도 한눈에 보여야 하기 때문입니다.
 */
export function buildCategoryBreakdown(assets: Asset[]): CategoryBreakdownGroup[] {
  type Bucket = { total: number; byStatus: Record<string, number>; assets: CategoryBreakdownAssetRef[] };
  const byCategory = new Map<string, Map<string, Bucket>>();

  for (const asset of assets) {
    if (!asset.assetId.trim()) continue;
    const screen = asset.screen.trim();
    const detailCode =
      asset.category === '모니터'
        ? screen && screen !== '-'
          ? screen
          : '(미상)'
        : asset.gubunCode.trim() || asset.subItem.trim() || asset.model.trim() || '(미상)';

    const byDetail = byCategory.get(asset.category) ?? new Map<string, Bucket>();
    byCategory.set(asset.category, byDetail);
    const bucket = byDetail.get(detailCode) ?? { total: 0, byStatus: {}, assets: [] };
    bucket.total += 1;
    bucket.byStatus[asset.status] = (bucket.byStatus[asset.status] ?? 0) + 1;
    bucket.assets.push({
      assetId: asset.assetId,
      model: asset.model,
      specLabel: asset.specLabel || asset.spec,
      status: asset.status,
    });
    byDetail.set(detailCode, bucket);
  }

  return [...byCategory.entries()]
    .map(([category, byDetail]) => {
      const rows = [...byDetail.entries()]
        .map(([detailCode, b]) => ({ detailCode, total: b.total, byStatus: b.byStatus, assets: b.assets }))
        .sort((a, b) => b.total - a.total);
      const total = rows.reduce((s, r) => s + r.total, 0);
      const totalByStatus: Record<string, number> = {};
      for (const r of rows) {
        for (const [status, count] of Object.entries(r.byStatus)) {
          totalByStatus[status] = (totalByStatus[status] ?? 0) + count;
        }
      }
      return { category, rows, total, totalByStatus };
    })
    .sort((a, b) => b.total - a.total);
}

/** 품목×구분코드별 안전재고 — 직접 입력해두면 가용재고와 비교해 부족분을 계산하는 데 씁니다. */
export type SafetyStock = {
  category: string;
  detailCode: string;
  safetyCount: number;
};

export type SafetyStockRow = {
  category: string;
  detail_code: string;
  safety_count: number;
};

export function rowToSafetyStock(row: SafetyStockRow): SafetyStock {
  return { category: row.category, detailCode: row.detail_code, safetyCount: row.safety_count };
}
