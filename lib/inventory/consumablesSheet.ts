import 'server-only';
import { columnLetter, getSheetsClient, isGoogleServiceAccountConfigured } from '@/lib/googleAuth';
import type { ConsumableInput, ConsumableItem } from '@/lib/consumables';

/**
 * 소모품 가격표(lib/consumables.ts)의 소스 — 별도 구글시트("소모품구매판매" 탭) 하나.
 * IT재고 5개 탭과 다른 스프레드시트라 SHEET_ID/TAB을 따로 둡니다. 준비 방법은
 * GOOGLE_INVENTORY_SHEET_ID와 동일 — 서비스 계정에 이 시트를 편집자로 공유해야 씁니다.
 */
const SHEET_ID = process.env.GOOGLE_CONSUMABLES_SHEET_ID;
const TAB = process.env.GOOGLE_CONSUMABLES_SHEET_TAB || '소모품구매판매';

export function isConsumablesSheetConfigured(): boolean {
  return Boolean(SHEET_ID) && isGoogleServiceAccountConfigured();
}

function requireSheetId(): string {
  if (!SHEET_ID) throw new Error('GOOGLE_CONSUMABLES_SHEET_ID 환경변수가 없어요.');
  return SHEET_ID;
}

type HeaderMap = {
  gubunCol: number;
  specCol: number;
  vendorCol: number;
  purchasePriceCol: number;
  itemCol: number;
  modelCol: number;
  manufacturerCol: number;
  salePriceCol: number;
  marginCol: number;
  internetPriceCol: number;
  columnCount: number;
};

function findExact(header: string[], text: string): number {
  return header.findIndex((h) => h.trim() === text);
}

function cell(row: string[], col: number): string {
  if (col < 0) return '';
  return (row[col] ?? '').toString().trim();
}

async function readHeader(): Promise<HeaderMap> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!1:1`,
  });
  const header = (res.data.values?.[0] ?? []).map((v) => String(v ?? ''));
  return {
    gubunCol: findExact(header, '구분'),
    specCol: findExact(header, '사양'),
    vendorCol: findExact(header, '매입처'),
    purchasePriceCol: findExact(header, '구매단가'),
    itemCol: findExact(header, '품목'),
    modelCol: findExact(header, '모델명'),
    manufacturerCol: findExact(header, '제조사'),
    salePriceCol: findExact(header, '판매단가'),
    marginCol: findExact(header, '마진'),
    internetPriceCol: findExact(header, '인터넷가격'),
    columnCount: header.length,
  };
}

function mapRowToConsumable(row: string[], header: HeaderMap, rowNumber: number): ConsumableItem {
  return {
    rowNumber,
    gubun: cell(row, header.gubunCol),
    spec: cell(row, header.specCol),
    vendor: cell(row, header.vendorCol),
    purchasePrice: cell(row, header.purchasePriceCol),
    item: cell(row, header.itemCol),
    model: cell(row, header.modelCol),
    manufacturer: cell(row, header.manufacturerCol),
    salePrice: cell(row, header.salePriceCol),
    margin: cell(row, header.marginCol),
    internetPrice: cell(row, header.internetPriceCol),
  };
}

function buildRowArray(header: HeaderMap, input: ConsumableInput): string[] {
  const row = new Array(header.columnCount).fill('');
  if (header.gubunCol >= 0) row[header.gubunCol] = input.gubun;
  if (header.specCol >= 0) row[header.specCol] = input.spec;
  if (header.vendorCol >= 0) row[header.vendorCol] = input.vendor;
  if (header.purchasePriceCol >= 0) row[header.purchasePriceCol] = input.purchasePrice;
  if (header.itemCol >= 0) row[header.itemCol] = input.item;
  if (header.modelCol >= 0) row[header.modelCol] = input.model;
  if (header.manufacturerCol >= 0) row[header.manufacturerCol] = input.manufacturer;
  if (header.salePriceCol >= 0) row[header.salePriceCol] = input.salePrice;
  if (header.marginCol >= 0) row[header.marginCol] = input.margin;
  if (header.internetPriceCol >= 0) row[header.internetPriceCol] = input.internetPrice;
  return row;
}

/** 데이터가 적어서(수십 건) 매번 전체를 다시 읽습니다 — 별도 캐시를 두지 않아요. */
export async function listConsumablesFromSheet(): Promise<ConsumableItem[]> {
  const header = await readHeader();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!A2:Z`,
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row, i) => mapRowToConsumable((row as unknown[]).map((v) => String(v ?? '')), header, i + 2))
    .filter((c) => Object.values(c).some((v, idx) => idx > 0 && String(v).trim() !== ''));
}

/**
 * 시트에서 실제로 데이터가 있는 마지막 행 다음 번호를 계산합니다. A2:Z 전체를 읽어서
 * (listConsumablesFromSheet과 동일한 범위) 반환된 배열 길이로 판단 — 중간에 완전히 빈 행이
 * 있어도 배열엔 빈 행이 그대로 포함되므로(Sheets API가 폭 전체 기준으로 끝을 판단) 정확합니다.
 */
async function getNextRowNumber(): Promise<number> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!A2:Z`,
  });
  return (res.data.values?.length ?? 0) + 2;
}

/**
 * 새 행을 씁니다. values.append(INSERT_ROWS)는 중간에 완전히 빈 행이 있으면 "표의 끝"을
 * 잘못 판단해서 엉뚱한 위치에 행을 끼워넣고 아래 데이터를 밀어버리는 문제가 있어서(실제로
 * 겪었던 사고), 대신 실제 마지막 행 번호를 직접 계산해서 그 다음 행에 values.update로
 * 명시적으로 씁니다 — 이 방식은 행을 밀지 않고 정확히 지정한 칸에만 씁니다.
 */
export async function createConsumableInSheet(input: ConsumableInput): Promise<void> {
  const header = await readHeader();
  const row = buildRowArray(header, input);
  const nextRow = await getNextRowNumber();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!A${nextRow}:${columnLetter(row.length - 1)}${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

export async function updateConsumableInSheet(rowNumber: number, input: ConsumableInput): Promise<void> {
  const header = await readHeader();
  const row = buildRowArray(header, input);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!A${rowNumber}:${columnLetter(row.length - 1)}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

async function getSheetGid(): Promise<number> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: requireSheetId(),
    fields: 'sheets.properties',
  });
  const found = meta.data.sheets?.find((s) => s.properties?.title === TAB);
  if (!found || found.properties?.sheetId == null) {
    throw new Error(`"${TAB}" 시트를 찾지 못했어요.`);
  }
  return found.properties.sheetId;
}

export async function deleteConsumableInSheet(rowNumber: number): Promise<void> {
  await deleteConsumablesInSheet([rowNumber]);
}

/**
 * 여러 행을 한 번에 삭제합니다. 행 번호가 큰 것부터 지워야 합니다 — 낮은 행을 먼저 지우면
 * 그 아래(=큰 번호) 행들이 전부 위로 밀려서 나머지 삭제 대상 번호가 어긋나 버립니다. 배치
 * 안의 요청은 순서대로 적용되므로, 내림차순으로 정렬해서 하나의 batchUpdate로 보냅니다.
 */
export async function deleteConsumablesInSheet(rowNumbers: number[]): Promise<void> {
  if (rowNumbers.length === 0) return;
  const gid = await getSheetGid();
  const sheets = getSheetsClient();
  const sorted = [...rowNumbers].sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: requireSheetId(),
    requestBody: {
      requests: sorted.map((rowNumber) => ({
        deleteDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      })),
    },
  });
}

/**
 * 여러 행을 한 번에 수정합니다. update는 append와 달리 행을 밀지 않고 지정한 칸만 덮어쓰므로,
 * 순서에 상관없이 하나의 batchUpdate(values.batchUpdate, 값 갱신 전용)로 안전하게 보냅니다.
 */
export async function updateConsumablesInSheet(
  updates: { rowNumber: number; input: ConsumableInput }[],
): Promise<void> {
  if (updates.length === 0) return;
  const header = await readHeader();
  const sheets = getSheetsClient();
  const data = updates.map(({ rowNumber, input }) => {
    const row = buildRowArray(header, input);
    return {
      range: `${TAB}!A${rowNumber}:${columnLetter(row.length - 1)}${rowNumber}`,
      values: [row],
    };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: requireSheetId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}
