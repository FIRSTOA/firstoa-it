import 'server-only';
import { columnLetter, getSheetsClient, isGoogleServiceAccountConfigured } from '@/lib/googleAuth';
import { CATEGORIES, type Asset } from '@/lib/types';
import { logAssetMovement } from './movements';
import { parseGubunAndSpec_ } from './specClassification';
import { deriveIsNew, deriveMalicious, parseLocationStatus_ } from './status';

// parseGubunAndSpec_(구분→사양등급 분류)은 원본 대시보드도 이 두 카테고리에만 적용합니다.
const SPEC_CLASSIFIED_CATEGORIES = new Set(['노트북', '데스크탑']);
// "품목" 컬럼이 세부 항목명(나스/마우스 등)으로 실제 쓰이는 건 기타주변기기 시트뿐입니다.
const SUB_ITEM_CATEGORIES = new Set(['기타주변기기']);

/**
 * 데스크탑/노트북/모니터/빔프로젝트/기타주변기기 5개 구글시트를 재고 데이터의
 * 기본 소스로 읽고 씁니다 (lib/dataSource.ts 의 DATA_SOURCE === 'sheets' 일 때).
 * lib/rentals/server.ts 와 동일한 패턴(헤더 텍스트로 컬럼 매칭, 10분 캐시)을 재사용합니다.
 *
 * 준비 방법: lib/rentals/server.ts 와 같은 서비스 계정을 재사용하되, 이제 쓰기도 하므로
 * 시트 공유 권한을 "편집자"로 줘야 합니다. .env.local 에 GOOGLE_INVENTORY_SHEET_ID
 * (비워두면 GOOGLE_RENTAL_SHEET_ID 재사용) / GOOGLE_INVENTORY_SHEET_TAB_* 채우기.
 */

const SHEET_ID = process.env.GOOGLE_INVENTORY_SHEET_ID || process.env.GOOGLE_RENTAL_SHEET_ID;

const CATEGORY_TABS: Record<string, string> = {
  데스크탑: process.env.GOOGLE_INVENTORY_SHEET_TAB_DESKTOP || '데스크탑',
  노트북: process.env.GOOGLE_INVENTORY_SHEET_TAB_NOTEBOOK || '노트북',
  모니터: process.env.GOOGLE_INVENTORY_SHEET_TAB_MONITOR || '모니터',
  빔프로젝트: process.env.GOOGLE_INVENTORY_SHEET_TAB_BEAM || '빔프로젝트',
  기타주변기기: process.env.GOOGLE_INVENTORY_SHEET_TAB_PERIPHERAL || '기타주변기기',
};

export function isInventorySheetConfigured(): boolean {
  return Boolean(SHEET_ID) && isGoogleServiceAccountConfigured();
}

function requireSheetId(): string {
  if (!SHEET_ID) {
    throw new Error('GOOGLE_INVENTORY_SHEET_ID(또는 GOOGLE_RENTAL_SHEET_ID) 환경변수가 없어요.');
  }
  return SHEET_ID;
}

function requireTab(category: string): string {
  const tab = CATEGORY_TABS[category];
  if (!tab) throw new Error(`알 수 없는 품목 카테고리예요: ${category}`);
  return tab;
}

type HeaderMap = {
  assetIdCol: number;
  modelCol: number;
  brandCol: number;
  locationCol: number;
  serialCol: number;
  remarkCol: number;
  cpuCol: number;
  memoryCol: number;
  ssdCol: number;
  hddCol: number;
  screenCol: number;
  gubunCol: number; // "구분" — 사양등급 분류 코드 원문 (예: "I7고사데")
  specCodeCol: number; // "사양(PC라벨)" — "I7/12/32/1024/2/3060" 형식, 세대 추출용
  reserverCol: number; // "예약자"
  reserveDateCol: number; // "예약일"
  // "품목" — 노트북/데스크탑/모니터는 카테고리명 고정값이라 의미 없고, 기타주변기기 시트에서만
  // "나스"/"마우스" 같은 세부 항목명이 들어있어서 그 카테고리에 한해 subItem으로 씁니다.
  itemCol: number;
  columnCount: number;
};

type SheetCache = {
  header: HeaderMap;
  rowByAssetId: Map<string, number>; // 시트 상의 실제 1-based 행 번호
  builtAt: number;
};

function findIncludes(header: string[], needle: string): number {
  return header.findIndex((h) => h.includes(needle));
}

// CPU/SSD/HDD 는 헤더가 짧아서 '사양(PC라벨)\nCPU 세대 RAM SSD HDD VGA' 같은 조합 설명
// 헤더와 혼동될 수 있어 정확히 일치하는 컬럼만 찾습니다.
function findExact(header: string[], text: string): number {
  return header.findIndex((h) => h.trim() === text);
}

// 자산번호 → 행번호 인덱스는 시트 하나당 수백~수천 행을 매 조회마다 다시 읽지 않도록
// 캐시합니다 (lib/rentals/server.ts 와 동일한 10분 TTL 패턴).
const CACHE_TTL_MS = 10 * 60 * 1000;
const cacheByCategory = new Map<string, SheetCache>();

async function buildCache(category: string): Promise<SheetCache> {
  const tab = requireTab(category);
  const sheets = getSheetsClient();

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${tab}!1:1`,
  });
  const header = (headerRes.data.values?.[0] ?? []).map((v) => String(v ?? ''));

  const headerMap: HeaderMap = {
    assetIdCol: findIncludes(header, '자산번호'),
    modelCol: findIncludes(header, '모델명'),
    brandCol: findIncludes(header, '제조사'),
    locationCol: findIncludes(header, '위치'),
    serialCol: findIncludes(header, '시리얼'),
    remarkCol: findIncludes(header, '비고'),
    cpuCol: findExact(header, 'CPU'),
    memoryCol: findIncludes(header, '메모리'),
    ssdCol: findExact(header, 'SSD'),
    hddCol: findExact(header, 'HDD'),
    screenCol: findIncludes(header, '화면크기'),
    gubunCol: findExact(header, '구분'),
    specCodeCol: findIncludes(header, '사양'),
    reserverCol: findIncludes(header, '예약자'),
    reserveDateCol: findIncludes(header, '예약일'),
    itemCol: findExact(header, '품목'),
    columnCount: header.length,
  };

  if (headerMap.assetIdCol === -1) {
    throw new Error(`"${tab}" 시트에서 "자산번호" 헤더를 찾지 못했어요.`);
  }

  const idColLetter = columnLetter(headerMap.assetIdCol);
  const idRes = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${tab}!${idColLetter}2:${idColLetter}`,
  });
  const rowByAssetId = new Map<string, number>();
  (idRes.data.values ?? []).forEach((row, i) => {
    const id = String(row[0] ?? '').trim();
    if (id) rowByAssetId.set(id, i + 2); // 헤더가 1행이므로 데이터는 2행부터 시작
  });

  return { header: headerMap, rowByAssetId, builtAt: Date.now() };
}

async function getCache(category: string): Promise<SheetCache> {
  const cached = cacheByCategory.get(category);
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached;
  const fresh = await buildCache(category);
  cacheByCategory.set(category, fresh);
  return fresh;
}

function cell(row: unknown[], col: number): string {
  return col >= 0 ? String(row[col] ?? '').trim() : '';
}

/** 카테고리 하나의 시트를 전부 읽어 Asset[] 로 변환합니다. */
export async function listAssetsFromSheet(category: string): Promise<Asset[]> {
  const tab = requireTab(category);
  const { header } = await getCache(category);
  const sheets = getSheetsClient();

  const lastCol = columnLetter(Math.max(header.columnCount - 1, 0));
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${tab}!A2:${lastCol}`,
  });
  const rows = res.data.values ?? [];

  const assets: Asset[] = [];
  for (const row of rows) {
    const assetId = cell(row, header.assetIdCol);
    if (!assetId) continue;

    const remark = cell(row, header.remarkCol);
    const location = cell(row, header.locationCol);
    const ssd = cell(row, header.ssdCol);
    const hdd = cell(row, header.hddCol);

    // "사양(PC라벨)"/"사양" B열 — 카테고리별로 형식은 달라도(노트북/데스크탑은 "I5/11/8/256/X/내장"
    // 코드, 모니터는 "삼성 24인치", 기타주변기기는 "4TB * 2" 등) 다 그 시트의 간략 사양이라
    // 카테고리 구분 없이 그대로 읽어서 보여줍니다.
    const specLabel = cell(row, header.specCodeCol);

    let spec = '확인필요';
    let cpuType = '';
    let gubunCode = '';
    if (SPEC_CLASSIFIED_CATEGORIES.has(category)) {
      const gubun = cell(row, header.gubunCol);
      const classified = parseGubunAndSpec_(gubun, specLabel);
      if (!classified.needsReview && classified.tierGroup) spec = classified.tierGroup;
      cpuType = classified.cpuType || '미상';
      gubunCode = gubun;
    }

    const reservedBy = cell(row, header.reserverCol);
    const subItem = SUB_ITEM_CATEGORIES.has(category) ? cell(row, header.itemCol) : '';

    assets.push({
      assetId,
      category,
      brand: cell(row, header.brandCol),
      model: cell(row, header.modelCol),
      cpu: cell(row, header.cpuCol),
      spec,
      specLabel,
      cpuType,
      gubunCode,
      subItem,
      ram: cell(row, header.memoryCol),
      storage: [ssd, hdd].filter(Boolean).join(' / '),
      screen: cell(row, header.screenCol) || '-',
      location,
      status: parseLocationStatus_(location, category, remark).status,
      history: remark,
      isNew: deriveIsNew(remark),
      malicious: deriveMalicious(remark),
      serialNo: cell(row, header.serialCol),
      reservedBy: reservedBy || undefined,
      reservedAt: cell(row, header.reserveDateCol) || undefined,
    });
  }
  return assets;
}

/** 5개 시트를 전부 읽어 하나의 목록으로 합칩니다. 한 시트가 실패해도 나머지는 반환합니다. */
export async function listAllAssets(): Promise<Asset[]> {
  const results = await Promise.all(
    CATEGORIES.map(async (category) => {
      try {
        return await listAssetsFromSheet(category);
      } catch (err) {
        console.error(`[inventory] "${category}" 시트 조회 실패:`, err);
        return [];
      }
    }),
  );
  return results.flat();
}

function buildRowArray(header: HeaderMap, asset: Asset, base?: string[]): string[] {
  const knownCols = [
    header.assetIdCol,
    header.modelCol,
    header.brandCol,
    header.locationCol,
    header.serialCol,
    header.remarkCol,
    header.cpuCol,
    header.memoryCol,
    header.ssdCol,
    header.screenCol,
  ];
  const size = Math.max(header.columnCount, ...knownCols.map((c) => c + 1));
  const row = new Array(size).fill('');
  if (base) base.forEach((v, i) => { if (i < size) row[i] = v; });

  const set = (col: number, value: string) => {
    if (col >= 0) row[col] = value;
  };
  set(header.assetIdCol, asset.assetId);
  set(header.modelCol, asset.model);
  set(header.brandCol, asset.brand);
  set(header.locationCol, asset.location);
  set(header.serialCol, asset.serialNo);
  set(header.remarkCol, asset.history);
  set(header.cpuCol, asset.cpu);
  set(header.memoryCol, asset.ram);
  set(header.ssdCol, asset.storage);
  set(header.screenCol, asset.screen === '-' ? '' : asset.screen);
  return row;
}

function parseRowNumberFromRange(range?: string | null): number | null {
  if (!range) return null;
  const match = range.match(/![A-Za-z]+(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * 대상 카테고리 시트 맨 아래에 새 행을 추가합니다. 이미 있는 자산번호면 에러.
 * movementContext는 카테고리를 바꿔서 수정하는 경우(updateAssetInSheet가 내부적으로 호출) 이전
 * 위치/상태를 넘겨주기 위한 것 — 일반적인 신규 등록에서는 안 넘기면 "신규 등록"으로 기록됩니다.
 */
export async function createAssetInSheet(
  asset: Asset,
  movementContext?: { fromLocation: string | null; fromStatus: string | null },
): Promise<void> {
  const tab = requireTab(asset.category);
  const cache = await getCache(asset.category);
  if (cache.rowByAssetId.has(asset.assetId)) {
    throw new Error('이미 존재하는 자산번호예요.');
  }

  const row = buildRowArray(cache.header, asset);
  const sheets = getSheetsClient();
  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: requireSheetId(),
    range: `${tab}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  const rowNumber = parseRowNumberFromRange(appendRes.data.updates?.updatedRange);
  if (rowNumber) cache.rowByAssetId.set(asset.assetId, rowNumber);

  const toStatus = parseLocationStatus_(asset.location, asset.category, asset.history).status;
  await logAssetMovement({
    assetNumber: asset.assetId,
    category: asset.category,
    fromLocation: movementContext?.fromLocation ?? null,
    toLocation: asset.location || null,
    fromStatus: movementContext?.fromStatus ?? null,
    toStatus,
    memo: movementContext ? '품목 변경(다른 시트로 이동)' : '신규 등록',
  });
}

async function getSheetGid(tab: string): Promise<number> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: requireSheetId(),
    fields: 'sheets.properties',
  });
  const found = meta.data.sheets?.find((s) => s.properties?.title === tab);
  if (!found || found.properties?.sheetId == null) {
    throw new Error(`"${tab}" 시트를 찾지 못했어요.`);
  }
  return found.properties.sheetId;
}

async function deleteRowAt(category: string, rowNumber: number): Promise<void> {
  const tab = requireTab(category);
  const gid = await getSheetGid(tab);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: requireSheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId: gid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
          },
        },
      ],
    },
  });
  // 삭제하면 그 아래 행번호가 전부 밀리므로 해당 시트 캐시는 통째로 무효화합니다.
  cacheByCategory.delete(category);
}

async function findAssetAnywhere(
  assetId: string,
  preferredCategory: string,
): Promise<{ category: string; rowNumber: number } | null> {
  const order = [preferredCategory, ...CATEGORIES.filter((c) => c !== preferredCategory)];
  for (const category of order) {
    const cache = await getCache(category);
    const rowNumber = cache.rowByAssetId.get(assetId);
    if (rowNumber) return { category, rowNumber };
  }
  return null;
}

/**
 * 자산번호가 일치하는 행을 찾아 업데이트합니다. 대상 카테고리 시트에 없으면 나머지
 * 4개 시트도 찾아봅니다 (수정하면서 카테고리를 바꾼 경우). 카테고리가 바뀐 경우,
 * 새 시트에 먼저 추가하고 성공한 뒤에만 원래 시트에서 지웁니다 (중간에 실패해도
 * 자산이 통째로 사라지지 않도록).
 */
export async function updateAssetInSheet(originalAssetId: string, asset: Asset): Promise<void> {
  const found = await findAssetAnywhere(originalAssetId, asset.category);
  if (!found) {
    throw new Error(
      `자산번호 ${originalAssetId}를 ${CATEGORIES.join('/')} 어느 시트에서도 찾지 못했어요.`,
    );
  }

  const foundTab = requireTab(found.category);
  const { header: foundHeader } = await getCache(found.category);
  const sheets = getSheetsClient();
  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${foundTab}!${found.rowNumber}:${found.rowNumber}`,
  });
  const existingRow = (rowRes.data.values?.[0] ?? []).map((v) => String(v ?? ''));
  const oldLocation = cell(existingRow, foundHeader.locationCol);
  const oldRemark = cell(existingRow, foundHeader.remarkCol);
  const oldStatus = parseLocationStatus_(oldLocation, found.category, oldRemark).status;

  if (found.category === asset.category) {
    const newRow = buildRowArray(foundHeader, asset, existingRow);

    await sheets.spreadsheets.values.update({
      spreadsheetId: requireSheetId(),
      range: `${foundTab}!A${found.rowNumber}:${columnLetter(newRow.length - 1)}${found.rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });

    // 위치가 실제로 바뀐 경우만 이동 이력으로 기록합니다 (모델명 등만 고친 편집은 기록 안 함).
    if (oldLocation.trim() !== asset.location.trim()) {
      const newStatus = parseLocationStatus_(asset.location, asset.category, asset.history).status;
      await logAssetMovement({
        assetNumber: asset.assetId,
        category: asset.category,
        fromLocation: oldLocation || null,
        toLocation: asset.location || null,
        fromStatus: oldStatus,
        toStatus: newStatus,
        memo: '위치 수정',
      });
    }
  } else {
    // 카테고리 변경: 새 시트에 먼저 추가 성공한 뒤에만 기존 행을 지웁니다.
    await createAssetInSheet(asset, { fromLocation: oldLocation || null, fromStatus: oldStatus });
    await deleteRowAt(found.category, found.rowNumber);
  }
}

/**
 * 자산번호가 일치하는 행을 찾아 실제로 삭제합니다. category 는 어느 시트부터 찾을지
 * 힌트일 뿐이며, 없거나 틀려도 나머지 4개 시트를 마저 찾아봅니다.
 */
export async function deleteAssetFromSheet(assetId: string, category?: string): Promise<void> {
  const found = await findAssetAnywhere(assetId, category ?? CATEGORIES[0]);
  if (!found) {
    throw new Error(`자산번호 ${assetId}를 ${CATEGORIES.join('/')} 어느 시트에서도 찾지 못했어요.`);
  }

  const tab = requireTab(found.category);
  const { header } = await getCache(found.category);
  const sheets = getSheetsClient();
  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${tab}!${found.rowNumber}:${found.rowNumber}`,
  });
  const existingRow = (rowRes.data.values?.[0] ?? []).map((v) => String(v ?? ''));
  const oldLocation = cell(existingRow, header.locationCol);
  const oldRemark = cell(existingRow, header.remarkCol);
  const oldStatus = parseLocationStatus_(oldLocation, found.category, oldRemark).status;

  await deleteRowAt(found.category, found.rowNumber);

  await logAssetMovement({
    assetNumber: assetId,
    category: found.category,
    fromLocation: oldLocation || null,
    toLocation: null,
    fromStatus: oldStatus,
    toStatus: '삭제됨',
    memo: '앱에서 삭제됨',
  });
}

async function writeReservationCells(
  category: string,
  rowNumber: number,
  header: HeaderMap,
  reserverValue: string,
  reserveDateValue: string,
): Promise<void> {
  const tab = requireTab(category);
  if (header.reserverCol === -1 || header.reserveDateCol === -1) {
    throw new Error(`"${tab}" 시트에서 "예약자"/"예약일" 헤더를 찾지 못했어요.`);
  }
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: requireSheetId(),
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${tab}!${columnLetter(header.reserverCol)}${rowNumber}`, values: [[reserverValue]] },
        { range: `${tab}!${columnLetter(header.reserveDateCol)}${rowNumber}`, values: [[reserveDateValue]] },
      ],
    },
  });
}

/** 자산번호가 일치하는 행의 예약자/예약일 칸에 기록합니다. 다른 컬럼은 건드리지 않습니다. */
export async function reserveAssetInSheet(
  category: string,
  assetId: string,
  reserverName: string,
): Promise<void> {
  const name = reserverName.trim();
  if (!name) throw new Error('예약자 이름을 입력해주세요.');

  const found = await findAssetAnywhere(assetId, category);
  if (!found) {
    throw new Error(`자산번호 ${assetId}를 ${CATEGORIES.join('/')} 어느 시트에서도 찾지 못했어요.`);
  }
  const { header } = await getCache(found.category);
  const today = new Date().toISOString().slice(0, 10);
  await writeReservationCells(found.category, found.rowNumber, header, name, today);
}

/** 예약자/예약일 칸을 비웁니다. */
export async function cancelReservationInSheet(category: string, assetId: string): Promise<void> {
  const found = await findAssetAnywhere(assetId, category);
  if (!found) {
    throw new Error(`자산번호 ${assetId}를 ${CATEGORIES.join('/')} 어느 시트에서도 찾지 못했어요.`);
  }
  const { header } = await getCache(found.category);
  await writeReservationCells(found.category, found.rowNumber, header, '', '');
}
