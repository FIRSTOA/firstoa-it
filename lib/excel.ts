import { CATEGORIES, STATUSES, type Asset } from './types';

/** 엑셀 다운로드/업로드가 공유하는 컬럼 순서. 다운로드한 파일을 그대로 업로드용 템플릿으로 쓸 수 있습니다. */
export const EXCEL_HEADERS = [
  '자산번호',
  '품목',
  '브랜드',
  '모델명',
  'CPU종류',
  '사양분류',
  'RAM(GB)',
  '저장용량(GB)',
  '화면크기',
  '위치',
  '상태',
  '이력',
  '새기기',
  '악성',
  '시리얼번호',
] as const;

type ExcelRow = Record<(typeof EXCEL_HEADERS)[number], string>;

export function assetToExcelRow(asset: Asset): ExcelRow {
  return {
    자산번호: asset.assetId,
    품목: asset.category,
    브랜드: asset.brand,
    모델명: asset.model,
    CPU종류: asset.cpu,
    사양분류: asset.spec,
    'RAM(GB)': asset.ram,
    '저장용량(GB)': asset.storage,
    화면크기: asset.screen,
    위치: asset.location,
    상태: asset.status,
    이력: asset.history,
    새기기: asset.isNew ? 'Y' : 'N',
    악성: asset.malicious ? 'Y' : 'N',
    시리얼번호: asset.serialNo,
  };
}

function truthy(value: unknown): boolean {
  const v = String(value ?? '').trim().toUpperCase();
  return v === 'Y' || v === 'YES' || v === 'TRUE' || v === '1' || v === '예';
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

export type ParsedExcelResult = {
  valid: Asset[];
  errors: { rowNumber: number; reason: string }[];
};

/**
 * 엑셀 시트를 읽어 만든 원시 행 배열을 검증하고 Asset[] 로 변환합니다.
 * DB 제약조건이 있는 품목/상태만 값 검사하고, 나머지는 자유 텍스트로 받습니다.
 */
export function parseExcelRows(rows: Record<string, unknown>[]): ParsedExcelResult {
  const valid: Asset[] = [];
  const errors: ParsedExcelResult['errors'] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // 1행은 헤더
    const assetId = cell(row, '자산번호');
    const model = cell(row, '모델명');
    if (!assetId) {
      errors.push({ rowNumber, reason: '자산번호 없음' });
      return;
    }
    if (!model) {
      errors.push({ rowNumber, reason: '모델명 없음' });
      return;
    }

    const category = cell(row, '품목') || CATEGORIES[0];
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      errors.push({ rowNumber, reason: `품목 값이 올바르지 않음: ${category}` });
      return;
    }

    const status = cell(row, '상태') || STATUSES[0];
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
      errors.push({ rowNumber, reason: `상태 값이 올바르지 않음: ${status}` });
      return;
    }

    valid.push({
      assetId,
      category,
      brand: cell(row, '브랜드'),
      model,
      cpu: cell(row, 'CPU종류') || '미상',
      spec: cell(row, '사양분류') || '사무용',
      specLabel: '',
      cpuType: '',
      gubunCode: '',
      ram: cell(row, 'RAM(GB)'),
      storage: cell(row, '저장용량(GB)'),
      screen: cell(row, '화면크기') || '-',
      location: cell(row, '위치'),
      status,
      history: cell(row, '이력'),
      isNew: truthy(row['새기기']),
      malicious: truthy(row['악성']),
      serialNo: cell(row, '시리얼번호'),
    });
  });

  return { valid, errors };
}
