export const STATUSES = ['상품화준비중', '상품화완료', '임대중', '기타'] as const;
export const CATEGORIES = ['노트북', '데스크탑', '모니터', '기타주변기기'] as const;
export const BRANDS = ['삼성', '레노버', 'APPLE', 'HP', 'LG', 'MSI'] as const;
export const CPUS = ['I5', 'I7', 'U5', 'U7', 'M2', 'M3', '미상'] as const;
export const SPECS = ['사무용', '설계용', '저사양', '확인필요'] as const;

export type Status = (typeof STATUSES)[number];

/** 앱 안에서 쓰는 자산 형태 (camelCase) */
export type Asset = {
  assetId: string;
  category: string;
  brand: string;
  model: string;
  cpu: string;
  spec: string;
  ram: string;
  storage: string;
  screen: string;
  location: string;
  status: string;
  history: string;
  isNew: boolean;
  malicious: boolean;
};

/** Supabase `it_assets` 테이블 행 (snake_case) */
export type AssetRow = {
  asset_id: string;
  category: string;
  brand: string;
  model: string;
  cpu: string;
  spec: string;
  ram: string;
  storage: string;
  screen: string;
  location: string;
  status: string;
  history: string;
  is_new: boolean;
  malicious: boolean;
};

export function rowToAsset(row: AssetRow): Asset {
  return {
    assetId: row.asset_id,
    category: row.category,
    brand: row.brand,
    model: row.model,
    cpu: row.cpu,
    spec: row.spec,
    ram: row.ram,
    storage: row.storage,
    screen: row.screen,
    location: row.location,
    status: row.status,
    history: row.history,
    isNew: row.is_new,
    malicious: row.malicious,
  };
}

export function assetToRow(asset: Asset): AssetRow {
  return {
    asset_id: asset.assetId,
    category: asset.category,
    brand: asset.brand,
    model: asset.model,
    cpu: asset.cpu,
    spec: asset.spec,
    ram: asset.ram,
    storage: asset.storage,
    screen: asset.screen,
    location: asset.location,
    status: asset.status,
    history: asset.history,
    is_new: asset.isNew,
    malicious: asset.malicious,
  };
}
