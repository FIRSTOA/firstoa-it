/**
 * 영업 확인서 출력 — 영업 양식 사본(salesForm/confirmDoc.ts)에 IT 값을 채운 HTML 한 장 (순수 함수 — 화면에서 바로 부름, 서버 안 부름).
 * 설계 docs/tasks/2026-11-26-sales-confirm-import.md §3-9 (D15~D18·D21~D25·D30). import 는 types·itemKind·specCompare·salesForm/* 만.
 *
 * buildSalesPrintHtml(input) → { html, notes, blocked, attached }
 *   채우는 규칙(§3-9, 품목 줄마다):
 *   1 지역: 영업 값, 비었으면 regionOf(주소) — 종이엔 그냥 채움, 알림에 "(추정)". 모르면 빈칸.
 *   2 회색 줄: 출고 모델 줄(영업 제조사·모델명과 다를 때 S/N 칸 첫 줄 "출고 ○○", 기기끼리 다르면 "모델 기기별 — 명세 참조")
 *     + 자산번호(한 줄 3개)·S/N(한 줄 2개, 13자 넘으면 1개, 소프트웨어 키는 1개), 칸마다 2줄(출고 모델 줄이 있으면 S/N 1줄).
 *     넘거나 넘침 신호가 온 품목 → 두 칸 모두 "출고 명세 참조 (n대)" + 출고 명세 장. 안 적은 대수는 밑줄 빈칸.
 *     그 품목에 자산번호·S/N 을 하나도 안 적었으면 회색 칸은 영업 양식 그대로(비워서 손으로). 기타 종류는 적은 기기만.
 *   3 사양 줄(장비 + hasSpec): 칸마다 출고 값 없거나 같으면 영업 값, 다르면 "요청 → 출고", 영업 빈칸이면 출고 값만, 기기끼리 다르면 "→ 기기별".
 *   4 출고 명세 장 = 옵션 '항상' 또는 2·3에서 명세 참조/기기별이 하나라도(넘침 신호 포함).
 *   5 품목구분·기기상태·수량·렌탈료·설치장소·특이사항·소모품·연락처·문구·확인란 = 영업 값 그대로.
 *   6 확인서 종류 = print.kind 가 'mfp' 면 'mfp'(복합기 갈래 — IT 칸 안 채움), 아니면 'it'.
 *   7 차이 확인 여부는 종이에 표시 안 함.
 *   + 영업 모델명·제조사 칸이 비었으면 그 칸에 출고 값(빈칸 채움 — 기기끼리 다르면 "기기별(명세)").
 *   + 돈·계약서 칸이 안 왔으면(null) ₩0·자동 체크 대신 빈칸(P2), '' 로 왔으면 영업 출력과 같게.
 *   + 교체·유지보수 확인서 → blocked(영업 최신 양식 받기 전 — D24).
 *
 * 출력 창(components/salesConfirms/SalesPrintDialog.tsx)과의 신호(P6) — 이름은 그 파일 SALES_PRINT_MSG 와 같음.
 *   iframe 은 sandbox="allow-scripts allow-modals"(allow-same-origin 넣지 말 것).
 *   인쇄: iframe.contentWindow.postMessage({ source:'sales-confirm', type:'sales-confirm:print' }, '*')  ← sandbox 문서 출처는 'null' 이라 '*'
 *   넘침: 그린 뒤 넘친 장이 있을 때만 { source, type:'sales-confirm:overflow', items:[품목 순서], pages:[넘친 장] }
 *         받는 쪽은 e.source === iframe.contentWindow 인 것만 → items 를 input.overflowItems 에 더해 다시 build(늘지 않으면 그만 —
 *         되풀이 없음). 더해도 pages 가 남으면 overflowLeftNote(pages) 를 알림에 더할 수 있음(소모품·특이사항이 길어 넘친 경우).
 *         items 는 1면·별지 품목 번호 칸(td.n)의 글자에서 읽음 — 원래 칸이라 data 속성을 따로 달지 않음(fill 없는 HTML 을 원본과 같게).
 *   높이: { source, type:'sales-confirm:size', height } — 미리보기 높이 맞춤용.
 * 라이선스 키(D30): input.licenseKeys 는 출력 창 메모리에만 — 이 함수는 어디에도 저장·기록하지 않음.
 */
import {
  IT_PRINT_MSG_OVERFLOW,
  IT_PRINT_MSG_PRINT,
  IT_PRINT_MSG_SIZE,
  IT_PRINT_MSG_SOURCE,
  renderConfirm,
  type ConfirmFill,
  type FillAttachRow,
  type FillItem,
  type FillSpecCell,
  type FillVal,
} from './salesForm/confirmDoc';
import { hasSpec, regionOf, specKeys, type ConfDoc, type ConfItem, type ConfSupply } from './salesForm/confirm';
import { ITEM_KIND_RULES, type ItemKind } from './itemKind';
import { diffsFor, sameSpecValue } from './specCompare';
import type {
  DiffField,
  NormalizedSalesConfirm,
  SalesConfirmItem,
  SalesPrintExtra,
  SalesPrintInput,
  SalesPrintNote,
  SalesPrintResult,
  SalesSlot,
  SalesSpec,
} from './types';

/** 미리보기 신호 이름(양식 안 P6 스크립트와 같음) — components/salesConfirms/SalesPrintDialog.tsx 의 SALES_PRINT_MSG 와 같은 값 */
export const SALES_PRINT_MSG_SOURCE = IT_PRINT_MSG_SOURCE;
export const SALES_PRINT_MSG_PRINT = IT_PRINT_MSG_PRINT;
export const SALES_PRINT_MSG_OVERFLOW = IT_PRINT_MSG_OVERFLOW;
export const SALES_PRINT_MSG_SIZE = IT_PRINT_MSG_SIZE;

/** 회색 칸 한도(D22) — 자산번호 한 줄 3개, S/N 한 줄 2개(이 길이 넘으면 1개), 칸마다 2줄 */
const ASSET_PER_LINE = 3;
const SN_PER_LINE = 2;
const SN_LONG = 13;
const CELL_LINES = 2;

const NONE_PRINT: SalesPrintExtra = {
  kind: null,
  months: null,
  deposit: null,
  payNote: null,
  extra: null,
  orderDate: null,
  industry: null,
  statusNo: null,
  fax: null,
  taxMail: null,
  contractMail: null,
};

/** 영업이 안 보내 주는 칸 이름(알림용) — kind 는 안 옴이면 'it' 로 보므로 뺌 */
const NOT_SENT_LABELS: [keyof SalesPrintExtra, string][] = [
  ['months', '계약기간'],
  ['deposit', '보증금'],
  ['payNote', '결제특이'],
  ['extra', '추가조건·혜택'],
  ['orderDate', '발주일'],
  ['industry', '업종'],
  ['statusNo', '현황표 순'],
  ['fax', '팩스'],
  ['taxMail', '계산서메일'],
  ['contractMail', '계약서메일(계약서 종류)'],
];

// ───────── 넘침 신호(P6ⓑ) 받는 쪽 도우미 ─────────

/** 명세로 돌려도 넘침이 남았을 때(넘침 신호의 items 가 더 늘지 않는데 pages 가 있음) 출력 창 알림 — 소모품·특이사항이 길어서 등 */
export function overflowLeftNote(pages: readonly number[]): SalesPrintNote | null {
  if (!pages.length) return null;
  return {
    tone: 'warn',
    text: `${pages.join('·')}쪽 아래가 종이 밖으로 넘쳐요 — 확인란·서명 칸이 잘릴 수 있어요. 인쇄 미리보기에서 꼭 확인해 주세요(소모품·특이사항이 길면 생겨요)`,
  };
}

// ───────── 작은 도우미 ─────────

const tr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function same(field: DiffField, a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return sameSpecValue(field, a, b);
}

/** 서로 다른 값만(같음 판정은 specCompare — 영업 요청과 비교하는 기준과 같음) */
function distinct(field: DiffField, vals: string[]): string[] {
  const out: string[] = [];
  for (const v of vals) if (!out.some((o) => same(field, o, v))) out.push(v);
  return out;
}

/** 한국 시각 조각 */
function kst(iso: string | null | undefined): { ymd: string; md: string; hm: string } | null {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return null;
  const s = new Date(ms + 9 * 3600_000).toISOString();
  return { ymd: s.slice(0, 10), md: s.slice(5, 10), hm: s.slice(11, 16) };
}

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** S/N 줄 나누기 — 한 줄 perLine 개, 긴 값은 한 줄 통째로. 순서 그대로(빈칸 자리도 그대로) */
function packSerials(vals: FillVal[], perLine: number): FillVal[][] {
  const lines: FillVal[][] = [];
  let cur: FillVal[] = [];
  for (const v of vals) {
    if (v !== null && v.length > SN_LONG) {
      if (cur.length) lines.push(cur);
      cur = [];
      lines.push([v]);
      continue;
    }
    cur.push(v);
    if (cur.length >= perLine) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * 칸 하나(제조사·모델명·사양 칸)의 종이 모양.
 *   sales  = 영업 값 그대로(출고 값 없음 또는 같음) · fill = 영업 빈칸 → 출고 값
 *   diff   = 영업 값과 다르고 기기 모두 같은 값 · mixed = 기기끼리 다름(안 적은 기기는 영업 값으로 봄) → 명세
 */
type FieldPlan = { mode: 'sales' } | { mode: 'fill'; out: string } | { mode: 'diff'; out: string } | { mode: 'mixed' };

function planField(field: DiffField, sales: string, actuals: string[]): FieldPlan {
  const entered = actuals.filter(Boolean);
  if (!entered.length) return { mode: 'sales' };
  if (!sales) {
    const d = distinct(field, entered);
    return d.length === 1 ? { mode: 'fill', out: d[0] } : { mode: 'mixed' };
  }
  const eff = actuals.map((a) => (a && !same(field, sales, a) ? a : sales));
  const d = distinct(field, eff);
  if (d.length > 1) return { mode: 'mixed' };
  return same(field, sales, d[0]) ? { mode: 'sales' } : { mode: 'diff', out: d[0] };
}

type UnitView = {
  unitNo: number;
  asset: string;
  serial: string;
  maker: string;
  model: string;
  spec: SalesSpec;
  pc: string;
  key: string;
};

function viewOf(slot: SalesSlot, keysShown: boolean, keys: Record<string, string>): UnitView {
  const u = slot.unit;
  return {
    unitNo: slot.unitNo,
    asset: tr(u?.assetId),
    serial: tr(u?.serial),
    maker: tr(u?.actualMaker),
    model: tr(u?.actualModel),
    spec: (u?.specOverride ?? {}) as SalesSpec,
    pc: tr(u?.extra?.pc),
    key: u && keysShown ? tr(keys[u.id]) : '',
  };
}

const specOf = (s: SalesSpec, k: string): string => tr((s as Record<string, unknown>)[k]);

// ───────── 품목 줄 하나 ─────────

interface ItemPlan {
  fill: FillItem | null;
  /** 영업 칸이 빈 경우 그 칸에 넣을 값(빈칸 채움) — 없으면 null */
  docMaker: string | null;
  docModel: string | null;
  attachRows: Omit<FillAttachRow, 'no'>[];
  /** 명세 장이 필요함(명세 참조·기기별) */
  needAttach: boolean;
  /** 회색 칸을 "명세 참조"로 돌림 — 넘침 신호 때문이면 'overflow' */
  ref: null | 'limit' | 'overflow';
  mixed: boolean;
}

function planItem(
  index: number,
  item: SalesConfirmItem,
  kind: ItemKind,
  slots: SalesSlot[],
  keysShown: boolean,
  keys: Record<string, string>,
  overflow: boolean,
): ItemPlan {
  const rule = ITEM_KIND_RULES[kind];
  const units = slots.map((s) => viewOf(s, keysShown, keys));
  const isSw = kind === 'software';
  const assetOf = (u: UnitView) => (isSw ? u.pc : u.asset);
  const snOf = (u: UnitView) => (isSw ? u.key : u.serial);
  const fill: FillItem = {};
  let docMaker: string | null = null;
  let docModel: string | null = null;
  let mixed = false;
  let needAttach = false;

  // 제조사·모델명(소프트웨어는 제품명) — 영업 칸은 그대로, 비었으면 채움(P1), 다르면 회색 S/N 칸 첫 줄 "출고 …"(규칙 2)
  const salesMaker = tr(item.maker);
  const salesModel = tr(item.model);
  const SALES: FieldPlan = { mode: 'sales' };
  const mk = rule.diffFields.includes('maker') ? planField('maker', salesMaker, units.map((u) => u.maker)) : SALES;
  const md = rule.diffFields.includes('model') ? planField('model', salesModel, units.map((u) => u.model)) : SALES;
  if (!salesMaker && mk.mode !== 'sales') {
    docMaker = mk.mode === 'mixed' ? '기기별(명세)' : mk.mode === 'fill' ? mk.out : null;
    if (mk.mode === 'mixed') mixed = true;
  }
  if (!salesModel && md.mode !== 'sales') {
    docModel = md.mode === 'mixed' ? '기기별(명세)' : md.mode === 'fill' ? md.out : null;
    if (md.mode === 'mixed') mixed = true;
  }
  const mkDiff = !!salesMaker && (mk.mode === 'diff' || mk.mode === 'mixed');
  const mdDiff = !!salesModel && (md.mode === 'diff' || md.mode === 'mixed');
  if (mkDiff || mdDiff) {
    if (mk.mode === 'mixed' || md.mode === 'mixed') {
      fill.outLine = '모델 기기별 — 명세 참조';
      mixed = true;
    } else {
      const maker = mk.mode === 'diff' || mk.mode === 'fill' ? mk.out : salesMaker;
      const model = md.mode === 'diff' || md.mode === 'fill' ? md.out : salesModel;
      fill.outLine = [maker, model].filter(Boolean).join(' ');
    }
  }

  // 사양 줄(규칙 3) — 장비 중 hasSpec 품목만(영업 양식이 사양 줄을 그리는 기준)
  if (rule.diffFields.includes('spec') && hasSpec(item.cat)) {
    const cells: Record<string, FillSpecCell> = {};
    for (const k of specKeys(item.cat)) {
      const sv = specOf(item.spec, k);
      const pl = planField(`spec:${k}` as DiffField, sv, units.map((u) => specOf(u.spec, k)));
      if (pl.mode === 'sales') continue;
      if (pl.mode === 'mixed') {
        cells[k] = { req: sv, out: '기기별' };
        mixed = true;
      } else {
        cells[k] = { req: pl.mode === 'diff' ? sv : '', out: pl.out };
      }
    }
    if (Object.keys(cells).length) fill.spec = cells;
  }
  if (mixed) needAttach = true;

  // 회색 칸 자산번호·S/N(규칙 2) — 기타는 적은 기기만
  const cellUnits = kind === 'other' ? units.filter((u) => assetOf(u) || snOf(u)) : units;
  const hasCell = cellUnits.some((u) => assetOf(u) || snOf(u));
  let ref: ItemPlan['ref'] = null;
  if (hasCell) {
    const assetLines = chunk<FillVal>(cellUnits.map((u) => assetOf(u) || null), ASSET_PER_LINE);
    const snVals: FillVal[] = cellUnits.map((u) => snOf(u) || null);
    const snLines = isSw ? snVals.map((v) => [v]) : packSerials(snVals, SN_PER_LINE);
    const snMax = fill.outLine ? CELL_LINES - 1 : CELL_LINES;
    if (overflow) ref = 'overflow';
    else if (assetLines.length > CELL_LINES || snLines.length > snMax) ref = 'limit';
    if (ref) {
      fill.ref = cellUnits.length;
      needAttach = true;
    } else {
      fill.assetLines = assetLines;
      fill.snLines = snLines;
      if (isSw) fill.snTag = '키';
    }
  }

  // 출고 명세 줄(P3) — 제조사·모델명·사양 = 출고 값(없으면 영업 값), 다르면 아래 작게 "요청 ○○"
  const rowUnits = kind === 'other' ? units.filter((u) => u.asset || u.serial || u.maker || u.model) : units;
  const keysForSpec = rule.diffFields.includes('spec') && hasSpec(item.cat) ? specKeys(item.cat) : [];
  const attachRows = rowUnits.map((u) => {
    const diffs = diffsFor(kind, item, { maker: u.maker, model: u.model, spec: u.spec });
    const req = (f: DiffField) => diffs.find((x) => x.field === f)?.sales ?? '';
    const specVals = keysForSpec.map((k) => specOf(u.spec, k) || specOf(item.spec, k));
    const sn = snOf(u);
    return {
      item: `${index + 1}. ${item.cat}${units.length > 1 ? ` (${u.unitNo}/${units.length})` : ''}`,
      maker: (rule.diffFields.includes('maker') && u.maker) || salesMaker,
      makerReq: req('maker'),
      model: (rule.diffFields.includes('model') && u.model) || salesModel,
      modelReq: req('model'),
      asset: assetOf(u),
      sn,
      snTag: isSw && sn ? '키' : '',
      spec: specVals.some(Boolean) ? specVals.map((v) => v || '-').join(' / ') : '',
      specReq: diffs
        .filter((x) => x.field.startsWith('spec:') && (keysForSpec as readonly string[]).includes(x.field.slice(5)))
        .map((x) => `${x.field.slice(5)} ${x.sales}`)
        .join(' · '),
    };
  });

  const touched = !!(fill.outLine || fill.spec || fill.assetLines || fill.ref);
  return { fill: touched ? fill : null, docMaker, docModel, attachRows, needAttach, ref, mixed };
}

// ───────── 영업 양식 문서(ConfDoc) ─────────

function toConfItem(it: SalesConfirmItem): ConfItem {
  return {
    cat: it.cat,
    model: it.model,
    maker: it.maker,
    state: it.state,
    qty: it.qty,
    rent: typeof it.rent === 'number' ? it.rent : 0,
    baseColor: '',
    overColor: '',
    baseMono: '',
    overMono: '',
    spec: { ...(it.spec as Record<string, string>) },
    place: it.place,
  };
}

function toConfDoc(c: NormalizedSalesConfirm, p: SalesPrintExtra, region: string): ConfDoc {
  return {
    id: c.id,
    no: c.docNo,
    ver: c.ver,
    kind: p.kind === 'mfp' ? 'mfp' : 'it',
    region,
    term: c.term as ConfDoc['term'],
    statusNo: p.statusNo ?? '',
    company: c.company,
    orderDate: p.orderDate ?? '',
    deliveryDate: c.deliveryDate ?? '',
    inflow: c.inflow,
    sales: c.salesRep,
    industry: p.industry ?? '',
    hanjo: '',
    installCount: '',
    address: c.address,
    special: c.special,
    months: p.months ?? '',
    deposit: p.deposit ?? '',
    payNote: p.payNote ?? '',
    extra: p.extra ?? '',
    phone: c.contacts.phone,
    fax: p.fax ?? '',
    payer: c.contacts.payer,
    contractor: c.contacts.contractor,
    manager: c.contacts.manager,
    resident: c.contacts.resident,
    taxMail: p.taxMail ?? '',
    contractMail: p.contractMail ?? '',
    items: c.items.map(toConfItem),
    supplies: c.supplies.map(
      (s): ConfSupply => ({
        name: s.name,
        qty: s.qty ? String(s.qty) : '',
        charge: s.charge as ConfSupply['charge'],
        price: s.price ?? '',
        note: s.note,
      }),
    ),
  };
}

// ───────── 본 함수 ─────────

export function buildSalesPrintHtml(input: SalesPrintInput): SalesPrintResult {
  const { detail, options } = input;
  const c = detail.confirm;

  // 납품이 아닌 확인서(교체·유지보수·소프트웨어 …) — 지금 가진 양식(11-18판)은 납품 양식뿐(D24).
  // 영업 b33a4c3(2026-11-27)부터 type '소프트웨어' 가 따로 와서, 예전 /교체|유지보수/ 검사로는 소프트웨어 확인서를 납품 양식으로 잘못 그렸음.
  // 빈 type(옛 원문)은 납품으로 봄.
  const type = tr(c.type);
  if (type && type !== '납품') {
    return {
      html: '',
      notes: [],
      blocked: `${type} 확인서 출력은 영업 웹앱 새 양식으로 바꾸는 중이에요(곧 열려요) — 지금 가진 양식은 납품 양식뿐이라 다른 모양의 종이가 나가요. 기기 칸 입력·저장은 지금도 돼요.`,
      attached: false,
    };
  }

  const p = c.print ?? NONE_PRINT;
  const notes: SalesPrintNote[] = [];
  const warn = (text: string) => notes.push({ tone: 'warn', text });
  const info = (text: string) => notes.push({ tone: 'info', text });

  // 1 지역 — 영업 값, 비었으면 주소로 추정(영업 웹앱과 같은 regionOf)
  const salesRegion = tr(c.region);
  const guessed = salesRegion ? '' : regionOf(c.address) || tr(detail.regionGuess);
  const region = salesRegion || guessed;

  const doc = toConfDoc(c, p, region);
  const isIt = doc.kind === 'it';
  const keysShown = options.keys === 'shown';
  const overflowSet = new Set(input.overflowItems ?? []);
  const lineByIndex = new Map(detail.lines.map((l) => [l.itemIndex, l]));

  const fillItems: Record<number, FillItem> = {};
  const attachRows: Omit<FillAttachRow, 'no'>[] = [];
  let needAttach = options.attach === 'always';
  let refLimit = 0;
  let refOverflow = 0;
  let mixedItems = 0;
  let missingAsset = 0;
  let swUnits = 0;
  let swNoKey = 0;
  let recheck = 0;

  c.items.forEach((item, i) => {
    const line = lineByIndex.get(i);
    if (!line) return;
    const kind = line.kind;
    for (const s of line.slots) {
      const u = s.unit;
      if (s.unackedDiffs.length) recheck += 1;
      if (kind === 'device' || kind === 'monitor') {
        if (!tr(u?.assetId)) missingAsset += 1;
      } else if (kind === 'maintenance') {
        if (!tr(u?.assetId) && !tr(u?.serial)) missingAsset += 1;
      } else if (kind === 'software') {
        swUnits += 1;
        if (!u || !tr(input.licenseKeys[u.id])) swNoKey += 1;
      }
    }
    if (!isIt) return; // 복합기 갈래는 IT 칸을 안 채움(규칙 6)
    const plan = planItem(i, item, kind, line.slots, keysShown, input.licenseKeys, overflowSet.has(i));
    if (plan.fill) fillItems[i] = plan.fill;
    if (plan.docMaker !== null) doc.items[i].maker = plan.docMaker;
    if (plan.docModel !== null) doc.items[i].model = plan.docModel;
    attachRows.push(...plan.attachRows);
    if (plan.needAttach) needAttach = true;
    if (plan.ref === 'limit') refLimit += 1;
    if (plan.ref === 'overflow') refOverflow += 1;
    if (plan.mixed) mixedItems += 1;
  });

  const attach = isIt && needAttach && attachRows.length ? attachRows.map((r, k) => ({ no: k + 1, ...r })) : null;

  // 돈·계약서(P2) — null = 안 옴 → 빈칸, '' = 영업이 비움 → 영업 출력과 같게
  const money = {
    rent: c.items.length > 0 && c.items.every((it) => typeof it.rent === 'number'),
    deposit: p.deposit !== null,
    contract: p.contractMail !== null,
    payNote: p.payNote !== null,
  };

  const now = kst(input.nowIso);
  const actor = tr(input.actor);
  const fill: ConfirmFill = {
    items: fillItems,
    money,
    attach,
    back: {
      preparer: detail.work.processors.map(tr).filter(Boolean).join(', '),
      shipDate: kst(detail.work.shippedAt)?.ymd ?? '',
    },
    stamp: `IT 기재${now ? ` ${now.md} ${now.hm}` : ''}${actor ? ` ${actor}` : ''}`,
  };

  // ───── 알림(막지 않음) ─────
  if (missingAsset) warn(`자산번호를 아직 안 적은 기기 ${missingAsset}대(장비·모니터·유지보수) — 그 자리는 비거나 밑줄 빈칸으로 나가요(손으로 적기)`);
  if (detail.salesChanged) {
    warn(`영업에서 고친 판(v${detail.salesChanged.fromVer} → v${detail.salesChanged.toVer})을 아직 '확인함' 안 했어요 — 상세에서 무엇이 바뀌었나 먼저 보세요`);
  }
  if (recheck) warn(`영업 요청이 바뀌어 다시 확인이 필요한 기기 칸 ${recheck}개 — 종이엔 영업 값과 출고 값이 같이 나가요`);
  if (refOverflow) warn(`1면(별지)이 넘쳐 ${refOverflow}품목의 자산번호·S/N 을 '출고 명세' 장으로 돌렸어요`);
  if (refLimit) info(`${refLimit}품목은 회색 칸에 다 안 들어가 '출고 명세 참조'로 적고 '출고 명세(대수별)' 장에 나눠 적었어요`);
  if (mixedItems) info(`${mixedItems}품목은 기기끼리 모델·사양이 달라 '기기별'로 적고 '출고 명세' 장에 나눠 적었어요`);
  if (swUnits && isIt) {
    if (!keysShown) info(`라이선스 키 없이 찍어요 — 소프트웨어 ${swUnits}칸의 키 자리는 밑줄 빈칸`);
    else if (swNoKey) info(`라이선스 키가 없는 소프트웨어 칸 ${swNoKey}개 — 그 자리는 밑줄 빈칸`);
  }
  const notSent = NOT_SENT_LABELS.filter(([k]) => p[k] === null).map(([, label]) => label);
  if (!money.rent) notSent.unshift('월 렌탈료');
  if (notSent.length) info(`영업 웹앱이 아직 안 보내 주는 칸은 빈칸으로 나가요: ${notSent.join(' · ')}`);
  if (guessed) info(`지역 '${guessed}'은 영업이 비워 둬서 주소로 추정했어요(추정)`);
  else if (!region) info('지역을 몰라 머리 띠 지역 칸이 빈칸으로 나가요');
  const pv = detail.work.printedVer;
  if (pv !== null && pv !== undefined && c.ver > pv) info(`v${pv} 출력 뒤 영업이 고쳤어요(지금 v${c.ver}) — 이번 출력이 새 판이에요`);
  const printedMs = Date.parse(detail.work.printedAt ?? '');
  if (Number.isFinite(printedMs)) {
    const units = detail.lines.flatMap((l) => l.slots.map((s) => s.unit)).filter((u) => u !== null);
    if (units.some((u) => Date.parse(u.updatedAt) > printedMs)) info('지난 출력 뒤 IT 값(기기 칸)이 바뀌었어요 — 이번 출력에 반영돼요');
  }
  if (detail.orphans.length) info(`영업에서 빠진 칸 ${detail.orphans.length}개(상세 아래 회색)는 종이에 안 나가요`);
  if (!isIt) info('복합기 확인서로 왔어요 — 영업 양식 그대로 나가고 IT 칸은 채우지 않아요');

  const html = renderConfirm(doc, input.origin, options.withBack, fill);
  return { html, notes, blocked: null, attached: !!attach };
}
