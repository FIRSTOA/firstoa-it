import { CATEGORIES, SPECS, STATUSES, type Asset } from './types';

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

/**
 * 컬럼별 작성 방법 설명 — 템플릿 파일의 "작성법" 시트에 그대로 들어갑니다.
 * 나중에 데이터 소스를 다른 시스템(예: Supabase)으로 전환할 때 이 형식 그대로 일괄
 * 업로드에 쓸 수 있도록, 지금부터 데이터를 이 형식으로 준비해둘 수 있게 하는 용도입니다.
 */
export const EXCEL_COLUMN_GUIDE: { column: string; required: boolean; description: string }[] = [
  { column: '자산번호', required: true, description: '필수. 기존 자산번호 체계(P/X/A 등 접두어) 그대로 사용하세요. 예: P2400' },
  { column: '품목', required: true, description: `필수. 다음 중 하나만: ${CATEGORIES.join(' / ')}` },
  { column: '브랜드', required: false, description: '자유 텍스트. 예: 삼성, HP, LG' },
  { column: '모델명', required: true, description: '필수. 자유 텍스트.' },
  { column: 'CPU종류', required: false, description: '자유 텍스트. 예: i5-1135G7 (비워두면 "미상")' },
  { column: '사양분류', required: false, description: `다음 중 하나: ${SPECS.join(' / ')} (비워두면 "사무용")` },
  { column: 'RAM(GB)', required: false, description: '자유 텍스트. 예: 8, 16' },
  { column: '저장용량(GB)', required: false, description: '자유 텍스트. 예: 256, 512' },
  { column: '화면크기', required: false, description: '자유 텍스트. 예: 15.6인치 (비워두면 "-")' },
  { column: '위치', required: false, description: '자유 텍스트. 예: J1, 거래처명' },
  { column: '상태', required: false, description: `다음 중 하나: ${STATUSES.join(' / ')} (비워두면 "${STATUSES[0]}")` },
  { column: '이력', required: false, description: '자유 텍스트.' },
  { column: '새기기', required: false, description: 'Y 또는 N (비워두면 N)' },
  { column: '악성', required: false, description: 'Y 또는 N (비워두면 N)' },
  { column: '시리얼번호', required: false, description: '자유 텍스트.' },
];

/** 품목별로 하나씩, 올바른 형식을 보여주는 예시 행. 실제 자산과 안 헷갈리게 자산번호에 "예시-"를 붙입니다. */
export function buildTemplateExampleRows(): ExcelRow[] {
  const rows: [string, string, string, string, string, string, string, string, string, string, string, string][] = [
    ['예시-노트북01', '노트북', 'HP', 'EliteBook 840 G7', 'i5-1135G7', '사무용', '8', '256', '14인치', 'J1', '상품화완료', ''],
    ['예시-데스크탑01', '데스크탑', '삼성', 'DM500S8L', 'i5-10400', '사무용', '8', '256', '-', 'B1', '상품화준비중', ''],
    ['예시-모니터01', '모니터', 'LG', '27UL500', '미상', '확인필요', '-', '-', '27인치', 'B2', '임대중', ''],
    ['예시-빔프로젝트01', '빔프로젝트', 'Optoma', 'HD146X', '미상', '확인필요', '-', '-', '-', '창고', '상품화준비중', ''],
    ['예시-기타주변기기01', '기타주변기기', 'HP', '무선마우스 M240', '미상', '확인필요', '-', '-', '-', '창고', '기타', ''],
  ];
  return rows.map(([assetId, category, brand, model, cpu, spec, ram, storage, screen, location, status, history]) => ({
    자산번호: assetId,
    품목: category,
    브랜드: brand,
    모델명: model,
    CPU종류: cpu,
    사양분류: spec,
    'RAM(GB)': ram,
    '저장용량(GB)': storage,
    화면크기: screen,
    위치: location,
    상태: status,
    이력: history,
    새기기: 'N',
    악성: 'N',
    시리얼번호: '',
  }));
}

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
      subItem: '',
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
