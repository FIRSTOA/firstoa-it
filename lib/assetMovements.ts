/** 자산 이동 이력 (Supabase asset_movements 테이블) — 앱 안에서 쓰는 형태(camelCase) */
export type AssetMovement = {
  id: string;
  assetNumber: string;
  category: string;
  movedAt: string;
  fromLocation: string | null;
  toLocation: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string;
  memo: string;
};

/** Supabase `asset_movements` 테이블 행 (snake_case) */
export type AssetMovementRow = {
  id: string;
  asset_number: string;
  category: string;
  moved_at: string;
  from_location: string | null;
  to_location: string | null;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  memo: string;
};

export function rowToAssetMovement(row: AssetMovementRow): AssetMovement {
  return {
    id: row.id,
    assetNumber: row.asset_number,
    category: row.category,
    movedAt: row.moved_at,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actor: row.actor,
    memo: row.memo,
  };
}
