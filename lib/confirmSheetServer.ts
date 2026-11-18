import 'server-only';
import { getSheetsClient } from '@/lib/googleAuth';
import { blockCells, parseConfirmGrid, type ConfirmBlock, type ConfirmDoc } from '@/lib/confirmSheet';

/**
 * 확인서리스트 구글시트 읽기/쓰기 — 영업이 업체별 탭(예: "지니소프1118")으로 만든 확인서를 읽고,
 * IT가 채운 출고시(기재사항) 칸(제조사·자산번호·S/N·[납품사양])만 써넣습니다. 다른 칸은 안 건드려요.
 */
export const CONFIRM_SHEET_ID = process.env.GOOGLE_CONFIRM_SHEET_ID || '1seFubCF5rLa8yH81TYiNEXo4zj_MNHKglrMR-8vvbsA';
export const CONFIRM_SHEET_URL = `https://docs.google.com/spreadsheets/d/${CONFIRM_SHEET_ID}/edit`;

// 확인서가 아닌 목록/템플릿 탭
const SKIP_TABS = new Set(['확인서', 'IT확인서리스트', '출고체크리스트', '복합기확인서리스트', '장비반출확인서', '지우지마시요']);
const RANGE = 'A1:H60';
const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

function isQuota(err: unknown): boolean {
  const e = err as { code?: number; status?: number; message?: string };
  return e?.code === 429 || e?.status === 429 || /quota/i.test(e?.message ?? '');
}
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < 2 && isQuota(err)) {
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

let cache: { at: number; docs: ConfirmDoc[]; sheetIds: Record<string, number> } | null = null;

export function invalidateConfirmCache() {
  cache = null;
}

/** 모든 확인서 탭(30초 캐시) — 탭 목록 1번 + 칸 값 한 번에(batchGet) = 읽기 2회. */
export async function readConfirmDocs(force = false): Promise<ConfirmDoc[]> {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.docs;
  const sheets = getSheetsClient();
  const meta = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId: CONFIRM_SHEET_ID, fields: 'sheets.properties(title,sheetId)' }),
  );
  const props = (meta.data.sheets ?? []).map((s) => s.properties!).filter((p) => p?.title && !SKIP_TABS.has(p.title));
  const tabs = props.map((p) => p.title as string);
  const docs: ConfirmDoc[] = [];
  if (tabs.length) {
    const res = await withRetry(() =>
      sheets.spreadsheets.values.batchGet({ spreadsheetId: CONFIRM_SHEET_ID, ranges: tabs.map((t) => `${q(t)}!${RANGE}`) }),
    );
    (res.data.valueRanges ?? []).forEach((vr, i) => {
      const doc = parseConfirmGrid((vr.values ?? []) as unknown[][], tabs[i]);
      if (doc) docs.push(doc);
    });
  }
  cache = { at: Date.now(), docs, sheetIds: Object.fromEntries(props.map((p) => [p.title as string, p.sheetId ?? 0])) };
  return docs;
}

export async function readConfirmDoc(tab: string): Promise<ConfirmDoc | null> {
  const res = await withRetry(() =>
    getSheetsClient().spreadsheets.values.get({ spreadsheetId: CONFIRM_SHEET_ID, range: `${q(tab)}!${RANGE}` }),
  );
  return parseConfirmGrid((res.data.values ?? []) as unknown[][], tab);
}

/**
 * 출고시(기재사항) 칸만 씁니다. 쓰기 전에 탭을 다시 읽어서 각 묶음의 줄 위치("구 분 … 제조사",
 * 다음 줄 "S/N")가 그대로인지 확인 — 그사이 영업이 줄을 넣거나 지웠으면 엉뚱한 칸에 쓰지 않게.
 * 하드웨어 칸의 요청 부분([납품사양] 앞)은 방금 읽은 시트 값을 그대로 둡니다.
 */
export async function writeConfirmBlocks(tab: string, blocks: ConfirmBlock[]): Promise<void> {
  const sheets = getSheetsClient();
  const res = await withRetry(() => sheets.spreadsheets.values.get({ spreadsheetId: CONFIRM_SHEET_ID, range: `${q(tab)}!${RANGE}` }));
  const grid = ((res.data.values ?? []) as unknown[][]).map((r) => (r ?? []).map((c) => String(c ?? '').trim()));
  const fresh = parseConfirmGrid(grid, tab);
  const data: { range: string; values: string[][] }[] = [];
  for (const b of blocks) {
    const r = b.row - 1;
    if (!/^구\s*분$/.test(grid[r]?.[0] ?? '') || grid[r]?.[4] !== '제조사' || !/^S\s*\/\s*N$/i.test(grid[r + 1]?.[4] ?? '')) {
      throw new Error(`확인서 "${tab}"의 양식(${b.row}행)이 바뀌었어요. 목록을 새로고침한 뒤 다시 열어주세요.`);
    }
    const sheetBlock = fresh?.blocks.find((x) => x.row === b.row);
    const merged: ConfirmBlock = { ...b, requestHardware: sheetBlock ? sheetBlock.requestHardware : b.requestHardware };
    for (const c of blockCells(merged)) {
      data.push({ range: `${q(tab)}!${String.fromCharCode(65 + c.c)}${c.r + 1}`, values: [[c.v]] });
    }
  }
  if (!data.length) return;
  await withRetry(() =>
    sheets.spreadsheets.values.batchUpdate({ spreadsheetId: CONFIRM_SHEET_ID, requestBody: { valueInputOption: 'RAW', data } }),
  );
  invalidateConfirmCache();
}

export type PrintCell = {
  v: string;
  bg?: string;
  bold?: boolean;
  align?: string;
  /** top | middle | bottom (시트 기본은 bottom) */
  valign?: string;
  /** 글자 크기(pt) — 시트 기본 10 */
  size?: number;
  color?: string;
  /** 줄바꿈 안 하는 칸(넘침/자르기) */
  nowrap?: boolean;
};
export type PrintGrid = {
  rows: PrintCell[][];
  merges: { r0: number; r1: number; c0: number; c1: number }[];
  colW: number[];
  rowH: number[];
};

function hex(c?: { red?: number | null; green?: number | null; blue?: number | null } | null): string | undefined {
  if (!c) return undefined;
  const to = (x?: number | null) => Math.round((x ?? 0) * 255).toString(16).padStart(2, '0');
  const h = `#${to(c.red)}${to(c.green)}${to(c.blue)}`;
  return h === '#ffffff' ? undefined : h;
}

/** 인쇄용 — 탭의 칸 값·배경색·굵기·병합·폭을 그대로 가져와 같은 모양으로 그립니다. */
export async function readPrintGrid(tab: string): Promise<PrintGrid> {
  const res = await withRetry(() =>
    getSheetsClient().spreadsheets.get({
      spreadsheetId: CONFIRM_SHEET_ID,
      ranges: [`${q(tab)}!${RANGE}`],
      fields:
        'sheets(merges,data(rowMetadata(pixelSize),columnMetadata(pixelSize),rowData(values(formattedValue,effectiveFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat(bold,fontSize,foregroundColor))))))',
    }),
  );
  const sh = res.data.sheets?.[0];
  const data = sh?.data?.[0];
  const rows: PrintCell[][] = (data?.rowData ?? []).map((rd) =>
    Array.from({ length: 8 }, (_, c) => {
      const v = rd.values?.[c];
      const f = v?.effectiveFormat;
      return {
        v: v?.formattedValue ?? '',
        bg: hex(f?.backgroundColor),
        bold: !!f?.textFormat?.bold,
        align: (f?.horizontalAlignment ?? '').toLowerCase() || undefined,
        valign: (f?.verticalAlignment ?? '').toLowerCase() || undefined,
        size: f?.textFormat?.fontSize ?? undefined,
        nowrap: f?.wrapStrategy === 'OVERFLOW_CELL' || f?.wrapStrategy === 'CLIP' || undefined,
        color: hex(f?.textFormat?.foregroundColor) === '#000000' ? undefined : hex(f?.textFormat?.foregroundColor),
      };
    }),
  );
  let last = rows.length - 1;
  while (last >= 0 && !rows[last].some((c) => c.v.trim())) last--;
  return {
    rows: rows.slice(0, last + 1),
    merges: (sh?.merges ?? [])
      .filter((m) => (m.startRowIndex ?? 0) <= last && (m.startColumnIndex ?? 0) < 8)
      .map((m) => ({ r0: m.startRowIndex ?? 0, r1: Math.min(m.endRowIndex ?? 0, last + 1), c0: m.startColumnIndex ?? 0, c1: Math.min(m.endColumnIndex ?? 0, 8) })),
    colW: (data?.columnMetadata ?? []).slice(0, 8).map((c) => c.pixelSize ?? 100),
    rowH: (data?.rowMetadata ?? []).slice(0, last + 1).map((r) => r.pixelSize ?? 21),
  };
}
