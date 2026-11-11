import 'server-only';
import { fetchAllWorksRows, isWorksConfigured } from '@/lib/works/client';

/**
 * 임대리스트(/rentals)의 로컬 사본(it_rental_list)을 firstoa-works(별도 ERP, Supabase
 * 프로젝트 ajpcadmhfumcdwjseqez)의 assets 테이블에서 읽어 채웁니다. 예전엔 구글시트
 * "임대리스트" 탭을 읽었지만(lib/rentals/sync.ts, 삭제됨), 회사가 그 데이터를 이미
 * firstoa-works로 구조화해서 운영 중이라 그쪽을 원천으로 완전히 교체했습니다.
 *
 * it_rental_list.sheet_row(정수, unique)는 이름은 "구글시트 행번호"지만, 이제
 * firstoa-works assets.id를 그대로 담습니다 — 동기화 키 역할은 똑같아서 컬럼명은 안
 * 바꿨습니다(it_billing_lines.rental_sheet_row FK도 그대로 유효).
 */

export function isWorksSyncConfigured(): boolean {
  return isWorksConfigured();
}

export const WORKS_ASSETS_URL = 'https://firstoa-works.vercel.app/assets';

export type WorksAssetRow = {
  sheetRow: number; // firstoa-works assets.id
  rowHash: string;
  seq: string;
  vendorName: string;
  siteName: string;
  manager: string;
  phone: string;
  assetCode: string;
  modelName: string;
  serialNumber: string;
  contractDate: string;
  endDate: string;
  status: string;
  item: string;
  manufacturer: string;
  region: string;
  province: string;
  grade: string;
  contractType: string;
  option1: string;
  option2: string;
  option3: string;
  option4: string;
  baseAmount: string; // 기본금액(월)
  firstContractDate: string; // 첫계약일
  entryDate: string; // 입력일 — 임대종료 건은 철수(종료)된 날짜
  removalDate: string;
};

type WorksAssetApiRow = {
  id: number;
  classification_number: string | null;
  name: string | null;
  sales_location: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  asset_code: string | null;
  model_name: string | null;
  device_sn: string | null;
  contract_date: string | null;
  end_date: string | null;
  rental_status: string | null;
  item_category: string | null;
  manufacturer: string | null;
  manager: string | null; // firstoa-works 쪽 컬럼명은 "manager"지만 실제 값은 담당지역(예: "수도권D")
  province: string | null;
  client_grade: string | null;
  general_or_site: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  option4: string | null;
  base_amount: number | string | null;
  first_contract_date: string | null;
  entry_date: string | null;
  input_date_raw: string | null;
  removal_date: string | null;
};

const SELECT_COLS = [
  'id',
  'classification_number',
  'name',
  'sales_location',
  'contact_person',
  'contact_phone',
  'asset_code',
  'model_name',
  'device_sn',
  'contract_date',
  'end_date',
  'rental_status',
  'item_category',
  'manufacturer',
  'manager',
  'province',
  'client_grade',
  'general_or_site',
  'option1',
  'option2',
  'option3',
  'option4',
  'base_amount',
  'first_contract_date',
  'entry_date',
  'input_date_raw',
  'removal_date',
].join(',');

function str(v: string | number | null): string {
  return String(v ?? '').trim();
}

/** "2024. 12. 16" / "2024-12-16" / "2024-12-16T..." → "2024-12-16" (못 읽으면 원문) */
function normalizeDate(v: string | null): string {
  const s = str(v);
  const m = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
}

/** 매핑된 필드만으로 변경 감지용 해시를 계산합니다(충돌 안전성은 필요 없음 — 대조 속도용). */
function hashFields(fields: Omit<WorksAssetRow, 'sheetRow' | 'rowHash'>): string {
  const s = JSON.stringify(fields);
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export type WorksAssetsResult = {
  rows: WorksAssetRow[];
  /** billings 동기화에서 asset_id(=works assets.id) → asset_code 매칭에 재사용 */
  assetCodeById: Map<number, string>;
};

/** firstoa-works assets 테이블 전체(약 23,500행)를 읽어 임대리스트 매핑 필드로 변환합니다. */
export async function readWorksAssetRows(): Promise<WorksAssetsResult> {
  const apiRows = await fetchAllWorksRows<WorksAssetApiRow>('assets', SELECT_COLS);

  const rows: WorksAssetRow[] = [];
  const assetCodeById = new Map<number, string>();

  for (const r of apiRows) {
    const vendorName = str(r.name);
    const assetCode = str(r.asset_code);
    assetCodeById.set(r.id, assetCode);
    if (!vendorName && !assetCode) continue;

    const fields = {
      seq: str(r.classification_number),
      vendorName,
      siteName: str(r.sales_location),
      manager: str(r.contact_person),
      phone: str(r.contact_phone),
      assetCode,
      modelName: str(r.model_name),
      serialNumber: str(r.device_sn),
      contractDate: str(r.contract_date),
      endDate: str(r.end_date),
      status: str(r.rental_status),
      item: str(r.item_category),
      manufacturer: str(r.manufacturer),
      region: str(r.manager),
      province: str(r.province),
      grade: str(r.client_grade),
      contractType: str(r.general_or_site),
      option1: str(r.option1),
      option2: str(r.option2),
      option3: str(r.option3),
      option4: str(r.option4),
      baseAmount: str(r.base_amount),
      firstContractDate: normalizeDate(r.first_contract_date),
      entryDate: normalizeDate(r.entry_date) || normalizeDate(r.input_date_raw),
      removalDate: normalizeDate(r.removal_date),
    };

    rows.push({ sheetRow: r.id, rowHash: hashFields(fields), ...fields });
  }

  return { rows, assetCodeById };
}
