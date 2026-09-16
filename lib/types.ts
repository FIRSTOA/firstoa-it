export const STATUSES = ['상품화준비중', '상품화완료', '임대중', '수리중', '미정', '기타'] as const;
export const CATEGORIES = ['노트북', '데스크탑', '모니터', '빔프로젝트', '기타주변기기'] as const;
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
  // 시트 B열("사양(PC라벨)"/"사양") 원문 — 카테고리 구분 없이 전부 채워짐. 표에서는 이 값을
  // cpu/ram/storage를 이어붙인 긴 문구 대신 간략 사양으로 보여줍니다.
  specLabel: string;
  ram: string;
  storage: string;
  screen: string;
  location: string;
  status: string;
  history: string;
  isNew: boolean;
  malicious: boolean;
  serialNo: string;
  // 데스크탑/노트북에만 parseGubunAndSpec_로 채워짐 (구분값 원문 그대로 두 필드). Supabase엔
  // 대응 컬럼이 없어서 rowToAsset은 빈 문자열로 채웁니다 — filterAssets/countExcluding이
  // it[dimension]을 항상 string으로 가정하므로 다른 필드들처럼 옵셔널이 아닌 빈 문자열로 둡니다.
  cpuType: string;
  gubunCode: string;
  // 기타주변기기 시트 자체의 "품목" 컬럼(나스/마우스/키보드 등 세부 항목명) — 다른 카테고리는
  // 그 컬럼이 카테고리명 고정값이라 의미가 없어서 기타주변기기에만 채웁니다.
  subItem: string;
  // 예약 기능은 지금 구글시트 소스에서만 씁니다 (Supabase it_assets엔 대응 컬럼이 없어서
  // 옵셔널로 둡니다 — rowToAsset/assetToRow는 안 건드려도 됨).
  reservedBy?: string;
  reservedAt?: string;
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
  serial_no: string;
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
    serialNo: row.serial_no,
    specLabel: '',
    cpuType: '',
    gubunCode: '',
    subItem: '',
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
    serial_no: asset.serialNo,
  };
}
