import 'server-only';
import { columnLetter, getSheetsClient, isGoogleServiceAccountConfigured } from '@/lib/googleAuth';

/**
 * 임대리스트(별도 시스템 수준 구글시트, 22,000행+)는 Supabase로 옮기지 않고
 * 원본 구글시트를 그대로 두고 읽기 전용으로 조회합니다. 자산 등록 폼에서
 * 자산번호를 입력하면 이 모듈을 통해 모델명/시리얼을 자동으로 채워줍니다.
 *
 * 준비 방법:
 *   1. Google Cloud Console → 서비스 계정 생성 → JSON 키 다운로드
 *   2. 대상 구글시트를 열어 "공유"에 서비스 계정 이메일을 추가
 *   3. .env.local 에 GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY /
 *      GOOGLE_RENTAL_SHEET_ID / (선택) GOOGLE_RENTAL_SHEET_TAB 채우기
 *
 * 인증 클라이언트는 lib/googleAuth.ts 를 lib/inventory/sheets.ts 와 공유합니다.
 */

const SHEET_ID = process.env.GOOGLE_RENTAL_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_RENTAL_SHEET_TAB || '임대리스트';

export function isRentalSheetConfigured(): boolean {
  return Boolean(SHEET_ID) && isGoogleServiceAccountConfigured();
}

export type RentalLookupResult = {
  assetId: string;
  model: string | null;
  serialNo: string | null;
  /** 사양이 단일 컬럼이 아니라 기종+옵션1~4에 나뉘어 있어, 표시용으로 합쳐서 반환 */
  specHint: string | null;
};

function findHeaderCol(header: string[], mustInclude: string[]): number {
  return header.findIndex((h) => h && mustInclude.some((needle) => h.includes(needle)));
}

type HeaderMap = {
  assetIdCol: number;
  modelCol: number;
  serialCol: number;
  specCols: number[];
};

type IndexCache = {
  header: HeaderMap;
  rowByAssetId: Map<string, number>; // 시트 상의 실제 1-based 행 번호
  builtAt: number;
};

// 자산번호 → 행번호 인덱스는 2만 행 이상을 매 조회마다 다시 읽지 않도록 캐시합니다.
// Vercel 서버리스 환경에서는 인스턴스가 새로 뜨면 캐시도 초기화되지만, 그 정도는
// 감수할 만한 트레이드오프입니다 (콜드스타트 시 1회 추가 API 호출).
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: IndexCache | null = null;

async function buildCache(): Promise<IndexCache> {
  const sheets = getSheetsClient();

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID!,
    range: `${SHEET_TAB}!1:1`,
  });
  const header = (headerRes.data.values?.[0] ?? []).map((v) => String(v ?? ''));

  const assetIdCol = findHeaderCol(header, ['자산번호']);
  const modelCol = findHeaderCol(header, ['모델명']);
  const serialCol = findHeaderCol(header, ['시리얼']);
  const specCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h === '기종' || h.includes('옵션'))
    .map(({ i }) => i);

  if (assetIdCol === -1) {
    throw new Error(`"${SHEET_TAB}" 시트에서 "자산번호" 헤더를 찾지 못했어요.`);
  }

  const idColLetter = columnLetter(assetIdCol);
  const idRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID!,
    range: `${SHEET_TAB}!${idColLetter}2:${idColLetter}`,
  });
  const rowByAssetId = new Map<string, number>();
  (idRes.data.values ?? []).forEach((row, i) => {
    const id = String(row[0] ?? '').trim();
    if (id) rowByAssetId.set(id, i + 2); // 헤더가 1행이므로 데이터는 2행부터 시작
  });

  return { header: { assetIdCol, modelCol, serialCol, specCols }, rowByAssetId, builtAt: Date.now() };
}

async function getCache(): Promise<IndexCache> {
  if (cache && Date.now() - cache.builtAt < CACHE_TTL_MS) return cache;
  cache = await buildCache();
  return cache;
}

/**
 * 자산번호로 임대리스트에서 모델명/시리얼/사양힌트를 찾습니다.
 * 설정이 안 돼 있거나, 조회 중 오류가 나거나, 못 찾으면 null을 반환합니다
 * (자산 등록 폼 입력을 막지 않기 위해 항상 조용히 실패합니다).
 */
export async function lookupRentalByAssetId(assetId: string): Promise<RentalLookupResult | null> {
  const trimmed = assetId.trim();
  if (!trimmed || !isRentalSheetConfigured()) return null;

  try {
    const { header, rowByAssetId } = await getCache();
    const rowNumber = rowByAssetId.get(trimmed);
    if (!rowNumber) return null;

    const sheets = getSheetsClient();
    const rowRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID!,
      range: `${SHEET_TAB}!${rowNumber}:${rowNumber}`,
    });
    const row = rowRes.data.values?.[0] ?? [];

    const model = header.modelCol >= 0 ? String(row[header.modelCol] ?? '').trim() || null : null;
    const serialNo = header.serialCol >= 0 ? String(row[header.serialCol] ?? '').trim() || null : null;
    const specHint =
      header.specCols
        .map((i) => String(row[i] ?? '').trim())
        .filter(Boolean)
        .join(' / ') || null;

    return { assetId: trimmed, model, serialNo, specHint };
  } catch (err) {
    console.error('[rentals] 임대리스트 조회 실패:', err);
    return null;
  }
}
