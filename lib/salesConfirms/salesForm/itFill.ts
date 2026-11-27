/**
 * IT 칸 표시(data-it…) 이름 한 곳 + 표시 칸에 IT 값 넣기 — **우리 파일**(영업 사본 아님, 같은 폴더에 있는 건 사본 P 자리가 import 하기 때문).
 * 설계 docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-H(표시 약속 표 = 영업 요청 글 §11)·§3-E·E6·E7·E9·E18·E20.
 *
 * 채우기는 한 길(E6):
 *   printFill.buildFillPlan(순수) = "어느 표시 칸에 무슨 값"(SalesFillPlan)
 *   → applyFillPlan(doc, plan, renderer) = DOMParser 로 읽은 문서(스크립트 안 도는 빈 문서)의 표시 칸에 값 넣기
 *   → serializeFilled(doc) = '<!doctype html>' + outerHTML → sandbox iframe srcDoc(allow-scripts allow-modals, **allow-same-origin 금지**).
 * 문서는 영업 실시간 HTML(영업이 표시를 붙인 뒤)이든 사본 renderCopy(…, marks=true)든 같은 함수로 채움.
 *
 * 지킬 것(E9): 값은 textContent·createElement 로만 넣음 — innerHTML 에 값 넣기·HTML 을 정규식으로 고치기 금지.
 *   우리 CSS·스크립트도 style·script 요소로 <head> 끝에 덧붙임(<body> 끝에 두면 마지막 장이 `.page:last-child` 가 아니게 돼 인쇄 장 나눔이 영업 종이와 달라짐).
 *   영업 양식 자체 스크립트(넘치면 tight 로 줄이기)는 그대로 둠 — 우리 스크립트는 그 뒤(글꼴 준비 + 잠깐)에 잼.
 *
 * 화면 쪽 순서(출력 창 — components/salesConfirms/SalesPrintDialog.tsx):
 *   const doc = new DOMParser().parseFromString(html, 'text/html');
 *   const why = checkFormMarks(readFormMarks(doc), { renderer, id, ver });   // null 이면 실시간 HTML 을 씀, 아니면 이유(사본으로)
 *   const r = applyFillPlan(doc, plan, renderer);                            // r.missing 이 있으면 E7 고르기
 *   iframe.srcdoc = serializeFilled(doc);
 *   원본 모드(plan.cells {}·stamp '')도 applyFillPlan 을 불러야 인쇄 신호 스크립트가 붙음(값은 안 들어감).
 *   한 문서에 두 번 부르지 말 것(옵션을 바꾸면 받은 HTML 을 다시 DOMParser 로 읽어서) — 두 번째는 오류를 던짐.
 *
 * 인쇄 신호(우리 스크립트 — 지금 이름 그대로, 값 없음):
 *   부모 → 문서 { source:'sales-confirm', type:'sales-confirm:print' }            → window.print()   (e.source === window.parent 인 것만)
 *   문서 → 부모 { source, type:'sales-confirm:overflow', pages:[넘친 장 1부터] }  → 늘 한 번(없으면 []), 다시 그리기 없음 — 알림만
 *   문서 → 부모 { source, type:'sales-confirm:size', height:문서 전체 높이 px }    → 미리보기 높이 맞춤
 *   sandbox 문서 출처는 'null' 이라 보낼 때 targetOrigin '*'. 받는 쪽은 e.source === iframe.contentWindow 인 것만.
 */
import type {
  SalesFillApplyResult,
  SalesFillCell,
  SalesFillPlan,
  SalesFormMarks,
  SalesRenderer,
  SalesSvcSheet,
} from '../types';

// ───────────────────────── 표시 이름(§3-H — 영업 요청 글 §11 과 같은 글자) ─────────────────────────

/** 표시 규칙 판 — 영업 <body data-it-spec> 이 이 값일 때만 실시간 HTML 을 채움(모르는 판·없음이면 사본으로, E7) */
export const IT_MARK_SPEC = '1';

/** 속성 이름 */
export const IT_ATTR = {
  /** 칸 표시(값 = IT_MARK 중 하나) */
  mark: 'data-it',
  /** 품목 번호 — 납품: 왼쪽 td.n 에 찍히는 번호(별지까지 이어짐) = 영업 doc.items 순서 + 1 / svc: 품목 표 줄 순서 + 1 */
  item: 'data-it-item',
  /** 그 품목의 몇 번째 대(1부터) */
  unit: 'data-it-unit',
  // <body> 표시
  spec: 'data-it-spec',
  form: 'data-it-form',
  ver: 'data-it-ver',
  id: 'data-it-id',
} as const;

/** data-it 값 */
export const IT_MARK = {
  // 납품 대마다 줄 빈칸 5개(+ 촘촘 모양 .cm·.uc 의 span)
  maker: 'maker',
  model: 'model',
  asset: 'asset',
  sn: 'sn',
  spec: 'spec',
  /** 납품 소프트웨어 체크 줄 td.swr — 자리만(지금 안 채움) */
  sw: 'sw',
  // 납품 2면
  preparer: 'preparer',
  shipDate: 'ship-date',
  /** 모든 꼬리(.foot 첫 span 끝)의 빈 span */
  stamp: 'stamp',
  // 교체(IT 갈래) 교체 후 칸
  afterModel: 'after-model',
  afterMaker: 'after-maker',
  afterSn: 'after-sn',
  afterAsset: 'after-asset',
  afterHw: 'after-hw',
  afterSw: 'after-sw',
  // 교체 전 칸 — 자리만
  beforeSn: 'before-sn',
  beforeAsset: 'before-asset',
} as const;
export type ItMark = (typeof IT_MARK)[keyof typeof IT_MARK];

/** plan.cells 열쇠 '<표시>|<item>|<unit>' — 없는 자리는 빈 글자 */
export function fillKey(mark: ItMark, item?: number | null, unit?: number | null): string {
  return `${mark}|${item ?? ''}|${unit ?? ''}`;
}

// ───────────────────────── 출력 창 ↔ 미리보기 신호(이름 그대로 — printFill 이 다시 내보냄) ─────────────────────────

export const SALES_PRINT_MSG_SOURCE = 'sales-confirm';
export const SALES_PRINT_MSG_PRINT = 'sales-confirm:print';
export const SALES_PRINT_MSG_OVERFLOW = 'sales-confirm:overflow';
export const SALES_PRINT_MSG_SIZE = 'sales-confirm:size';

// ───────────────────────── 사본 P 자리가 쓰는 속성 글자(on 이 거짓이면 '' — 원본과 글자까지 같음) ─────────────────────────

const attrEsc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** ` data-it="…" data-it-item="n" data-it-unit="u"` — 값은 표시 이름·숫자뿐 */
export function itAttrs(on: boolean, mark: ItMark, item?: number, unit?: number): string {
  if (!on) return '';
  return ` ${IT_ATTR.mark}="${mark}"${item === undefined ? '' : ` ${IT_ATTR.item}="${item}"`}${unit === undefined ? '' : ` ${IT_ATTR.unit}="${unit}"`}`;
}

/** svc 품목 표 줄 ` data-it-item="k"` */
export function itItemAttr(on: boolean, item: number): string {
  return on ? ` ${IT_ATTR.item}="${item}"` : '';
}

/** 꼬리 끝 빈 span */
export function itStamp(on: boolean): string {
  return on ? `<span ${IT_ATTR.mark}="${IT_MARK.stamp}"></span>` : '';
}

/** <body> 표시 4개 */
export function itBodyAttrs(on: boolean, form: SalesRenderer, ver: unknown, id: unknown): string {
  if (!on) return '';
  return ` ${IT_ATTR.spec}="${IT_MARK_SPEC}" ${IT_ATTR.form}="${form}" ${IT_ATTR.ver}="${attrEsc(ver)}" ${IT_ATTR.id}="${attrEsc(id)}"`;
}

// ───────────────────────── 문서 표시 읽기 ─────────────────────────

/** <body> 표시 — 없으면 spec null */
export function readFormMarks(doc: Document): SalesFormMarks {
  const b = doc.body;
  const get = (name: string): string | null => (b ? b.getAttribute(name) : null);
  const spec = get(IT_ATTR.spec);
  const formRaw = (get(IT_ATTR.form) ?? '').trim();
  const verRaw = (get(IT_ATTR.ver) ?? '').trim();
  const id = get(IT_ATTR.id);
  return {
    spec: spec === null ? null : spec.trim(),
    form: formRaw === 'confirm' || formRaw === 'swap' || formRaw === 'svc' ? formRaw : null,
    ver: /^\d{1,10}$/.test(verRaw) ? Number(verRaw) : null,
    id: id === null ? null : id,
  };
}

/**
 * 실시간 HTML 을 그대로 채워도 되는지(E7). null = 됨, 아니면 사본으로 그릴 이유(쉬운 말 — 출력 창 위 한 줄).
 *   code 'ver' = 영업 양식의 판이 우리가 받아 둔 판과 다름 → 한 건 다시 받기 뒤 한 번 더(그래도 다르면 사본).
 */
export function checkFormMarks(
  marks: SalesFormMarks,
  expect: { renderer: SalesRenderer; id: string; ver: number },
): { code: 'none' | 'spec' | 'form' | 'id' | 'ver'; reason: string } | null {
  if (marks.spec === null) return { code: 'none', reason: '영업 양식에 아직 IT 칸 표시가 없어요' };
  if (marks.spec !== IT_MARK_SPEC) return { code: 'spec', reason: `영업 양식의 IT 칸 표시 판(${marks.spec})을 아직 몰라요` };
  if (marks.form !== expect.renderer) return { code: 'form', reason: '영업 양식 종류가 받아 둔 확인서와 달라요' };
  if (marks.id !== null && marks.id !== expect.id) return { code: 'id', reason: '다른 확인서의 영업 양식이 왔어요' };
  if (marks.ver !== expect.ver) {
    return { code: 'ver', reason: `영업 양식의 판(${marks.ver === null ? '모름' : `v${marks.ver}`})이 받아 둔 판(v${expect.ver})과 달라요` };
  }
  return null;
}

// ───────────────────────── 값 넣기 ─────────────────────────

/** 우리가 덧붙인 요소 표시(두 번 채우기 막기) */
const OWN_ATTR = 'data-itx-own';

/**
 * 우리 글자 CSS — 굵게 8.4pt 이상·검정(흑백 인쇄라 색 안 씀, 7.4pt 미만·연한 색 금지 — 영업 양식 규칙).
 * 요청과 다른 칸·토막 = 더 굵게 + 밑줄(E14). 교체 "출고 ○○" = 칸 아래 작은 굵은 줄(E19).
 * 'IT 기재 명세' 장(.itx-page)은 영업 .page 틀·색(t-svc)을 그대로 쓰고 표만 우리 것.
 */
const FILL_CSS = `
[data-it] .itx-v { display:block; font-size:8.6pt; font-weight:700; color:#000; line-height:1.25; white-space:normal; overflow-wrap:anywhere; font-style:normal; }
[data-it] .itx-v .itx-e { font-weight:900; color:#000; }
[data-it] .itx-v .itx-e u { text-decoration:underline; text-decoration-thickness:1.4px; text-underline-offset:1.2px; }
[data-it] .itx-sub { display:block; margin-top:.4mm; font-size:8.4pt; font-weight:800; color:#000; line-height:1.2; white-space:normal; overflow-wrap:anywhere; font-style:normal; }
[data-it] .itx-v.itx-in { display:inline; }
[data-it] .itx-ph { font-weight:600; color:#333; }
.foot .itx-st { font-weight:700; color:#000; }
.itx-page .itx-tbl { width:100%; border-collapse:collapse; table-layout:fixed; }
.itx-page .itx-tbl th, .itx-page .itx-tbl td { border:1px solid var(--line); padding:.6mm 1.5mm; font-size:8.8pt; height:7.4mm; vertical-align:middle; overflow-wrap:anywhere; white-space:normal; }
.itx-page .itx-tbl th { font-weight:800; text-align:center; background:var(--gl); color:#000; white-space:nowrap; }
.itx-page .itx-tbl td { font-weight:700; color:#000; }
.itx-page .itx-tbl td.c { text-align:center; }
.itx-page .itx-tbl td.nm { font-weight:600; }
`;

/**
 * 우리 스크립트(sandbox iframe 안에서 돎 — 같은 출처 권한 없음, 부모 DOM 은 안 만짐).
 * ⓐ 부모 창의 인쇄 신호 → window.print() ⓑ 글꼴 준비 + 영업 양식 줄이기 스크립트 뒤에 장마다 꼬리가 종이 밖으로 밀렸는지 재서 알림 ⓒ 높이 알림.
 * 이 글자 안에 '</' 를 넣지 말 것(<script> 가 끝남).
 */
const FILL_JS = `(function(){var S='${SALES_PRINT_MSG_SOURCE}',P='${SALES_PRINT_MSG_PRINT}',O='${SALES_PRINT_MSG_OVERFLOW}',Z='${SALES_PRINT_MSG_SIZE}';
window.addEventListener('message',function(e){if(e.source!==window.parent)return;var m=e.data;if(m&&m.type===P)window.print();});
function send(o){o.source=S;try{window.parent.postMessage(o,'*');}catch(_){}}
function check(){var pages=[],list=document.querySelectorAll('.page');for(var i=0;i!==list.length;i++){var pg=list[i],r=pg.getBoundingClientRect(),f=pg.querySelector('.foot');var over=f?f.getBoundingClientRect().bottom>r.bottom+1:pg.scrollHeight>pg.clientHeight+1;if(over)pages.push(i+1);}
send({type:O,pages:pages});var b=document.body;send({type:Z,height:Math.ceil(Math.max(b.getBoundingClientRect().height,b.scrollHeight))});}
function later(){setTimeout(check,80);}
function go(){var f=document.fonts&&document.fonts.ready;if(f)f.then(later,later);else later();}
if(document.readyState==='complete')go();else window.addEventListener('load',go);})();`;

/** 'IT 기재 명세' 한 장에 들어가는 줄(E20) — 넘으면 다음 장(머리줄 반복) */
export const IT_SHEET_ROWS = 28;

/** 표시 숫자(item·unit) 정리 — '03' 도 3 으로 */
function normNum(v: string | null): string {
  const t = String(v ?? '').trim();
  return /^\d{1,6}$/.test(t) ? String(Number(t)) : t;
}

/** 문서의 [data-it] 칸 → 열쇠별 요소 */
function indexMarks(doc: Document): Map<string, Element[]> {
  const map = new Map<string, Element[]>();
  doc.querySelectorAll(`[${IT_ATTR.mark}]`).forEach((el) => {
    const mark = (el.getAttribute(IT_ATTR.mark) ?? '').trim();
    if (!mark) return;
    const key = `${mark}|${normNum(el.getAttribute(IT_ATTR.item))}|${normNum(el.getAttribute(IT_ATTR.unit))}`;
    const list = map.get(key);
    if (list) list.push(el);
    else map.set(key, [el]);
  });
  return map;
}

function cellHasText(cell: SalesFillCell | undefined): boolean {
  if (!cell) return false;
  return (cell.parts ?? []).some((p) => !!p && typeof p.text === 'string' && p.text.trim() !== '') || !!(cell.sub ?? '').trim();
}

/** 칸 하나에 값(영업 글자 뒤에 덧붙임 — 영업 칸 내용은 안 지움) */
function putCell(doc: Document, el: Element, cell: SalesFillCell): void {
  const wrap = doc.createElement('span');
  wrap.className = 'itx-v';
  for (const p of cell.parts ?? []) {
    if (!p || typeof p.text !== 'string' || !p.text) continue;
    if (p.emph) {
      const b = doc.createElement('b');
      b.className = 'itx-e';
      const u = doc.createElement('u');
      u.textContent = p.text;
      b.appendChild(u);
      wrap.appendChild(b);
    } else {
      wrap.appendChild(doc.createTextNode(p.text));
    }
  }
  if (wrap.textContent && wrap.textContent.trim()) el.appendChild(wrap);
  const sub = (cell.sub ?? '').trim();
  if (sub) {
    const s = doc.createElement('span');
    s.className = 'itx-sub';
    s.textContent = sub;
    el.appendChild(s);
  }
}

/** 2면 칸 — 자리 글자('성명 · 서명'·'YYYY-MM-DD')를 지우고 값(출고 준비자는 뒤에 ' · 서명' — 서명은 손으로) */
function putBack(doc: Document, el: Element, text: string, signHint: boolean): void {
  el.textContent = '';
  const v = doc.createElement('span');
  v.className = 'itx-v itx-in';
  v.textContent = text;
  el.appendChild(v);
  if (signHint) {
    const h = doc.createElement('span');
    h.className = 'itx-ph';
    h.textContent = ' · 서명';
    el.appendChild(h);
  }
}

/** 꼬리 끝 span 에 " · IT 기재 …" */
function putStamp(doc: Document, el: Element, stamp: string): void {
  const s = doc.createElement('span');
  s.className = 'itx-st';
  s.textContent = stamp;
  el.appendChild(s);
}

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 줄 칸 폭(열 수별) — 순은 좁게, 나머지는 표가 나눔 */
const SHEET_COL_WIDTHS: Record<number, string[]> = {
  4: ['9mm', '66mm', '42mm', ''],
  5: ['9mm', '46mm', '26mm', '32mm', ''],
};

/** 유지보수·소프트웨어 'IT 기재 명세' 장(E20) — 영업 마지막 장 뒤에, 같은 .page 틀·색. 28줄 넘으면 다음 장(머리줄 반복) */
function appendSvcSheet(doc: Document, sheet: SalesSvcSheet, stamp: string): number {
  const body = doc.body;
  if (!body) return 0;
  const pages = body.querySelectorAll('.page');
  const first = pages[0] ?? null;
  const last = pages[pages.length - 1] ?? null;
  const pageClass = first && first.classList.contains('t-svc') ? 'page t-svc itx-page' : 'page itx-page';
  const logo = first ? first.querySelector('.top img') : null;
  const rows = sheet.rows.length ? sheet.rows : [sheet.columns.map((_, k) => (k === 0 ? '1' : ''))];
  const chunks: string[][][] = [];
  for (let i = 0; i < rows.length; i += IT_SHEET_ROWS) chunks.push(rows.slice(i, i + IT_SHEET_ROWS));
  const widths = SHEET_COL_WIDTHS[sheet.columns.length] ?? [];
  let anchor: Node | null = last ? last.nextSibling : null;

  chunks.forEach((chunk, k) => {
    const page = make(doc, 'div', pageClass);
    page.setAttribute(OWN_ATTR, '1');

    const top = make(doc, 'div', 'top');
    if (logo) top.appendChild(logo.cloneNode(false));
    const nmBox = make(doc, 'div');
    nmBox.appendChild(make(doc, 'div', 'nm', '(주)퍼스트전산'));
    nmBox.appendChild(make(doc, 'div', 'tl', '1면 품목의 별첨 · 고객 서명 칸 없음'));
    top.appendChild(nmBox);
    page.appendChild(top);

    const bar = make(doc, 'div', 'bar');
    bar.appendChild(make(doc, 'div', 't', chunks.length > 1 ? `${sheet.title} (${k + 1}/${chunks.length})` : sheet.title));
    page.appendChild(bar);

    const info = make(doc, 'div', 'box');
    info.appendChild(make(doc, 'h3', undefined, '거래처'));
    const kv = make(doc, 'table', 'kv');
    const tr = make(doc, 'tr');
    tr.appendChild(make(doc, 'th', undefined, '상호'));
    tr.appendChild(make(doc, 'td', 'co', sheet.company));
    tr.appendChild(make(doc, 'th', undefined, '시작일'));
    tr.appendChild(make(doc, 'td', undefined, sheet.startDate));
    tr.appendChild(make(doc, 'th', undefined, '번호'));
    tr.appendChild(make(doc, 'td', undefined, sheet.docNo));
    kv.appendChild(tr);
    info.appendChild(kv);
    page.appendChild(info);

    const box = make(doc, 'div', 'box');
    const h3 = make(doc, 'h3', undefined, 'IT 기재 · 대마다 한 줄 ');
    h3.appendChild(make(doc, 'small', undefined, '빈 칸 = 출고·설치 때 직접 기재'));
    box.appendChild(h3);
    const tbl = make(doc, 'table', 'itx-tbl');
    if (widths.length) {
      const cg = make(doc, 'colgroup');
      for (const w of widths) {
        const col = make(doc, 'col');
        if (w) col.style.width = w;
        cg.appendChild(col);
      }
      tbl.appendChild(cg);
    }
    const thead = make(doc, 'thead');
    const hr = make(doc, 'tr');
    for (const c of sheet.columns) hr.appendChild(make(doc, 'th', undefined, c));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = make(doc, 'tbody');
    for (const r of chunk) {
      const row = make(doc, 'tr');
      sheet.columns.forEach((_, ci) => {
        row.appendChild(make(doc, 'td', ci === 0 ? 'c' : ci === 1 ? 'nm' : undefined, String(r[ci] ?? '')));
      });
      tbody.appendChild(row);
    }
    tbl.appendChild(tbody);
    box.appendChild(tbl);
    page.appendChild(box);

    const foot = make(doc, 'div', 'foot');
    const left = make(doc, 'span', undefined, [sheet.docNo, sheet.company].filter(Boolean).join(' · '));
    if (stamp) putStamp(doc, left, stamp);
    foot.appendChild(left);
    foot.appendChild(make(doc, 'span', undefined, '1면 품목의 별첨 · IT 기재'));
    page.appendChild(foot);

    body.insertBefore(page, anchor);
    anchor = page.nextSibling;
  });
  return chunks.length;
}

/**
 * 표시 칸에 plan 의 값 넣기 + 우리 CSS·스크립트(+ svc 면 'IT 기재 명세' 장).
 * missing = 넣을 값이 있는데 갈 칸을 못 찾은 열쇠들(값 없음) — 실시간 HTML 에서 1개라도 있으면 E7 고르기.
 */
export function applyFillPlan(doc: Document, plan: SalesFillPlan, renderer: SalesRenderer): SalesFillApplyResult {
  if (doc.querySelector(`[${OWN_ATTR}]`)) {
    throw new Error('이미 채운 문서예요 — 받은 HTML 을 다시 읽어서 채워 주세요');
  }
  const missing: string[] = [];
  let filled = 0;
  const index = indexMarks(doc);

  for (const [key, cell] of Object.entries(plan.cells ?? {})) {
    if (!cellHasText(cell)) continue;
    const els = index.get(key);
    if (!els || !els.length) {
      missing.push(key);
      continue;
    }
    for (const e of els) putCell(doc, e, cell);
    filled += 1;
  }

  if (plan.back) {
    const pairs: [ItMark, string, boolean][] = [
      [IT_MARK.preparer, plan.back.preparer, true],
      [IT_MARK.shipDate, plan.back.shipDate, false],
    ];
    for (const [mark, raw, hint] of pairs) {
      const text = String(raw ?? '').trim();
      if (!text) continue;
      const key = fillKey(mark);
      const els = index.get(key);
      if (!els || !els.length) {
        missing.push(key);
        continue;
      }
      for (const e of els) putBack(doc, e, text, hint);
      filled += 1;
    }
  }

  const stamp = String(plan.stamp ?? '');
  if (stamp.trim()) {
    const key = fillKey(IT_MARK.stamp);
    const els = index.get(key);
    if (!els || !els.length) missing.push(key);
    else {
      for (const e of els) putStamp(doc, e, stamp);
      filled += 1;
    }
  }

  if (plan.svcSheet && renderer === 'svc') appendSvcSheet(doc, plan.svcSheet, stamp.trim() ? stamp : '');

  // 우리 CSS·스크립트 — <head> 끝(영업 <style> 뒤라 같은 강도면 우리 것이 이김)
  const head = doc.head ?? doc.documentElement;
  const style = doc.createElement('style');
  style.setAttribute(OWN_ATTR, '1');
  style.textContent = FILL_CSS;
  head.appendChild(style);
  const script = doc.createElement('script');
  script.setAttribute(OWN_ATTR, '1');
  script.textContent = FILL_JS;
  head.appendChild(script);

  return { missing, filled };
}

/** iframe srcDoc 에 넣을 글자 */
export function serializeFilled(doc: Document): string {
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
