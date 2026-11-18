/**
 * 확인서(확인서리스트 구글시트의 업체별 탭, 예: "지니소프1118") — 순수 타입/파서(클라이언트·서버 공용).
 *
 * 영업이 "작성시(요청사항)"에 품목·수량을 적어 주면, IT가 "출고시(기재사항)"에 실제로 나가는
 * 장비를 적습니다. 한 품목 묶음(블록)은 6줄이고, 칸 위치는 이렇습니다(r = "구 분" 줄):
 *   F{r} 제조사 · H{r} 자산번호(여러 대면 줄바꿈) · F{r+1} S/N(줄바꿈) ·
 *   F{r+2} 하드웨어 = 영업이 적은 요청 사양 + "\n[납품사양]\n" + 우리가 내보낸 사양
 */

export type ConfirmUnit = {
  assetId: string;
  serial: string;
  /** IT재고 간략 사양(예: I7/14/64/512/2/5050, 모니터는 "삼성 24인치") */
  spec?: string;
  brand?: string;
  model?: string;
  gubun?: string;
  category?: string;
};

export type ConfirmBlock = {
  /** 시트 행 번호(1부터) — "구 분 | 품목 | 수량 | 제조사" 줄 */
  row: number;
  item: string;
  quantity: number;
  request: string;
  /** 하드웨어 칸의 영업 요청 부분([납품사양] 앞) */
  requestHardware: string;
  manufacturer: string;
  units: ConfirmUnit[];
  /** 하드웨어 칸의 [납품사양] 뒤 — 우리가 내보낸 사양 */
  deliverySpec: string;
};

export type ConfirmDoc = {
  /** 시트 탭 이름(붙여넣기로만 불러온 문서는 '') */
  tab: string;
  title: string;
  formNo: string;
  company: string;
  orderDate: string;
  /** YYYY-MM-DD (못 읽으면 '') */
  deliveryDate: string;
  deliveryDateText: string;
  department: string;
  salesManager: string;
  address: string;
  consumables: string;
  prices: { item: string; amount: string; qty: string }[];
  blocks: ConfirmBlock[];
  /** 원본 칸 값(A~H) — 인쇄용 */
  grid: string[][];
};

export const DELIVERY_SPEC_MARK = '[납품사양]';

const cell = (g: string[][], r: number, c: number) => String(g[r]?.[c] ?? '').trim();
const findRow = (g: string[][], col: number, re: RegExp, from = 0) => {
  for (let i = from; i < g.length; i++) if (re.test(cell(g, i, col))) return i;
  return -1;
};
export const splitLines = (s: string) =>
  s
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

export function splitHardware(text: string): [string, string] {
  const i = text.indexOf(DELIVERY_SPEC_MARK);
  if (i < 0) return [text.trim(), ''];
  return [text.slice(0, i).trim(), text.slice(i + DELIVERY_SPEC_MARK.length).trim()];
}

export function buildHardwareCell(requestHardware: string, deliverySpec: string): string {
  const req = requestHardware.trim();
  const del = deliverySpec.trim();
  if (!del) return req;
  // 시트에 손으로 적던 방식 그대로: "요청 사양\n[납품사양]\n 내보낸 사양"(앞 공백 한 칸)
  return [req, DELIVERY_SPEC_MARK, ` ${del}`].filter(Boolean).join('\n');
}

/** "2026년 11월 18일 수요일" / "2026-11-18" → "2026-11-18". 못 읽으면 탭 이름 끝 MMDD로. */
export function parseKoreanDate(text: string, tab = ''): string {
  const m = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const t = tab.match(/(\d{2})(\d{2})(?:_\d+)?$/);
  if (t) {
    const now = new Date(Date.now() + 9 * 3600_000);
    let y = now.getUTCFullYear();
    const mm = Number(t[1]);
    if (mm - (now.getUTCMonth() + 1) > 6) y -= 1;
    if (now.getUTCMonth() + 1 - mm > 6) y += 1;
    return `${y}-${t[1]}-${t[2]}`;
  }
  return '';
}

/** 시트 탭(또는 시트에서 복사해 붙여넣은 표)의 칸 값 → 확인서. 양식이 아니면 null. */
export function parseConfirmGrid(grid: unknown[][], tab = ''): ConfirmDoc | null {
  const g = grid.map((r) => (r ?? []).map((c) => String(c ?? '')));
  const titleRow = findRow(g, 0, /^제\s*목$/);
  const startRow = findRow(g, 0, /작성시/);
  if (startRow < 0) return null;

  let formNo = '';
  for (let i = 0; i < Math.min(g.length, 8); i++) {
    if (cell(g, i, 7) === '순번') {
      formNo = cell(g, i + 1, 7);
      break;
    }
  }
  const orderRow = findRow(g, 0, /^발주일$/);
  const companyRow = findRow(g, 0, /^상\s*호$/);
  const inflowRow = findRow(g, 0, /^유입구분$/);
  const addressRow = findRow(g, 0, /^사업장주소$/);
  const consumablesRow = findRow(g, 0, /^소모품$/);
  const priceHead = g.findIndex((_, i) => cell(g, i, 1) === '품목' && cell(g, i, 2) === '금액');
  const prices: ConfirmDoc['prices'] = [];
  if (priceHead >= 0) {
    for (let i = priceHead + 1; i < (consumablesRow > 0 ? consumablesRow : priceHead + 6); i++) {
      if (cell(g, i, 1)) prices.push({ item: cell(g, i, 1), amount: cell(g, i, 2), qty: cell(g, i, 3) });
    }
  }

  const blocks: ConfirmBlock[] = [];
  for (let i = startRow + 1; i < g.length; i++) {
    if (!/^구\s*분$/.test(cell(g, i, 0)) || cell(g, i, 4) !== '제조사') continue;
    const assets = splitLines(cell(g, i, 7));
    const serials = splitLines(cell(g, i + 1, 5));
    const item = cell(g, i + 1, 1);
    const quantity = parseInt(cell(g, i + 1, 3), 10) || 0;
    const manufacturer = cell(g, i, 5);
    const [requestHardware, deliverySpec] = splitHardware(cell(g, i + 2, 5));
    if (!item && !assets.length && !manufacturer) continue; // 비어 있는 묶음
    const n = Math.max(quantity, assets.length, serials.length);
    blocks.push({
      row: i + 1,
      item,
      quantity,
      request: cell(g, i + 2, 1),
      requestHardware,
      manufacturer,
      units: Array.from({ length: n }, (_, k) => ({ assetId: assets[k] ?? '', serial: serials[k] ?? '' })),
      deliverySpec,
    });
  }

  const title = titleRow >= 0 ? cell(g, titleRow, 1) : '';
  const company = companyRow >= 0 ? cell(g, companyRow, 1) : '';
  if (!title && !company && !blocks.length) return null;
  const deliveryDateText = orderRow >= 0 ? cell(g, orderRow, 5) : '';
  return {
    tab,
    title,
    formNo,
    company,
    orderDate: orderRow >= 0 ? cell(g, orderRow, 1) : '',
    deliveryDate: parseKoreanDate(deliveryDateText, tab),
    deliveryDateText,
    department: companyRow >= 0 ? cell(g, companyRow, 5) : '',
    salesManager: inflowRow >= 0 ? cell(g, inflowRow, 5) : '',
    address: addressRow >= 0 ? cell(g, addressRow, 1) : '',
    consumables: consumablesRow >= 0 ? cell(g, consumablesRow, 1) : '',
    prices,
    blocks,
    grid: trimGrid(g),
  };
}

function trimGrid(g: string[][]): string[][] {
  let last = g.length - 1;
  while (last >= 0 && !(g[last] ?? []).some((c) => c.trim())) last--;
  return g.slice(0, last + 1).map((r) => r.slice(0, 8));
}

/** 시트에서 복사한 표(TSV — 줄바꿈 있는 칸은 "..."로 감쌈)를 칸 배열로. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
      continue;
    }
    if (ch === '"' && cur === '') quoted = true;
    else if (ch === '\t') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const IT_TOKEN = /(^|[^A-Za-z])IT([^A-Za-z]|$)/;
const IT_WORDS = /(모니터|노트북|데스크탑|데스크톱|nas|나스|맥북|갤럭시북)/i;
export function isItConfirm(doc: Pick<ConfirmDoc, 'title' | 'blocks'>): boolean {
  return IT_TOKEN.test(doc.title) || IT_WORDS.test(doc.title) || doc.blocks.some((b) => IT_WORDS.test(b.item));
}

/** 제목 비교용 — 담당자 태그·시간 문구 등 앞부분을 떼고 "IT/…"부터, 공백·★ 제거. */
export function titleBody(title: string): string {
  const m = title.match(/(^|[^A-Za-z])(IT\/.*)$/);
  return (m ? m[2] : title).replace(/[\s★☆]/g, '').toLowerCase();
}

export function guessCategory(text: string): string {
  if (/노트북|사노|설노|맥북|갤럭시북|그램/.test(text)) return '노트북';
  if (/데스크|사데|설데/.test(text)) return '데스크탑';
  if (/모니터/.test(text)) return '모니터';
  if (/빔|프로젝터/.test(text)) return '빔프로젝트';
  return '';
}

/** 출고 준비 완료 보고의 기기들을 확인서 품목 묶음에 나눠 담기(품목 종류 → 남는 자리 순). */
export function allocateUnits(blocks: Pick<ConfirmBlock, 'item' | 'request' | 'quantity'>[], units: ConfirmUnit[]): ConfirmUnit[][] {
  const caps = blocks.map((b) => Math.max(b.quantity, 1));
  const cats = blocks.map((b) => guessCategory(`${b.item} ${b.request}`));
  const out = blocks.map(() => [] as ConfirmUnit[]);
  const rest: ConfirmUnit[] = [];
  for (const u of units) {
    const c = u.category || guessCategory(`${u.gubun ?? ''} ${u.model ?? ''}`);
    const i = cats.findIndex((bc, k) => bc && bc === c && out[k].length < caps[k]);
    if (i >= 0) out[i].push(u);
    else rest.push(u);
  }
  for (const u of rest) {
    let i = out.findIndex((o, k) => o.length < caps[k]);
    if (i < 0) i = out.length - 1;
    if (i >= 0) out[i].push(u);
  }
  return out;
}

export function deliverySpecFromUnits(units: ConfirmUnit[]): string {
  return [...new Set(units.map((u) => (u.spec ?? '').trim()).filter(Boolean))].join('\n');
}

export function filledCount(doc: Pick<ConfirmDoc, 'blocks'>): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  for (const b of doc.blocks) {
    total += Math.max(b.quantity, b.units.length);
    filled += b.units.filter((u) => u.assetId.trim()).length;
  }
  return { filled, total };
}

/** 시트/인쇄에 쓸 출고시(기재사항) 칸 값 — 행·열(0부터)별. */
export function blockCells(b: ConfirmBlock): { r: number; c: number; v: string }[] {
  const r = b.row - 1;
  const ids = b.units.map((u) => u.assetId.trim()).filter(Boolean);
  const serials = b.units.map((u) => u.serial.trim()).filter(Boolean);
  return [
    { r, c: 5, v: b.manufacturer.trim() },
    { r, c: 7, v: ids.join('\n') },
    { r: r + 1, c: 5, v: serials.join('\n') },
    { r: r + 2, c: 5, v: buildHardwareCell(b.requestHardware, b.deliverySpec) },
  ];
}
