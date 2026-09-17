import 'server-only';
import { columnLetter, getSheetsClient, isGoogleServiceAccountConfigured } from '@/lib/googleAuth';

/**
 * 임대리스트 구글시트(22,808행, 84컬럼) 전체를 읽어 로컬 Supabase 사본(it_rental_list)에
 * 동기화하는 데 씁니다(/rentals 화면의 "시트 대조/반영"). lib/rentals/server.ts(자산번호 단건
 * 실시간 조회)와는 별개 모듈입니다 — 이쪽은 "전체를 훑어서 로컬에 복사"가 목적입니다.
 *
 * 주의: 이 시트는 헤더가 2행에 있고(1행은 숫자 라벨행), 데이터는 3행부터 시작합니다 —
 * lib/inventory/sheets.ts나 lib/rentals/server.ts가 쓰는 "헤더 1행" 가정과 다릅니다.
 */

const SHEET_ID = process.env.GOOGLE_RENTAL_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_RENTAL_SHEET_TAB || '임대리스트';
const HEADER_ROW = 2;
const DATA_START_ROW = 3;

export function isRentalSheetSyncConfigured(): boolean {
  return Boolean(SHEET_ID) && isGoogleServiceAccountConfigured();
}

export const RENTAL_SHEET_URL = SHEET_ID ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit` : null;

function requireSheetId(): string {
  if (!SHEET_ID) throw new Error('GOOGLE_RENTAL_SHEET_ID 환경변수가 없어요.');
  return SHEET_ID;
}

export type RentalSheetRow = {
  sheetRow: number;
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
};

type HeaderMap = {
  seqCol: number;
  vendorNameCol: number;
  siteNameCol: number;
  managerCol: number;
  phoneCol: number;
  assetCodeCol: number;
  modelNameCol: number;
  serialNumberCol: number;
  contractDateCol: number;
  endDateCol: number;
  statusCol: number;
  itemCol: number;
  manufacturerCol: number;
  regionCol: number;
  provinceCol: number;
  gradeCol: number;
  contractTypeCol: number;
  option1Col: number;
  option2Col: number;
  option3Col: number;
  option4Col: number;
  columnCount: number;
};

// 시트 헤더에 줄바꿈이 섞여 있는 컬럼(예: "옵션1\n(FAX/CPU)")이 있어서, 공백/줄바꿈을 전부
// 지우고 정확히 일치하는지 비교합니다.
function normalizeHeader(text: string): string {
  return text.replace(/\s+/g, '');
}

function findExact(header: string[], text: string): number {
  const target = normalizeHeader(text);
  return header.findIndex((h) => h === target);
}

async function buildHeaderMap(): Promise<HeaderMap> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${SHEET_TAB}!${HEADER_ROW}:${HEADER_ROW}`,
  });
  const header = (res.data.values?.[0] ?? []).map((v) => normalizeHeader(String(v ?? '')));

  const map: HeaderMap = {
    seqCol: findExact(header, '순'),
    vendorNameCol: findExact(header, '거래처명'),
    siteNameCol: findExact(header, '부서명/현장명'),
    managerCol: findExact(header, '키맨'),
    phoneCol: findExact(header, '일반전화'),
    assetCodeCol: findExact(header, '자산번호'),
    modelNameCol: findExact(header, '모델명'),
    serialNumberCol: findExact(header, '시리얼번호(기번)'),
    contractDateCol: findExact(header, '계약일'),
    endDateCol: findExact(header, '종료일'),
    statusCol: findExact(header, '임대여부'),
    itemCol: findExact(header, '품목'),
    manufacturerCol: findExact(header, '제조사'),
    regionCol: findExact(header, '담당지역'),
    provinceCol: findExact(header, '시/도'),
    gradeCol: findExact(header, '등급'),
    contractTypeCol: findExact(header, '일반/현장'),
    option1Col: findExact(header, '옵션1(FAX/CPU)'),
    option2Col: findExact(header, '옵션2(트레이/램/SSD)'),
    option3Col: findExact(header, '옵션3(피니셔/그래픽)'),
    option4Col: findExact(header, '옵션4(솔루션/윈도우)'),
    columnCount: header.length,
  };

  if (map.vendorNameCol === -1 || map.assetCodeCol === -1) {
    throw new Error(`"${SHEET_TAB}" 시트 ${HEADER_ROW}행에서 필수 헤더(거래처명/자산번호)를 못 찾았어요.`);
  }
  return map;
}

function cell(row: unknown[], col: number): string {
  return col >= 0 ? String(row[col] ?? '').trim() : '';
}

/** 매핑된 필드만으로 변경 감지용 해시를 계산합니다(충돌 안전성은 필요 없음 — 대조 속도용). */
function hashFields(fields: Omit<RentalSheetRow, 'sheetRow' | 'rowHash'>): string {
  const str = JSON.stringify(fields);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** 시트 전체(22,808행)를 한 번에 읽어 매핑 필드로 변환합니다. 완전히 빈 행은 건너뜁니다. */
export async function readRentalSheetRows(): Promise<RentalSheetRow[]> {
  const header = await buildHeaderMap();
  const sheets = getSheetsClient();
  const lastCol = columnLetter(Math.max(header.columnCount - 1, 0));
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${SHEET_TAB}!A${DATA_START_ROW}:${lastCol}`,
  });
  const rows = res.data.values ?? [];

  const result: RentalSheetRow[] = [];
  rows.forEach((row, i) => {
    const vendorName = cell(row, header.vendorNameCol);
    const assetCode = cell(row, header.assetCodeCol);
    if (!vendorName && !assetCode) return;

    const fields = {
      seq: cell(row, header.seqCol),
      vendorName,
      siteName: cell(row, header.siteNameCol),
      manager: cell(row, header.managerCol),
      phone: cell(row, header.phoneCol),
      assetCode,
      modelName: cell(row, header.modelNameCol),
      serialNumber: cell(row, header.serialNumberCol),
      contractDate: cell(row, header.contractDateCol),
      endDate: cell(row, header.endDateCol),
      status: cell(row, header.statusCol),
      item: cell(row, header.itemCol),
      manufacturer: cell(row, header.manufacturerCol),
      region: cell(row, header.regionCol),
      province: cell(row, header.provinceCol),
      grade: cell(row, header.gradeCol),
      contractType: cell(row, header.contractTypeCol),
      option1: cell(row, header.option1Col),
      option2: cell(row, header.option2Col),
      option3: cell(row, header.option3Col),
      option4: cell(row, header.option4Col),
    };

    result.push({
      sheetRow: DATA_START_ROW + i,
      rowHash: hashFields(fields),
      ...fields,
    });
  });
  return result;
}
