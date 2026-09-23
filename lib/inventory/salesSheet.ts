import 'server-only';
import { columnLetter, getSheetsClient, isGoogleServiceAccountConfigured } from '@/lib/googleAuth';
import type { SaleEntry } from '@/lib/sales';

/**
 * 판매 리스트(lib/sales.ts, Supabase it_sales_log가 원본)를 "현재 연동된" IT재고 스프레드시트에도
 * 그대로 반영합니다 — 다른 직원이 구글시트에서 바로 볼 수 있게. Supabase가 항상 우선이고 이
 * 시트 반영은 최선노력(실패해도 Supabase 쓰기 자체는 성공 처리 — app/sales/actions.ts에서
 * try/catch로 감쌈). GOOGLE_INVENTORY_SHEET_ID와 실제로 같은 스프레드시트임을 확인함(소모품
 * 가격표에 쓰는 GOOGLE_CONSUMABLES_SHEET_ID와 값이 동일).
 */
const SHEET_ID = process.env.GOOGLE_INVENTORY_SHEET_ID || process.env.GOOGLE_RENTAL_SHEET_ID;
const TAB = process.env.GOOGLE_SALES_SHEET_TAB || '판매리스트';

const HEADER_ROW = ['순번', '모델명', '스펙', '자산번호', '시리얼번호', '구매처', '매입금액', '판매금액', '위치(판매한 곳)', '판매일', '비고'];

export function isSalesSheetConfigured(): boolean {
  return Boolean(SHEET_ID) && isGoogleServiceAccountConfigured();
}

function requireSheetId(): string {
  if (!SHEET_ID) throw new Error('GOOGLE_INVENTORY_SHEET_ID 환경변수가 없어요.');
  return SHEET_ID;
}

type HeaderMap = {
  seqCol: number;
  modelCol: number;
  specCol: number;
  assetIdCol: number;
  serialNumberCol: number;
  vendorCol: number;
  purchasePriceCol: number;
  salePriceCol: number;
  destinationCol: number;
  saleDateCol: number;
  notesCol: number;
  columnCount: number;
};

function findExact(header: string[], text: string): number {
  return header.findIndex((h) => h.trim() === text);
}

/**
 * 탭이 없으면 새로 만듭니다. 이미 있는데 헤더에 없는 컬럼(예: 나중에 추가된 "시리얼번호")이
 * 있으면 헤더 행을 최신 HEADER_ROW로 다시 씁니다 — 이 탭은 앱이 전적으로 관리하는 것이라
 * 사람이 임의로 다른 컬럼을 넣어뒀을 걱정이 없어서, 헤더만 갱신하고 기존 데이터 행은 그대로
 * 둡니다(새 컬럼 칸만 비어있게 됨).
 */
async function ensureTabExists(): Promise<void> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: requireSheetId(), fields: 'sheets.properties' });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: requireSheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
  }

  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: requireSheetId(), range: `${TAB}!1:1` });
  const currentHeader = (headerRes.data.values?.[0] ?? []).map((v) => String(v ?? '').trim());
  const missing = HEADER_ROW.some((label) => !currentHeader.includes(label));
  if (missing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: requireSheetId(),
      range: `${TAB}!A1:${columnLetter(HEADER_ROW.length - 1)}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADER_ROW] },
    });
  }
}

async function readHeader(): Promise<HeaderMap> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: requireSheetId(), range: `${TAB}!1:1` });
  const header = (res.data.values?.[0] ?? []).map((v) => String(v ?? ''));
  return {
    seqCol: findExact(header, '순번'),
    modelCol: findExact(header, '모델명'),
    specCol: findExact(header, '스펙'),
    assetIdCol: findExact(header, '자산번호'),
    serialNumberCol: findExact(header, '시리얼번호'),
    vendorCol: findExact(header, '구매처'),
    purchasePriceCol: findExact(header, '매입금액'),
    salePriceCol: findExact(header, '판매금액'),
    destinationCol: findExact(header, '위치(판매한 곳)'),
    saleDateCol: findExact(header, '판매일'),
    notesCol: findExact(header, '비고'),
    columnCount: header.length,
  };
}

function buildRowArray(header: HeaderMap, entry: SaleEntry): string[] {
  const row = new Array(header.columnCount).fill('');
  if (header.seqCol >= 0) row[header.seqCol] = String(entry.seq);
  if (header.modelCol >= 0) row[header.modelCol] = entry.model;
  if (header.specCol >= 0) row[header.specCol] = entry.spec;
  if (header.assetIdCol >= 0) row[header.assetIdCol] = entry.assetId;
  if (header.serialNumberCol >= 0) row[header.serialNumberCol] = entry.serialNumber;
  if (header.vendorCol >= 0) row[header.vendorCol] = entry.purchaseVendor;
  if (header.purchasePriceCol >= 0) row[header.purchasePriceCol] = entry.purchasePrice;
  if (header.salePriceCol >= 0) row[header.salePriceCol] = entry.salePrice;
  if (header.destinationCol >= 0) row[header.destinationCol] = entry.destination;
  if (header.saleDateCol >= 0) row[header.saleDateCol] = entry.saleDate;
  if (header.notesCol >= 0) row[header.notesCol] = entry.notes;
  return row;
}

/** "순번"(Supabase seq) 값으로 이미 있는 행을 찾습니다. 없으면 null. */
async function findRowBySeq(header: HeaderMap, seq: number): Promise<number | null> {
  if (header.seqCol < 0) return null;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: requireSheetId(), range: `${TAB}!A2:Z` });
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]?.[header.seqCol];
    if (v !== undefined && String(v).trim() === String(seq)) return i + 2;
  }
  return null;
}

/**
 * 시트에서 실제로 데이터가 있는 마지막 행 다음 번호를 계산합니다. values.append(INSERT_ROWS)는
 * 중간에 빈 행이 있으면 표의 끝을 잘못 판단해 엉뚱한 위치에 끼워넣는 문제가 있었어서(소모품
 * 가격표에서 실제로 겪은 사고 — lib/inventory/consumablesSheet.ts 참고), 항상 이 방식(실제
 * 마지막 행을 직접 계산해서 values.update로 명시적으로 씀)을 씁니다.
 */
async function getNextRowNumber(): Promise<number> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: requireSheetId(), range: `${TAB}!A2:Z` });
  return (res.data.values?.length ?? 0) + 2;
}

/** 새로 만들거나(순번이 시트에 없으면) 기존 행을 덮어씁니다(있으면). */
export async function upsertSaleInSheet(entry: SaleEntry): Promise<void> {
  await ensureTabExists();
  const header = await readHeader();
  const row = buildRowArray(header, entry);
  const existingRow = await findRowBySeq(header, entry.seq);
  const targetRow = existingRow ?? (await getNextRowNumber());
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!A${targetRow}:${columnLetter(row.length - 1)}${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

/** 여러 행을 한 번에 반영합니다(붙여넣기 등록용) — 매번 새 행이라 순번 검색 없이 이어서 씁니다. */
export async function appendSalesToSheet(entries: SaleEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await ensureTabExists();
  const header = await readHeader();
  const nextRow = await getNextRowNumber();
  const rows = entries.map((entry) => buildRowArray(header, entry));
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: requireSheetId(),
    range: `${TAB}!A${nextRow}:${columnLetter(rows[0].length - 1)}${nextRow + rows.length - 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

async function getSheetGid(): Promise<number> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: requireSheetId(), fields: 'sheets.properties' });
  const found = meta.data.sheets?.find((s) => s.properties?.title === TAB);
  if (!found || found.properties?.sheetId == null) {
    throw new Error(`"${TAB}" 시트를 찾지 못했어요.`);
  }
  return found.properties.sheetId;
}

/** 순번으로 행을 찾아 삭제합니다. 이미 없으면(=이미 지워짐) 조용히 무시합니다(멱등). */
export async function deleteSaleFromSheet(seq: number): Promise<void> {
  const header = await readHeader();
  const rowNumber = await findRowBySeq(header, seq);
  if (rowNumber === null) return;
  const gid = await getSheetGid();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: requireSheetId(),
    requestBody: {
      requests: [
        { deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } },
      ],
    },
  });
}
