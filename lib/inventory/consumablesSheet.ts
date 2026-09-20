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

export async function createConsumableInSheet(input: ConsumableInput): Promise<void> {
  const header = await readHeader();
  const row = buildRowArray(header, input);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
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
  const gid = await getSheetGid();
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
}
