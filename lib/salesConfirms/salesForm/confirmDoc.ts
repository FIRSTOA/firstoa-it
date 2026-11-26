/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 + IT 바꿈 P1~P6]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/confirmDoc.ts
//       커밋 f97ebec1b7e553121ad144203a37f9183d9a42a9 (2026-11-18) — 2026-11-26 받음(읽기만, blob 54daf9c2)
// 설계: docs/tasks/2026-11-26-sales-confirm-import.md §3-9 (D15~D18·D21~D23·D25·D30)
//
// renderConfirm(d, origin, withBack, fill?) — fill 없이 부르면 영업 원본과 글자까지 같은 HTML(사본이 정확한지의 기준).
// 바꾼 곳은 아래 P1~P6 뿐이고, 자리마다 `[IT 바꿈 Pn]` 주석. 바뀐 글자는 전부 fill 이 있을 때만 나옴.
//   P1 itemRows(IT 갈래): 사양 칸 "요청 → 출고"(다른 칸만) · 회색 줄에 "출고 모델" 줄 + 자산번호·S/N(소프트웨어 = 설치 PC·라이선스 키)
//      + 그 글자용 CSS(FILL_CSS — fill 이 있을 때만 <style> 끝에 붙음). 모델명·제조사 빈칸 채움·지역 추정은 printFill 이 d 에 넣음(여기선 안 바꿈).
//   P2 page1·itemTable: 돈·계약서 칸이 안 왔으면(fill.money) ₩0 대신 빈칸, 계약서 자동 체크 안 함, 결제특이 '-' 대신 빈칸
//   P3 출고 명세(대수별) 장(pageAttach) — 별지 뒤·2면 앞, fill.attach 가 있을 때만
//   P4 page2: 출고 준비자 = 처리자 이름 · 서명 / 출고일 = 출고 날짜
//   P5 꼬리(.foot) 왼쪽 끝 " · IT 기재 MM-DD HH:mm 이름"
//   P6 문서 끝 스크립트: ⓐ 부모 창의 '인쇄' 신호 → window.print() ⓑ 꼬리가 종이 밖으로 밀린 장의 품목 번호를 부모에게 '넘침' 신호
// 안 바꿈: 복합기 갈래, 원래 CSS·색, 안내·주의·법적 문구, 1면 품목 2개·별지 7개, 양식 안 높이 맞춤 스크립트.
// 영업 웹앱이 새 판을 GitHub 에 올리면: 이 파일을 새 판으로 통째로 바꾸고(이 머리 주석은 새로) P1~P6 을 다시 적용 →
//   "fill 없이 부르면 원본과 같음" Node 비교 → 교체 양식이면 회색 칸 자리를 정해 설계 §3-9 에 덧붙임.
// 채우는 값(fill)은 lib/salesConfirms/printFill.ts 가 만듦. 값은 전부 이 파일의 esc() 를 거침.
// =====================================================================================
/**
 * 납품 확인서 출력 양식 (HTML 한 장) — 화면 미리보기(iframe)와 인쇄 창이 같은 것을 씀
 *  1면 = 고객 서명용 (복합기 / IT 따로) · 별지 = 품목이 1면에 다 안 들어갈 때 · 2면 = 출고·설치 확인 (내부)
 *  인쇄 안전: 종이 여백 6mm·8mm 안에만 그림, 7.4pt 미만 글씨·연한 색 금지 (출력 시 잘림·깨짐 경험)
 *  양식 색·구성은 사용자 확정 시안(2026-11-18) 그대로 — 바꿀 때는 출력해서 확인할 것
 */
import { contractType, dayText, hasSpec, KIND_LABEL, num, specKeys, totalRent, totalUnits, type ConfDoc, type ConfItem } from './confirm';

// ───────── [IT 바꿈 P1~P6] 채움 자료 — printFill.ts 가 만듦(값은 그냥 글자, 여기서 esc) ─────────
/** 회색 칸 값 하나 — null = 밑줄 빈칸(손으로 적음) */
export type FillVal = string | null;
/** 사양 칸 하나 — out 이 비면 영업 값 그대로. req 가 비면 출고 값만(빈칸 채움), 아니면 "req → out" */
export type FillSpecCell = { req: string; out: string };
export type FillItem = {
  /** 사양 칸 이름(specKeys) → 바뀐 칸만 */
  spec?: Record<string, FillSpecCell>;
  /** S/N 칸 첫 줄 "출고 …"(머리말 '출고'는 여기서 붙임) — 없으면 '' */
  outLine?: string;
  /** 자산번호 칸 줄들(줄마다 값 목록) */
  assetLines?: FillVal[][];
  /** S/N 칸 줄들 */
  snLines?: FillVal[][];
  /** S/N 값 앞 작은 머리말(소프트웨어 '키') */
  snTag?: string;
  /** 칸에 안 들어감 → 두 칸 모두 "출고 명세 참조 (n대)" */
  ref?: number;
};
/** 출고 명세 한 줄 — 칸이 비면 빈 칸(손으로) */
export type FillAttachRow = {
  no: number;
  item: string;
  maker: string;
  makerReq: string;
  model: string;
  modelReq: string;
  asset: string;
  sn: string;
  snTag: string;
  spec: string;
  specReq: string;
};
export type ConfirmFill = {
  /** d.items 의 순서(0부터) → 그 품목의 채움 */
  items: Record<number, FillItem>;
  /** 영업이 보낸 칸인지(false = 안 옴 → 빈칸, 가짜 ₩0·자동 체크 없음 — D17) */
  money: { rent: boolean; deposit: boolean; contract: boolean; payNote: boolean };
  /** 출고 명세 장 줄들 — null·빈 배열이면 장을 안 붙임 */
  attach: FillAttachRow[] | null;
  /** 2면 출고 준비자·출고일 — 비면 양식 그대로 */
  back: { preparer: string; shipDate: string };
  /** 꼬리 "IT 기재 …" */
  stamp: string;
};
/**
 * [IT 바꿈 P6] 부모 창(components/salesConfirms/SalesPrintDialog.tsx) ↔ 미리보기 신호 — 그 파일의 SALES_PRINT_MSG 와 같은 이름.
 *   부모 → 문서 { source:'sales-confirm', type:'sales-confirm:print' } → window.print()
 *   문서 → 부모 { source:'sales-confirm', type:'sales-confirm:overflow', items:[품목 순서 0부터], pages:[넘친 장 1부터] } — 넘친 장이 있을 때만
 *   문서 → 부모 { source:'sales-confirm', type:'sales-confirm:size', height:문서 전체 높이 px } — 그린 뒤 한 번
 *   sandbox 문서라 targetOrigin '*'(보내는 건 품목 순서·높이뿐 — 값 없음). 부모 DOM 은 안 만짐.
 */
export const IT_PRINT_MSG_SOURCE = 'sales-confirm';
export const IT_PRINT_MSG_PRINT = 'sales-confirm:print';
export const IT_PRINT_MSG_OVERFLOW = 'sales-confirm:overflow';
export const IT_PRINT_MSG_SIZE = 'sales-confirm:size';
/** [IT 바꿈 P3] 출고 명세 한 장에 들어가는 줄(요청 줄·긴 키가 있는 줄은 1.5줄로 셈) */
export const ATTACH_CAP = 28;

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const won = (n: number) => `₩${Math.round(n).toLocaleString()}`;
const cnt = (s: string, unit: string) => (num(s) ? `${num(s).toLocaleString()}${unit}` : '-');

/** 1면에 들어가는 품목 수 (기재 칸을 크게 하느라 2개) · 별지 한 장에 들어가는 수 */
export const FIRST_CAP = 2;
export const MORE_CAP = 7;

const CSS = `
/* 사무실 프린터가 가장자리를 약 11~12mm 먹음(2026-11-18 확인용 출력) → 인쇄 여백 13mm, 인쇄 때만 94%로 줄여 배치 그대로 */
@page { size: A4; margin: 13mm; }
* { box-sizing: border-box; }
:root { --g:#3f7f45; --gd:#2f6a36; --gl:#e8f0e8; --gray:#f1f2ef; --line:#b9c0b6; --red:#b4483a; --redl:#fbeeec; --ink:#000; --mute:#262a26; }
html, body { margin:0; background:#dcdedb; color:var(--ink); font-family:'Malgun Gothic','맑은 고딕',sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.page { width:194mm; height:284.5mm; margin:0 auto; background:#fff; display:flex; flex-direction:column; gap:1.5mm; font-size:8.4pt; overflow:hidden; page-break-after:always; break-after:page; }
.page:last-child { page-break-after:auto; break-after:auto; }
@media print { html, body { background:#fff; } .page { zoom:.94; } }
@media screen { body { padding:9mm 0; } .page { box-shadow:0 0 0 8mm #fff, 0 0 0 8.3mm #b5b8b3; margin-bottom:20mm; } }
.top { display:flex; align-items:center; gap:3mm; }
.top img { width:11mm; height:11mm; object-fit:contain; }
.top .nm { font-size:14pt; font-weight:800; }
.top .tl, .top .cc, .foot { font-size:7.8pt; color:var(--mute); }
.top .cc { margin-left:auto; align-self:flex-end; }
.bar { display:flex; background:var(--g); color:#fff; align-items:stretch; min-height:10mm; }
.bar > div { display:flex; align-items:center; padding:0 3mm; border-right:1px solid rgba(255,255,255,.35); font-weight:700; font-size:8.5pt; }
.bar .t { flex:1; justify-content:center; font-size:17pt; letter-spacing:3px; }
.bar > div:last-child { border-right:0; }
.bar b { margin-left:1.5mm; font-weight:800; }
.bar .rg { background:#fff; color:var(--gd); font-size:13pt; font-weight:900; padding:0 4mm; letter-spacing:1px; border-right:0; min-width:34mm; }
.bar .rg small { font-size:8pt; font-weight:600; color:#262a26; margin-right:1.5mm; letter-spacing:0; }
.box { border:1px solid var(--line); }
.box > h3 { margin:0; background:var(--g); color:#fff; font-size:8.6pt; padding:.9mm 2.5mm; }
.box > h3.d { background:var(--gd); }
.box > h3.r { background:var(--red); }
.box > h3 small { font-weight:400; margin-left:2mm; font-size:7.8pt; }
table { width:100%; border-collapse:collapse; }
.kv th, .kv td { border-top:1px solid var(--line); border-left:1px solid var(--line); padding:.5mm 2mm; height:5.3mm; }
.kv tr > :first-child { border-left:0; }
.kv th { background:var(--gray); font-weight:600; width:17mm; white-space:nowrap; text-align:center; }
.kv td.co { font-size:11.5pt; font-weight:800; }
.kv td.emph { font-weight:700; font-size:9.2pt; background:#fffbe8; }
.row2 { display:grid; gap:1.5mm; }
.sum div { display:flex; justify-content:space-between; border-top:1px solid var(--line); padding:.6mm 2.5mm; height:5.6mm; align-items:center; }
.sum div span small { color:var(--mute); font-size:7.6pt; }
.sum div.term { background:#fff5d6; height:8.5mm; font-size:10pt; font-weight:800; }
.sum div.term b { font-size:14pt; color:#8a5a00; }
.sum div.tot { background:var(--gl); font-weight:800; font-size:9.5pt; height:8mm; }
.it th { background:var(--gray); font-weight:600; padding:.9mm 1mm; border-left:1px solid var(--line); border-bottom:1.5px solid var(--g); white-space:nowrap; }
.it td { border-left:1px solid var(--line); border-top:1px solid var(--line); padding:.6mm 1.4mm; height:5.4mm; white-space:nowrap; overflow:hidden; }
.it tr > :first-child { border-left:0; }
.it td.n { text-align:center; font-weight:800; font-size:9.5pt; background:#fafbf9; }
.it td.r { text-align:right; } .it td.c { text-align:center; }
.it td.m { font-weight:800; font-size:9pt; }
.it td.v { text-align:right; font-weight:700; font-size:9pt; }
.it tbody tr.first td { border-top:1.5px solid #9fb59c; height:6.8mm; font-size:9pt; }
.it tbody tr.first td.m, .it tbody tr.first td.v { font-size:9.6pt; }
.it tfoot .vat { font-size:7.8pt; font-weight:600; color:#000; }
.it tr.w td { height:9.5mm; vertical-align:top; padding-top:.5mm; background:#f3f4f1; border-top:1px dashed #b9c0b6; white-space:normal; }
.it tr.w td i { display:block; font-style:normal; font-size:7.4pt; color:#1e2420; }
.it tr.w td b.u { display:inline-block; min-width:9mm; border-bottom:1px solid #8f988f; margin:0 .8mm; }
.it tr.sp td { background:#fff; border-top:1px solid #b9cbb6; height:6mm; white-space:normal; }
.it tr.sp td:first-child i { color:var(--gd); font-weight:800; font-size:8pt; font-style:normal; }
.spec { display:flex; flex-wrap:wrap; }
.spec span { font-size:8.8pt; font-weight:700; padding:0 2.5mm 0 1.2mm; border-left:1px dotted #c4cbc1; }
.spec span:first-child { border-left:0; }
.spec span i { font-style:normal; margin-right:1mm; font-size:7.4pt; color:var(--gd); font-weight:600; }
.it tfoot td { background:#dde8dc; font-weight:800; border-top:1.5px solid var(--g); height:6.2mm; }
.it tfoot td.tl { white-space:normal; }
.it tfoot .xt { margin-left:4mm; font-weight:700; color:#000; }
.it tfoot .xt i { font-style:normal; font-weight:600; font-size:7.6pt; color:var(--gd); margin-right:1.5mm; }
.it tfoot td.r b { color:var(--gd); font-size:11pt; }
.warn .cols { display:grid; grid-template-columns:1fr 1fr; }
.warn .cols > div { padding:.8mm 2.5mm; font-size:7.4pt; line-height:1.32; color:#000; }
.warn .cols > div:first-child { border-right:1px solid var(--line); }
.warn h5 { margin:0 0 .5mm; color:var(--red); font-size:8.2pt; }
.warn ul { margin:0; padding-left:3.5mm; }
.warn > h3.r { font-size:9.4pt; font-weight:900; }
.warn .law { background:var(--redl); border-top:1px solid #ecc9c3; text-align:center; color:var(--red); font-weight:800; font-size:8pt; line-height:1.45; padding:1mm 4mm; }
.it-p .warn .cols > div { font-size:7.4pt; line-height:1.28; }
.sign td { height:6.6mm; }
.sign td.big { height:10mm; color:#666; text-align:center; }
.cb { display:inline-flex; align-items:center; gap:1mm; margin-right:3.5mm; }
.cb::before { content:''; width:2.8mm; height:2.8mm; border:1px solid #222; display:inline-block; }
.cb.on::before { background:var(--g); border-color:var(--g); }
.cbs { display:flex; gap:2.5mm; align-items:center; }
.ph { color:#666; }
.mini, .rule { font-size:7.6pt; color:var(--mute); }
.foot { margin-top:auto; display:flex; justify-content:space-between; }
.sec { display:flex; align-items:center; gap:3mm; margin-top:.6mm; }
.sec span { background:var(--g); color:#fff; font-weight:800; padding:1mm 3mm; font-size:9pt; }
.sec.r span { background:var(--red); }
.sec::after { content:''; flex:1; height:1.6px; background:var(--g); }
.lead { background:var(--gray); padding:1.3mm 2.5mm; font-size:7.8pt; border-top:1px solid var(--line); }
.note2 { background:#eef5ee; border:1px dashed var(--g); padding:1.3mm 2.5mm; font-size:7.8pt; color:var(--gd); }
.it-p .kv th, .it-p .kv td { height:5.2mm; }
.it-p .it tr.w td { height:8mm; }
.it-p .it tr.sp td { height:8.5mm; }
.it-p .spec span { font-size:9.4pt; }
.it tr.w2 > td { height:9mm; border-top:1px dotted #b9c0b6; padding:0; }
.it td.cn table { height:100%; table-layout:fixed; }
.it td.cn td { border:0; border-left:1px solid var(--line); vertical-align:top; padding:.5mm 1.4mm; background:#f3f4f1; height:auto; }
.it td.cn td:first-child { border-left:0; }
.it-p .note2 { padding:.8mm 2.5mm; }
`;

// [IT 바꿈 P1·P3] IT 가 넣는 글자 — 굵게 8.4pt, 머리말은 양식 초록(--gd). 7.4pt 미만·연한 색 금지(영업 규칙). fill 이 있을 때만 <style> 끝에 붙음
const FILL_CSS = `
.it tr.w td .xl { display:block; font-size:8.4pt; font-weight:800; line-height:1.3; color:#000; overflow-wrap:anywhere; }
.it tr.w td .xl b { font-weight:800; margin-right:2.4mm; }
.it tr.w td .xl b:last-child { margin-right:0; }
.it tr.w td .xl b.u { min-width:10mm; height:3.4mm; margin:0 2.4mm 0 0; vertical-align:bottom; }
.it tr.w td .xl b.u.s { min-width:21mm; }
em.xh { font-style:normal; font-weight:700; font-size:7.4pt; color:var(--gd); margin-right:1mm; }
.spec span em.xa { font-style:normal; font-weight:700; margin:0 .9mm; color:var(--gd); }
.spec span b.xo { font-weight:900; }
.it.xs td { white-space:normal; height:6.6mm; font-size:8.4pt; vertical-align:middle; overflow-wrap:anywhere; }
.it.xs td.c { text-align:center; }
.it.xs td b { font-weight:800; }
.it.xs td small { display:block; font-size:7.4pt; font-weight:600; color:var(--mute); line-height:1.2; }
.it.xs tbody tr.blank td { height:7.2mm; }
`;

/* ───────── 문구 (사용자 제공 2026-11-18 · 줄임 허용, 필수 내용 삭제 금지) ───────── */
const LAW = '본 확인서에 서명하면 견적서의 임대 조건과 본 확인서에 명시된 조건에 동의한 것으로 보며,<br>별도 계약서를 작성하지 않은 경우에도 해당 합의는 법적 효력을 갖습니다.';
const PENALTY = '위약금 = 해지 직전 3개월 평균 월 임대료 × 잔여 임대 개월 수 × 50%';
const DEPOSIT = '보증금은 납품 전 선납입니다. 고객 사유로 납품 당일 일방적으로 취소하거나 기기 수령 후 철수를 요청하는 경우, 출고 준비 및 물류 이동 비용이 발생하므로 보증금은 반환되지 않습니다.';
const NOTICE = {
  mfp: {
    guide: [
      `중도해지 위약금 50% · 고객 사유로 임대기간 만료 전에 중도해지하는 경우 위약금이 청구됩니다.<br>${PENALTY}`,
      `보증금 선납·미반환 · ${DEPOSIT}`,
      '채무 즉시 정산 · 계약 해지 시 미납 임대료 등 본 계약에 따른 채무가 있으면 전액을 즉시 지급해야 합니다.',
    ],
    caution: [
      '고객 과실로 임대 장비가 파손된 경우, 파손 비용이 별도로 청구됩니다.',
      '스캔·프린터 드라이버 설치는 원격 지원을 원칙으로 하며, 방문 요청 시 출장비가 청구될 수 있습니다.',
      '라벨지 사용 방법과 주의사항은 납품 시 안내드립니다.',
    ],
  },
  it: {
    guide: [
      `중도해지 위약금 50% · 임대기간 만료 전 고객 사유로 중도해지하거나 고객 귀책사유로 계약이 해지되는 경우 위약금이 청구됩니다.<br>${PENALTY}`,
      '계약 해지 시 채무 정산 · 미납 임대료 등 본 계약에 따른 채무가 있으면 전액을 즉시 지급해야 합니다.',
      `보증금 선납·반환 조건 · ${DEPOSIT.replace('기기 수령', '장비 수령')}`,
    ],
    caution: [
      '소유권·파손 · 임대 장비의 소유권은 ㈜퍼스트전산에 있습니다. 고객 과실로 파손된 경우 수리·부품 교체 비용이 별도 청구됩니다.',
      '데이터 관리·복구 · PC 자료는 외장 저장장치에 정기적으로 백업해 주세요. 당사 귀책 없이 생긴 데이터 손실이나 백업 미실시로 인한 손해는 책임지지 않습니다. 복구 요청 시 별도 비용이 발생할 수 있으며, 복구 가능 여부는 장비·데이터 상태에 따라 다릅니다.',
      '소프트웨어·저작권 · 직접 설치·사용하는 S/W는 정품 라이선스를 이용해 주세요. 당사가 제공하지 않은 S/W의 라이선스 관리와 고객 사용으로 생긴 저작권 분쟁은 고객 책임입니다.',
    ],
  },
};

function head(d: ConfDoc, img: string, title: string, small = false) {
  const top = small
    ? `<div class="top"><img src="${img}" alt="" style="width:11mm;height:11mm"><div class="nm" style="font-size:12pt">(주)퍼스트전산</div></div>`
    : `<div class="top"><img src="${img}" alt=""><div><div class="nm">(주)퍼스트전산</div><div class="tl">사람의 따뜻한 아이디어에 AI를 더해</div></div><div class="cc">고객센터 1522-1093</div></div>`;
  const rg = small ? '' : `<div class="rg"><small>지역</small>${esc(d.region) || '&nbsp;'}</div><div>${esc(d.term)}</div>`;
  return `${top}<div class="bar">${rg}<div class="t">${esc(title)}</div><div>현황표 순 <b>${esc(d.statusNo) || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</b></div></div>`;
}

// [IT 바꿈 P1] 회색 칸·사양 칸 글자 만들기(fill 이 있을 때만 불림)
function xVals(vals: FillVal[], tag: string, wide: boolean) {
  const t = tag ? `<em class="xh">${esc(tag)}</em>` : '';
  return vals.map((v) => (v === null || v === '' ? `${t}<b class="u${wide ? ' s' : ''}"></b>` : `<b>${t}${esc(v)}</b>`)).join('');
}
function xGray(f: FillItem | undefined, which: 'asset' | 'sn') {
  if (!f) return '';
  const out: string[] = [];
  if (which === 'sn' && f.outLine) out.push(`<span class="xl"><em class="xh">출고</em>${esc(f.outLine)}</span>`);
  if (f.ref) out.push(`<span class="xl">출고 명세 참조 (${f.ref}대)</span>`);
  else for (const line of (which === 'asset' ? f.assetLines : f.snLines) ?? []) out.push(`<span class="xl">${xVals(line, which === 'sn' ? f.snTag ?? '' : '', which === 'sn')}</span>`);
  return out.join('');
}
function xSpec(sales: string | undefined, c: FillSpecCell | undefined) {
  if (!c || !c.out) return esc(sales || '-'); // 영업 원본과 같은 글자
  if (!c.req) return `<b class="xo">${esc(c.out)}</b>`;
  return `${esc(c.req)}<em class="xa">→</em><b class="xo">${esc(c.out)}</b>`;
}

function itemRows(d: ConfDoc, items: ConfItem[], start: number, fill?: ConfirmFill) {
  return items
    .map((it, k) => {
      const n = start + k + 1;
      const f = fill?.items[start + k]; // [IT 바꿈 P1]
      if (d.kind === 'mfp') {
        const mono = /흑백/.test(it.cat);
        return `<tr class="first"><td class="n" rowspan="3">${n}</td><td>${esc(it.cat)}</td><td class="m">${esc(it.model)}${it.qty > 1 ? ` <span class="mini">× ${it.qty}대</span>` : ''}</td><td>${esc(it.maker)}</td><td>${esc(it.state)}</td>
<td class="v">${it.rent ? won(it.rent) : ''}</td><td class="v">${mono ? '-' : cnt(it.baseColor, '매')}</td><td class="v">${mono ? '-' : cnt(it.overColor, '원')}</td><td class="v">${cnt(it.baseMono, '매')}</td><td class="v">${cnt(it.overMono, '원')}</td></tr>
<tr class="w" data-max="17"><td><i>자산번호</i></td><td colspan="2"><i>S/N</i></td><td colspan="3"><i>여분 토너 (세트)</i></td><td colspan="3"><i>여분 폐통 (개)</i></td></tr>
<tr class="w w2" data-max="16"><td colspan="9" class="cn"><table><tr><td><i>개시 컬A4</i></td><td><i>컬A3</i></td><td><i>흑</i></td><td><i>HP (컬/흑 합계)</i></td></tr></table></td></tr>`;
      }
      const spec = hasSpec(it.cat)
        ? `<tr class="sp"><td><i>사양</i></td><td colspan="6"><div class="spec">${specKeys(it.cat)
            .map((k) => `<span><i>${k}</i>${xSpec(it.spec?.[k], f?.spec?.[k]) /* [IT 바꿈 P1] 원래 esc(it.spec?.[k] || '-') */}</span>`)
            .join('')}</div></td></tr>`
        : '';
      // [IT 바꿈 P1] 회색 줄 — 자산번호 칸·S/N 칸 뒤에 IT 값(fill 없으면 빈 글자)
      return `<tr class="first"><td class="n" rowspan="${spec ? 3 : 2}">${n}</td><td colspan="2">${esc(it.cat)}</td><td class="m">${esc(it.model)}</td><td>${esc(it.maker)}</td><td>${esc(it.state)}</td><td class="c">${it.qty || ''}</td><td class="v">${it.rent ? won(it.rent) : ''}</td></tr>
${spec}<tr class="w" data-max="12"><td colspan="2"><i>자산번호</i>${xGray(f, 'asset')}</td><td><i>S/N</i>${xGray(f, 'sn')}</td><td colspan="4"><i>설치장소 · 요청사항</i>${esc(it.place)}</td></tr>`;
    })
    .join('\n');
}

function itemTable(d: ConfDoc, items: ConfItem[], start: number, foot: boolean, cont = false, fill?: ConfirmFill) {
  const title = `납품 정보 · ${KIND_LABEL[d.kind]}${cont ? ' (계속)' : ''}`;
  const sub = d.kind === 'it' ? '회색 칸 = 납품·출고 시 직접 기재 · 사양 순서 CPU / RAM / SSD / HDD / 그래픽 / OS (노트북은 인치 추가)' : '회색 칸 = 납품·출고 시 직접 기재';
  const headRow =
    d.kind === 'mfp'
      ? `<colgroup><col style="width:6mm"><col style="width:27mm"><col><col style="width:16mm"><col style="width:16mm"><col style="width:21mm"><col style="width:17mm"><col style="width:15mm"><col style="width:17mm"><col style="width:15mm"></colgroup>
<thead><tr><th></th><th>품목구분</th><th>모델명</th><th>제조사</th><th>기기상태</th><th>월 렌탈료</th><th>컬러 기본</th><th>컬러 초과</th><th>흑백 기본</th><th>흑백 초과</th></tr></thead>`
      : `<colgroup><col style="width:6mm"><col style="width:20mm"><col style="width:18mm"><col><col style="width:20mm"><col style="width:16mm"><col style="width:12mm"><col style="width:24mm"></colgroup>
<thead><tr><th></th><th colspan="2">품목구분</th><th>모델명</th><th>제조사</th><th>기기상태</th><th>수량</th><th>월 렌탈료</th></tr></thead>`;
  const span = d.kind === 'mfp' ? [5, 5] : [6, 2];
  const rentSum = fill && !fill.money.rent ? '' : won(totalRent(d)); // [IT 바꿈 P2] 렌탈료가 안 왔으면 ₩0 대신 빈칸
  const tfoot = foot ? `<tfoot><tr><td colspan="${span[0]}" class="tl">합계 ${totalUnits(d)}대${d.items.length > FIRST_CAP ? ` (${d.items.length}품목)` : ''}${d.extra?.trim() ? `<span class="xt"><i>추가조건·혜택</i>${esc(d.extra)}</span>` : ''}</td><td colspan="${span[1]}" class="r">월 렌탈료 합계 <small class="vat">(VAT별도)</small> <b>${rentSum}</b></td></tr></tfoot>` : '';
  return `<div class="box"><h3>${title} <small>${sub}</small></h3><table class="it">${headRow}<tbody>${itemRows(d, items, start, fill)}</tbody>${tfoot}</table></div>`;
}

function page1(d: ConfDoc, img: string, more: number, fill?: ConfirmFill) {
  const it = d.kind === 'it';
  // [IT 바꿈 P2] 영업이 안 보낸 칸(fill.money 가 false)은 ₩0·자동 체크 대신 빈칸 — fill 없으면 원본 그대로
  const ct = fill && !fill.money.contract ? null : contractType(d.contractMail);
  const rent = totalRent(d);
  const dep = num(d.deposit);
  const noRent = !!fill && !fill.money.rent;
  const noDep = !!fill && !fill.money.deposit;
  const first = d.items.slice(0, FIRST_CAP);
  const supplies = [...d.supplies, ...Array(Math.max(1, 2 - d.supplies.length)).fill(null)].slice(0, Math.max(2, d.supplies.length));
  const n = NOTICE[d.kind];
  return `<div class="page${it ? ' it-p' : ''}">
${head(d, img, `${KIND_LABEL[d.kind]} 납품 확인서`)}
<div class="row2" style="grid-template-columns:1.5fr 1fr">
 <div class="box"><h3>거래처 정보</h3><table class="kv">
  <tr><th>상호</th><td class="co" colspan="3">${esc(d.company)}</td></tr>
  <tr><th>발주일</th><td>${esc(dayText(d.orderDate))}</td><th>납품일</th><td><b>${esc(dayText(d.deliveryDate))}</b></td></tr>
  <tr><th>유입담당</th><td>${esc(d.inflow)}</td><th>영업담당</th><td>${esc(d.sales)}</td></tr>
  ${it ? `<tr><th>업종</th><td colspan="3">${esc(d.industry)}</td></tr>` : `<tr><th>업종</th><td>${esc(d.industry)}</td><th>한조</th><td>${esc(d.hanjo)}${d.installCount ? ` <span class="mini">· 설치인원 ${esc(d.installCount)}</span>` : ''}</td></tr>`}
  <tr><th>설치주소</th><td class="emph" colspan="3">${esc(d.address)}</td></tr>
  <tr><th>특이사항</th><td class="emph" colspan="3" style="height:9mm">${esc(d.special)}</td></tr>
 </table></div>
 <div class="box sum"><h3 class="d">계약 · 청구 요약</h3>
  <div class="term"><span>계약기간</span><b>${d.months ? `${esc(d.months)}개월` : ''}</b></div>
  <div><span>계약서</span><span class="cbs"><span class="cb${ct === '전자' ? ' on' : ''}">전자</span><span class="cb${ct === '수기' ? ' on' : ''}">수기</span><span class="cb${ct === '확인서서명' ? ' on' : ''}">확인서서명</span></span></div>
  <div><span>월 렌탈료 <small>${totalUnits(d)}대 · 매월</small></span><b>${noRent ? '' : won(rent)}</b></div>
  <div><span>보증금 <small>1회성</small></span><b>${noDep ? '' : won(dep)}</b></div>
  <div><span>1회성 소모품·설치비</span><span class="mini">청구 시 확정</span></div>
  <div><span>결제특이</span><span>${fill && !fill.money.payNote ? '' : esc(d.payNote) || '-'}</span></div>
  <div class="tot"><span>최초 청구액 <small style="font-weight:400">(VAT별도 · 소모품 별도)</small></span><span>${noRent || noDep ? '' : won(rent + dep)}</span></div>
 </div>
</div>
${itemTable(d, first, 0, true, false, fill) /* [IT 바꿈] fill 넘김 */}
${more ? `<div class="note2">품목이 많아 <b>${d.items.length - FIRST_CAP}품목은 별지</b>에 이어서 적었습니다. 합계는 전체 기준입니다.</div>` : ''}
<div class="box"><h3>소모품 · 부속 · 1회성 <small>단가는 청구 시 확정</small></h3><table class="it">
 <thead><tr><th>품목</th><th style="width:15mm">수량</th><th style="width:22mm">청구/무상</th><th style="width:24mm">단가</th><th style="width:55mm">비고</th></tr></thead>
 <tbody>${supplies
   .map((s) => (s ? `<tr><td>${esc(s.name)}</td><td class="c">${esc(s.qty)}</td><td class="c">${esc(s.charge)}</td><td class="c">${s.price ? esc(s.price) : s.charge === '청구' ? '<span class="ph">청구 시</span>' : ''}</td><td>${esc(s.note)}</td></tr>` : '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>'))
   .join('')}</tbody></table></div>
<div class="box"><h3>거래처 연락처</h3><table class="kv">
 <tr><th>회사전화</th><td>${esc(d.phone)}</td><th>결제담당</th><td>${esc(d.payer)}</td><th>계약담당</th><td>${esc(d.contractor)}</td></tr>
 <tr><th>팩스</th><td>${esc(d.fax)}</td><th>${it ? 'IT담당' : '복합기담당'}</th><td>${esc(d.manager)}</td><th>현장상주자</th><td>${esc(d.resident)}</td></tr>
 <tr><th>계산서메일</th><td>${esc(d.taxMail)}</td><th>계약서메일</th><td colspan="3">${esc(d.contractMail)}</td></tr>
</table></div>
<div class="box warn"><h3 class="r">서명 전 반드시 확인</h3><div class="cols">
 <div><h5>안내사항</h5><ul>${n.guide.map((x) => `<li>${x}</li>`).join('')}</ul></div>
 <div><h5>주의사항</h5><ul>${n.caution.map((x) => `<li>${x}</li>`).join('')}</ul></div>
</div><div class="law">${LAW}</div></div>
<div class="box sign"><h3>확인란</h3><table class="kv">
 <tr><th>인수자</th><td></td><th>연락처</th><td></td></tr>
 <tr><th>현장확인</th><td colspan="3">${(it ? ['기기 작동 테스트 완료', '사용방법 설명 완료', 'S/W 설치 확인'] : ['기기 작동 테스트 완료', '사용방법 설명 완료', '개시 초카 확인', '라벨지 설명']).map((x) => `<span class="cb">${x}</span>`).join('')}</td></tr>
 <tr><th>공급자 서명</th><td class="big">서명</td><th>고객 서명</th><td class="big">서명 (인)</td></tr>
</table></div>
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 0}판 · ${esc(d.company)}${xStamp(fill) /* [IT 바꿈 P5] */}</span><span>고객 서명 대상은 1면</span></div>
</div>`;
}

function pageMore(d: ConfDoc, img: string, items: ConfItem[], start: number, k: number, total: number, fill?: ConfirmFill) {
  return `<div class="page${d.kind === 'it' ? ' it-p' : ''}">${head(d, img, `${KIND_LABEL[d.kind]} 납품 확인서 · 별지 ${total > 1 ? k : ''}`, true)}
<table class="kv box"><tr><th>상호</th><td class="co">${esc(d.company)}</td><th>납품일</th><td>${esc(dayText(d.deliveryDate))}</td></tr></table>
${itemTable(d, items, start, false, true, fill) /* [IT 바꿈] fill 넘김 */}
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 0}판 · ${esc(d.company)}${xStamp(fill) /* [IT 바꿈 P5] */}</span><span>별지 ${k}</span></div></div>`;
}

function page2(d: ConfDoc, img: string, fill?: ConfirmFill) {
  const mfp = d.kind === 'mfp';
  // [IT 바꿈 P4] 출고 준비자 = 처리자 이름 · 서명(서명은 손으로), 출고일 = 출고 날짜 — 비면 양식 그대로
  const prep = fill?.back.preparer
    ? `<td style="text-align:center;height:9mm"><b>${esc(fill.back.preparer)}</b> <span class="ph">· 서명</span></td>`
    : '<td class="ph" style="text-align:center;height:9mm">성명 · 서명</td>';
  const ship = fill?.back.shipDate ? `<td><b>${esc(fill.back.shipDate)}</b></td>` : '<td class="ph">YYYY-MM-DD</td>';
  return `<div class="page">${head(d, img, `출고 · 설치 확인서 (${KIND_LABEL[d.kind]})`, true)}
<table class="kv box"><tr><th>상호</th><td class="co">${esc(d.company)}</td><th>납품일</th><td>${esc(dayText(d.deliveryDate))}</td><th>납품대수</th><td><b>${totalUnits(d)}대</b></td></tr></table>
<div class="note2">기기별 <b>자산번호 · S/N${mfp ? ' · 개시 카운터 · 여분 토너/폐통' : ''}</b>은 <b>1면 '납품 정보'에 한 번만</b> 기재합니다. 2면은 확인·서명만 합니다.</div>
<div class="sec"><span>출고 정보</span></div>
<div class="box"><h3>출고 준비 · 검수 확인</h3>
 <div class="lead">1면 납품 정보의 <b>모델·자산번호·S/N${mfp ? '·출고 초카·여분' : ''}</b>과 소모품 장착 내역을 출고 시점에 확인하였으며, <b>출고 준비가 완료되었음</b>을 확인합니다.</div>
 <table class="kv">
  <tr><th>출고 준비자</th>${prep}<th>출고일</th>${ship}</tr>
  <tr><th>출고 담당업체</th><td colspan="3" class="ph">내부(운영지원) 또는 협력사명</td></tr>
  <tr><th>검수자</th><td class="ph" style="text-align:center;height:9mm">성명 · 서명</td><th>검수일</th><td class="ph">YYYY-MM-DD</td></tr>
 </table></div>
<div class="sec r"><span>설치 정보</span></div>
<div class="box"><h3 class="r">설치 결과</h3><table class="kv">
 <tr><th>납품담당</th><td></td><th>설치담당</th><td></td><th>설치일</th><td></td></tr>
 <tr><th>설치인원</th><td>___명</td><th>소요시간</th><td>____분</td><th>예상 PC</th><td></td></tr>
</table></div>
<div class="box"><h3 class="r">셋팅 · 완료 체크</h3><table class="kv">
 ${
   mfp
     ? `<tr><th>이메일 카운터</th><td><span class="cb">셋팅 완료</span><span class="cb">해당없음</span></td><th>한조 셋팅</th><td><span class="cb">셋팅 완료</span><span class="cb">해당없음</span></td></tr>`
     : `<tr><th>OS·계정</th><td><span class="cb">설정 완료</span><span class="cb">해당없음</span></td><th>S/W 설치</th><td><span class="cb">설치 완료</span><span class="cb">해당없음</span></td></tr>`
 }
 <tr><th>상태 체크</th><td colspan="3"><span class="mini">내부</span> <span class="cb">이상무</span><span class="cb">이상</span> &nbsp; <span class="mini">외부</span> <span class="cb">이상무</span><span class="cb">이상</span></td></tr>
</table></div>
<div class="box"><h3 class="r">설치 특이사항</h3><div style="height:14mm"></div></div>
<div class="box"><h3 class="r">설치 완료 확인</h3>
 <div class="lead">설치 및 작동 테스트를 완료하고${mfp ? ', <b>1면 개시 초카를 설치 테스트 완료 후 값으로 기재</b>하였으며' : '하였으며'}, 고객에게 사용방법을 설명하였음을 확인합니다.</div>
 <table class="kv"><tr><th>설치 담당자</th><td class="ph" style="text-align:center;height:9mm">성명 · 서명</td><th>완료일시</th><td class="ph">YYYY-MM-DD &nbsp; : </td></tr></table></div>
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 0}판 · ${esc(d.company)}${xStamp(fill) /* [IT 바꿈 P5] */}</span><span>출고·설치 (내부)</span></div></div>`;
}

// [IT 바꿈 P5] 꼬리 왼쪽 끝 " · IT 기재 MM-DD HH:mm 이름" — 영업이 뽑은 빈 종이와 구별(D25)
function xStamp(fill?: ConfirmFill) {
  return fill?.stamp ? ` · ${esc(fill.stamp)}` : '';
}

// [IT 바꿈 P3] 출고 명세(대수별) 장 — 별지 뒤·2면 앞. 1면 납품 정보의 별첨, 고객 서명 칸 없음. 안 채운 대수는 빈 줄(손으로)
function attachCell(v: string, req: string) {
  return `${esc(v)}${req ? `<small>요청 ${esc(req)}</small>` : ''}`;
}
function attachRow(r: FillAttachRow) {
  const sn = r.sn ? `${r.snTag ? `<em class="xh">${esc(r.snTag)}</em>` : ''}<b>${esc(r.sn)}</b>` : '';
  return `<tr${r.asset || r.sn ? '' : ' class="blank"'}><td class="c">${r.no}</td><td>${esc(r.item)}</td><td>${attachCell(r.maker, r.makerReq)}</td><td>${attachCell(r.model, r.modelReq)}</td><td>${r.asset ? `<b>${esc(r.asset)}</b>` : ''}</td><td>${sn}</td><td>${attachCell(r.spec, r.specReq)}</td></tr>`;
}
/** 한 줄의 높이 몫 — 요청 줄·긴 키·긴 사양은 1.5줄 */
function attachWeight(r: FillAttachRow) {
  return r.makerReq || r.modelReq || r.specReq || r.sn.length > 22 || r.spec.length > 34 ? 1.5 : 1;
}
function pageAttach(d: ConfDoc, img: string, rows: FillAttachRow[], k: number, total: number, fill: ConfirmFill) {
  return `<div class="page it-p">${head(d, img, `${KIND_LABEL[d.kind]} 납품 확인서 · 출고 명세 ${total > 1 ? `${k}/${total}` : ''}`, true)}
<table class="kv box"><tr><th>상호</th><td class="co">${esc(d.company)}</td><th>납품일</th><td>${esc(dayText(d.deliveryDate))}</td></tr></table>
<div class="box"><h3>출고 명세 · 대수별 <small>1면 납품 정보의 별첨 · 빈 칸 = 출고 시 직접 기재 · 다르면 아래 작게 영업 요청</small></h3><table class="it xs">
<colgroup><col style="width:8mm"><col style="width:30mm"><col style="width:18mm"><col><col style="width:21mm"><col style="width:36mm"><col style="width:46mm"></colgroup>
<thead><tr><th>순</th><th>품목</th><th>제조사</th><th>모델명</th><th>자산번호</th><th>S/N</th><th>출고사양</th></tr></thead>
<tbody>${rows.map(attachRow).join('')}</tbody></table></div>
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 0}판 · ${esc(d.company)}${xStamp(fill) /* [IT 바꿈 P5] */}</span><span>출고 명세 ${k} · 1면 납품 정보의 별첨</span></div></div>`;
}
function attachPages(d: ConfDoc, img: string, fill: ConfirmFill): string[] {
  const rows = fill.attach ?? [];
  const chunks: FillAttachRow[][] = [];
  let cur: FillAttachRow[] = [];
  let used = 0;
  for (const r of rows) {
    const w = attachWeight(r);
    if (cur.length && used + w > ATTACH_CAP) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(r);
    used += w;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c, i) => pageAttach(d, img, c, i + 1, chunks.length, fill));
}

// [IT 바꿈 P6] 문서 끝 스크립트(fill 이 있을 때만) — sandbox iframe(같은 출처 권한 없음) 안에서 돎
//  ⓐ 부모 창(window.parent)이 보낸 type 'sales-confirm:print' 만 받아 window.print()
//  ⓑ 그린 뒤(양식 높이 맞춤 다음, load) 장마다 꼬리가 종이 밖으로 밀렸는지 재서, 넘친 장이 있으면 부모에게 'sales-confirm:overflow'
//     (items = 넘친 장의 품목 순서 0부터 — 1면·별지 품목 번호 칸 td.n 의 글자에서 읽음(원래 칸이라 표시 안 바꿈), pages = 넘친 장 1부터)
//     + 늘 'sales-confirm:size'(문서 전체 높이)
function p6Script() {
  return `<script>(function(){var T='*',S='${IT_PRINT_MSG_SOURCE}';window.addEventListener('message',function(e){if(e.source!==window.parent)return;var m=e.data;if(m&&m.type==='${IT_PRINT_MSG_PRINT}')window.print();});function send(o){o.source=S;try{window.parent.postMessage(o,T);}catch(_){}}function check(){var items=[],pages=[];document.querySelectorAll('.page').forEach(function(pg,i){var foot=pg.querySelector('.foot');if(!foot)return;if(foot.getBoundingClientRect().bottom>pg.getBoundingClientRect().bottom+1){pages.push(i+1);pg.querySelectorAll('td.n').forEach(function(td){var n=parseInt(td.textContent,10);if(n>0&&items.indexOf(n-1)<0)items.push(n-1);});}});if(pages.length)send({type:'${IT_PRINT_MSG_OVERFLOW}',items:items,pages:pages});var b=document.body;send({type:'${IT_PRINT_MSG_SIZE}',height:Math.ceil(Math.max(b.getBoundingClientRect().height,b.scrollHeight))});}if(document.readyState==='complete')setTimeout(check,0);else window.addEventListener('load',function(){setTimeout(check,0);});})();</script>`;
}

/**
 * 확인서 HTML 전체
 * @param origin 이미지 주소 앞부분 (인쇄 새 창은 절대 주소가 필요)
 * @param withBack 2면(출고·설치) 포함
 * @param fill [IT 바꿈] IT 값 채움(printFill.ts) — 없으면 영업 원본과 글자까지 같은 HTML
 */
export function renderConfirm(d: ConfDoc, origin = '', withBack = true, fill?: ConfirmFill): string {
  const img = `${origin}/confirm/rabbit.png`;
  const rest = d.items.slice(FIRST_CAP);
  const chunks: ConfItem[][] = [];
  for (let i = 0; i < rest.length; i += MORE_CAP) chunks.push(rest.slice(i, i + MORE_CAP));
  const pages = [
    page1(d, img, chunks.length, fill),
    ...chunks.map((c, k) => pageMore(d, img, c, FIRST_CAP + k * MORE_CAP, k + 1, chunks.length, fill)),
    ...(fill?.attach?.length ? attachPages(d, img, fill) : []), // [IT 바꿈 P3]
    ...(withBack ? [page2(d, img, fill)] : []),
  ];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(`${d.no || '확인서'} ${d.company}`)}</title><style>${CSS}${fill ? FILL_CSS : '' /* [IT 바꿈 P1·P3] */}</style></head><body>${pages.join('\n')}<script>(function(){function fill(){document.querySelectorAll('.page').forEach(function(pg){var rows=[].slice.call(pg.querySelectorAll('tr.w'));var foot=pg.querySelector('.foot');if(!rows.length||!foot)return;var prev=foot.previousElementSibling;var slack=foot.getBoundingClientRect().top-prev.getBoundingClientRect().bottom-22;if(slack<=2)return;var add=slack/rows.length;rows.forEach(function(r){var td=r.querySelector('td');var h=td.getBoundingClientRect().height+add;var max=(+r.getAttribute('data-max')||40)*3.78;r.querySelectorAll('td').forEach(function(c){c.style.height=Math.min(h,max)+'px'})})})}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fill);else fill();})();</script>${fill ? p6Script() : '' /* [IT 바꿈 P6] */}</body></html>`;
}
