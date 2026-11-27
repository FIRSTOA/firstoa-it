/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것 · IT 칸 표시 속성(P 자리)만 덧붙임]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/confirmDoc.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 1a965ec1d98c78fc2d43da58300737bcee2edc89 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// P 자리 = marks 인자가 참일 때만 붙는 IT 칸 표시 속성(data-it…, 이름·글자는 ./itFill.ts 한 곳). 자리마다 `[IT 표시]` 주석.
//   marks 없이(기본 false) 부르면 영업 원본과 글자까지 같은 HTML. 영업이 표시를 직접 붙이면 P 자리는 없애고 그냥 사본으로.
// =====================================================================================
/**
 * 납품 확인서 출력 양식 (HTML 한 장) — 화면 미리보기(iframe)와 인쇄 창이 같은 것을 씀
 *  1면 = 고객 서명용 (복합기 / IT 따로) · 별지 = 품목이 1면에 다 안 들어갈 때 · 2면 = 출고·설치 확인 (내부)
 *  인쇄 안전: 종이 여백 6mm·8mm 안에만 그림, 7.4pt 미만 글씨·연한 색 금지 (출력 시 잘림·깨짐 경험)
 *  양식 색·구성은 사용자 확정 시안(2026-11-18) 그대로 — 바꿀 때는 출력해서 확인할 것
 */
import { contractType, dayText, periodText, hasSpec, KIND_LABEL, num, specKeys, totalRent, totalUnits, type ConfDoc, type ConfItem } from './confirm';
import { titleConf } from './confTitle';
import { itAttrs, itBodyAttrs, itStamp } from './itFill'; // [IT 표시]

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const won = (n: number) => `₩${Math.round(n).toLocaleString()}`;
/** 소모품 단가: 숫자면 ₩30,000 · 글이 섞이면 숫자만 쉼표 ('30000(VAT별도)' → ₩30,000(VAT별도)) */
const priceText = (v: string) => { const m = /^\s*₩?\s*([\d,]+)\s*원?\s*(.*)$/.exec(v ?? ''); const n = m ? Number(m[1].replace(/,/g, '')) : 0; return m && n ? `${won(n)}${m[2] ? (/^[(（]/.test(m[2]) ? '' : ' ') + m[2] : ''}` : v; };
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
.ttl { display:flex; border:1px solid var(--line); font-size:8pt; line-height:1.35; min-height:6mm; flex:1; margin-left:4mm; align-self:stretch; }
.ttl b { background:var(--g); color:#fff; padding:0 3mm; display:flex; align-items:center; white-space:nowrap; }
.ttl span { padding:.8mm 2.5mm; flex:1; display:flex; align-items:center; font-weight:700; }
.kv td.hj { font-size:9.5pt; font-weight:800; }
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
.s2 td.u { text-align:right; color:#666; padding-right:2.5mm; }
.s2 th, .s2 td { height:6.8mm; }
.it-p .s2 th, .it-p .s2 td { height:6.4mm; }
.s2 tr.rcv th, .s2 tr.rcv td { height:8.4mm; border-top:1.5px solid var(--gd, #333); }
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
.it-p .it tr.w td { height:8mm; } /* 수기 칸 — 줄이지 말 것 (사용자 2026-11-24: 작으면 쓰기 힘듦) */
.it-p .it tr.sp td { height:7mm; }
/* IT 요청사항 / 출고시 기재 (2026-11-25) */
.it-p .it thead th.out { background:#eef4fb; }
.it-p .it thead th small { font-weight:600; color:#666; font-size:7.4pt; }
.it-p .it td.rq { vertical-align:top; padding:1.2mm 2mm; background:#fafbf9; border-right:1.5px solid #9fb2c8; white-space:normal; }
.it-p .it .rq-m { font-weight:800; font-size:9.8pt; }
.it-p .it .rq-s { font-size:8.4pt; color:#333; margin-top:.4mm; }
.it-p .it .rq-spec { margin-top:.8mm; font-size:8.8pt; font-weight:700; line-height:1.4; word-break:break-all; }
.it-p .it .rq-spec i { display:block; font-weight:600; }
.it-p .it.rent2 td { height:6mm; white-space:normal; } .it-p .it.rent2 td.m { font-weight:800; font-size:9.2pt; }
.it-p .it.rent2 tfoot td { background:var(--gl); font-weight:800; }
.it-p .it .rq-spec i, .it-p .it .rq-p i { font-style:normal; color:#666; font-size:7.4pt; margin-right:1mm; }
.it-p .it .rq-p { margin-top:.8mm; font-size:8.2pt; }
.it-p .it tr.iu td { height:8mm; background:#fff; border-top:1px dashed #b9c0b6; }
.it-p .it tr.iu.first td { border-top:1px solid var(--line); }
.it-p .it tr.sw td { height:6.4mm; font-size:8pt; background:#f6f8fa; }
.it-p .it tr.sw td.swl { text-align:center; font-weight:700; color:#555; }
.it-p .it tr.ic td.cpt { padding:0; vertical-align:top; }
.it-p .it .cm { display:grid; grid-template-columns:22mm 40mm 1fr; border-bottom:1px solid var(--line); }
.it-p .it .cm span { height:7mm; padding:.4mm 1.5mm; border-right:1px solid #dfe3dc; display:block; }
.it-p .it .uc span { height:7.6mm; padding:.4mm 1.5mm; border-right:1px solid #dfe3dc; display:block; } /* 손으로 적는 칸 — 7.5mm 아래로 줄이지 말 것 */
.it-p .it .cm span:last-child { border-right:0; }
.it-p .it .cm i, .it-p .it .uc i { font-style:normal; font-size:7.2pt; color:#555; }
.it-p .it .ug { display:grid; }
.it-p .it .uc { display:grid; grid-template-columns:6mm 1fr 1.5fr; border-bottom:1px dashed #b9c0b6; border-right:1px solid #dfe3dc; }
.it-p .it .uc b { font-size:8pt; color:#666; text-align:center; padding-top:1mm; border-right:1px solid #eee; }
.kv.ct6 { table-layout:fixed; width:100%; }
.kv td.per { white-space:nowrap; overflow:hidden; } /* 계약기간 칸 46mm · 보증금 24mm (colgroup) */
.kv td.per .pd { font-size:7.8pt; font-weight:600; letter-spacing:-.2px; }
.kv.ct6 th { width:auto !important; }
.kv.ct6 td { overflow:hidden; word-break:keep-all; overflow-wrap:anywhere; font-size:9pt !important; }
.it-p .it .st { display:inline-block; font-size:8pt; font-weight:800; background:#eef2f7; border:1px solid #c5cfdc; border-radius:3px; padding:0 1.2mm; margin-left:1mm; }
.it-p .spec span { font-size:9.4pt; }
.it tr.w2 > td { height:9mm; border-top:1px dotted #b9c0b6; padding:0; }
.it td.cn table { height:100%; table-layout:fixed; }
.it td.cn td { border:0; border-left:1px solid var(--line); vertical-align:top; padding:.5mm 1.4mm; background:#f3f4f1; height:auto; }
.it td.cn td:first-child { border-left:0; }
.it-p .note2 { padding:.8mm 2.5mm; }
`;

/* ───────── 문구 (사용자 제공 2026-11-18 · 줄임 허용, 필수 내용 삭제 금지) ───────── */
const LAW = '본 확인서에 서명하면 견적서의 임대 조건과 본 확인서에 명시된 조건에 동의한 것으로 보며,<br>별도 계약서를 작성하지 않은 경우에도 해당 합의는 법적 효력을 갖습니다.';
const PENALTY = '위약금 = 해지 직전 3개월 평균 월 임대료 × 잔여 임대 개월 수 × 50%';
const DEPOSIT = '보증금은 납품 전 선납입니다. 고객 사유로 납품 당일 일방적으로 취소하거나 기기 수령 후 철수를 요청하는 경우, 출고 준비 및 물류 이동 비용이 발생하므로 보증금은 반환되지 않습니다.';
export const NOTICE = {
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

/** 맨 위 '제목' 줄 — 카톡에 함께 올리는 글 (confTitle) */
export const ttl = (t: string) => (t ? `<div class="ttl"><b>제목</b><span>${esc(t)}</span></div>` : '');

/** 현장/단기 납품 확인서 안내·주의 (사용자 ERP 현장 양식 2026-11-24) — 일반과 다른 점: 의무사용·잔여기간 100%·철수 요청 */
const SITE_NOTICE = {
  mfp: {
    guide: [
      '현장 의무사용 · 단기현장(2년 미만)·장기현장(2년 이상) 모두 견적서 조건의 기간대로 사용해야 하며, 협의 기간 안에 철수하면 남은 개월 수의 임대료 전액이 청구됩니다.',
      '임대 기간이 5일~15일 미만이면 임대료의 50%, 15일 이상이면 100%가 청구됩니다.',
      '채무 즉시 정산 · 미납 임대료 등 채무가 있으면 전액을 즉시 지급해야 합니다. 고객 귀책으로 해지되면 최근 3개월 평균 임대료 × 잔여 개월 수의 100%가 청구됩니다.',
    ],
    caution: [
      '고객 과실로 임대 장비가 파손된 경우, 파손 비용이 별도로 청구됩니다.',
      '라벨지 사용 방법은 납품 시 꼭 설명드립니다.',
      '스캔·프린터 드라이버 설치는 원격 지원을 원칙으로 하며, 방문 요청 시 출장비가 청구될 수 있습니다.',
    ],
  },
  it: {
    guide: [
      '현장 의무사용 · 단기현장(2년 미만)·장기현장(2년 이상) 모두 견적서 조건의 기간대로 사용해야 하며, 협의 기간 안에 철수하면 남은 개월 수의 임대료 전액이 청구됩니다.',
      '임대 기간이 5일~15일 미만이면 임대료의 50%, 15일 이상이면 100%가 청구됩니다.',
      '채무 즉시 정산 · 미납 임대료 등 채무가 있으면 전액을 즉시 지급해야 합니다. 고객 귀책으로 해지되면 최근 3개월 평균 임대료 × 잔여 개월 수의 100%가 청구됩니다.',
    ],
    caution: [
      '소프트웨어 · IT 임대에서 소프트웨어의 저작권·법적 문제는 책임지지 않습니다.',
      '데이터 · PC 자료는 외장 저장장치에 따로 저장해 주세요. 사용 중 생긴 데이터 손실과 복구할 수 없는 파일은 책임지지 않으며, 복구는 별도 비용입니다.',
      '고객 과실로 임대 장비가 파손된 경우, 파손 비용이 별도로 청구됩니다.',
    ],
  },
};
/** 현장 유의사항 (빨간 줄) */
const SITE_WARN = '철수일 하루 전 또는 당일 급작스러운 철수 요청 시, 추가 비용이 유상으로 청구될 수 있습니다 (최소 2일 전 사전 요청 필수)';

function head(d: ConfDoc, img: string, title: string, small = false, ttlText = '') {
  const top = small
    ? `<div class="top"><img src="${img}" alt="" style="width:11mm;height:11mm"><div class="nm" style="font-size:12pt">(주)퍼스트전산</div></div>`
    : ttlText
      ? `<div class="top"><img src="${img}" alt=""><div><div class="nm">(주)퍼스트전산</div><div class="tl">고객센터 1522-1093</div></div>${ttl(ttlText)}</div>`
      : `<div class="top"><img src="${img}" alt=""><div><div class="nm">(주)퍼스트전산</div><div class="tl">사람의 따뜻한 아이디어에 AI를 더해</div></div><div class="cc">고객센터 1522-1093</div></div>`;
  const rg = small ? '' : `<div class="rg"><small>지역</small>${esc(d.region) || '&nbsp;'}</div><div>${esc(d.term)}</div>`;
  return `${top}<div class="bar">${rg}<div class="t">${esc(title)}</div><div>현황표 순 <b>${esc(d.statusNo) || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</b></div></div>`;
}

function itemRows(d: ConfDoc, items: ConfItem[], start: number, compact = false, marks = false /* [IT 표시] */) {
  return items
    .map((it, k) => {
      const n = start + k + 1;
      if (d.kind === 'mfp') {
        const mono = /흑백/.test(it.cat);
        return `<tr class="first"><td class="n" rowspan="3">${n}</td><td>${esc(it.cat)}</td><td class="m">${esc(it.model)}${it.qty > 1 ? ` <span class="mini">× ${it.qty}대</span>` : ''}</td><td>${esc(it.maker)}</td><td>${esc(it.state)}</td>
<td class="v">${it.rent ? won(it.rent) : ''}</td><td class="v">${mono ? '-' : cnt(it.baseColor, '매')}</td><td class="v">${mono ? '-' : cnt(it.overColor, '원')}</td><td class="v">${cnt(it.baseMono, '매')}</td><td class="v">${cnt(it.overMono, '원')}</td></tr>
<tr class="w" data-max="17"><td><i>자산번호</i></td><td colspan="2"><i>S/N</i></td><td colspan="3"><i>여분 토너 (세트)</i></td><td colspan="3"><i>여분 폐통 (개)</i></td></tr>
<tr class="w w2" data-max="16"><td colspan="9" class="cn"><table><tr><td><i>개시 컬A4</i></td><td><i>컬A3</i></td><td><i>흑</i></td><td><i>HP (컬/흑 합계)</i></td></tr></table></td></tr>`;
      }
      // IT (사용자 2026-11-25): 왼쪽 '요청사항'(영업이 요청한 품목·사양) · 오른쪽 '출고시 기재'(대수만큼 줄 — 제조사·모델명·자산번호·시리얼·출고 사양)
      //  출고 칸은 손으로 적는 칸 (tr.w — 남는 자리가 있으면 출력 때 자동으로 넓어짐) · 나중에 IT ERP가 채울 수도 있음
      const units = Math.max(1, Number(it.qty) || 1);
      const swRow = hasSpec(it.cat) ? 1 : 0; // 소프트웨어 줄은 PC·노트북에만 (모니터 등은 없음)
      // 요청 사양: 슬래시 한 줄 (예: 윈11프로/I5-14400/32GB/512GB/내장그래픽 — 인치 · OS · CPU · RAM · SSD · HDD · 그래픽 순)
      const req = ['인치', 'OS', 'CPU', 'RAM', 'SSD', 'HDD', '그래픽']
        .map((k) => (it.spec?.[k] ?? '').trim())
        .filter(Boolean)
        .map(esc)
        .join('/');
      const left = `<td class="rq" rowspan="${units + swRow}"><div class="rq-m">${esc(it.model || it.cat)} <span class="st">${esc(/중고|리퍼/.test(it.state) ? '리퍼' : it.state || '새기기')}</span></div>
<div class="rq-s">수량 <b>${units}대</b></div>
${req ? `<div class="rq-spec"><i>요청 사양</i>${req}</div>` : ''}${it.place ? `<div class="rq-p"><i>설치·요청</i>${esc(it.place)}</div>` : ''}</td>`;
      if (compact) {
        // 촘촘한 모양 (대수가 많을 때 · 별지 없이 한 장 — 사용자 2026-11-25): 제조사·모델명·출고 사양은 품목마다 한 번,
        //  자산번호·시리얼은 대마다 작은 칸을 2단(17대부터 3단) — 칸 높이는 손으로 적게 8mm 그대로
        const cols = units > 6 ? 3 : 2; // 7대부터 3단
        const cells = Array.from({ length: units }, (_, u) => `<div class="uc"><b>${u + 1}</b><span${itAttrs(marks, 'asset', n, u + 1) /* [IT 표시] */}><i>자산번호</i></span><span class="sn"${itAttrs(marks, 'sn', n, u + 1) /* [IT 표시] */}><i>시리얼</i></span></div>`).join('');
        return `<tr class="first ic"><td class="n" rowspan="${1 + swRow}">${n}</td>${left.replace(`rowspan="${units + swRow}"`, `rowspan="${1 + swRow}"`)}<td colspan="5" class="cpt"><div class="cm"><span${itAttrs(marks, 'maker', n) /* [IT 표시] */}><i>제조사</i></span><span${itAttrs(marks, 'model', n) /* [IT 표시] */}><i>모델명</i></span><span class="w"${itAttrs(marks, 'spec', n) /* [IT 표시] */}><i>출고 사양</i></span></div><div class="ug" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div></td></tr>${
          swRow ? `<tr class="sw"><td class="swl">소프트웨어</td><td colspan="4" class="swr"${itAttrs(marks, 'sw', n) /* [IT 표시] */}><span class="cb">WIN</span><span class="cb">오피스</span><span class="cb">한글</span><span class="cb">기타 프로그램</span> ____________________</td></tr>` : ''
        }`;
      }
      const rows = Array.from({ length: units }, (_, u) =>
        `<tr class="w iu${u === 0 ? ' first' : ''}" data-max="11">${u === 0 ? `<td class="n" rowspan="${units + swRow}">${n}</td>${left}` : ''}<td${itAttrs(marks, 'maker', n, u + 1)}></td><td${itAttrs(marks, 'model', n, u + 1)}></td><td${itAttrs(marks, 'asset', n, u + 1)}></td><td${itAttrs(marks, 'sn', n, u + 1)}></td><td${itAttrs(marks, 'spec', n, u + 1)}></td></tr>` /* [IT 표시] 빈칸 5개 */,
      ).join('');
      return !swRow ? rows : `${rows}<tr class="sw"><td class="swl">소프트웨어</td><td colspan="4" class="swr"${itAttrs(marks, 'sw', n) /* [IT 표시] */}><span class="cb">WIN</span><span class="cb">오피스</span><span class="cb">한글</span><span class="cb">기타 프로그램</span> ____________________</td></tr>`;
    })
    .join('\n');
}

function itemTable(d: ConfDoc, items: ConfItem[], start: number, foot: boolean, cont = false, compact = false, marks = false /* [IT 표시] */) {
  const title = `납품 정보 · ${KIND_LABEL[d.kind]}${cont ? ' (계속)' : ''}`;
  const sub = d.kind === 'it' ? '왼쪽 = 요청한 품목·사양 · 오른쪽 = 실제 출고 기기 (출고 때 기재 — 요청과 다를 수 있음)' : '회색 칸 = 납품·출고 시 직접 기재';
  const headRow = compact && d.kind === 'it'
    ? `<colgroup><col style="width:6mm"><col style="width:58mm"><col style="width:15mm"><col style="width:25mm"><col style="width:18mm"><col style="width:30mm"><col></colgroup>
<thead><tr class="h1"><th></th><th>요청사항 <small>(영업 작성)</small></th><th colspan="5" class="out">출고시 기재사항 <small>(IT팀 · 제조사·모델·사양은 품목마다 한 번, 자산번호·시리얼은 대마다)</small></th></tr></thead>`
    : d.kind === 'mfp'
      ? `<colgroup><col style="width:6mm"><col style="width:27mm"><col><col style="width:16mm"><col style="width:16mm"><col style="width:21mm"><col style="width:17mm"><col style="width:15mm"><col style="width:17mm"><col style="width:15mm"></colgroup>
<thead><tr><th></th><th>품목구분</th><th>모델명</th><th>제조사</th><th>기기상태</th><th>월 렌탈료</th><th>컬러 기본</th><th>컬러 초과</th><th>흑백 기본</th><th>흑백 초과</th></tr></thead>`
      : `<colgroup><col style="width:6mm"><col style="width:58mm"><col style="width:15mm"><col style="width:25mm"><col style="width:18mm"><col style="width:30mm"><col></colgroup>
<thead><tr class="h1"><th rowspan="2"></th><th rowspan="2">요청사항 <small>(영업 작성)</small></th><th colspan="5" class="out">출고시 기재사항 <small>(IT팀 · 대마다 한 줄)</small></th></tr>
<tr class="h2"><th class="out">제조사</th><th class="out">모델명</th><th class="out">자산번호</th><th class="out">시리얼번호</th><th class="out">출고 사양</th></tr></thead>`;
  const span = d.kind === 'mfp' ? [5, 5] : [3, 4];
  const tfoot = !foot
    ? ''
    : d.kind === 'it'
      ? `<tfoot><tr><td colspan="7" class="tl">합계 ${totalUnits(d)}대${d.items.length > 1 ? ` (${d.items.length}품목)` : ''} <small class="vat">· 월 렌탈료는 위 '임대료'</small></td></tr></tfoot>`
      : `<tfoot><tr><td colspan="${span[0]}" class="tl">합계 ${totalUnits(d)}대${d.items.length > 1 ? ` (${d.items.length}품목)` : ''}</td><td colspan="${span[1]}" class="r">월 렌탈료 합계 <small class="vat">(VAT별도)</small> <b>${won(totalRent(d))}</b></td></tr></tfoot>`;
  return `<div class="box"><h3>${title} <small>${sub}</small></h3><table class="it">${headRow}<tbody>${itemRows(d, items, start, compact, marks /* [IT 표시] */)}</tbody>${tfoot}</table></div>`;
}

/** 1면 · 별지 나누기 — 복합기는 품목 수(FIRST_CAP·MORE_CAP), IT는 줄 수(품목마다 대수 + 소프트웨어 1줄) */
const IT_FIRST_ROWS = 8;
const IT_MORE_ROWS = 26;
export function splitPages(d: ConfDoc): ConfItem[][] {
  if (d.kind !== 'it') {
    const out = [d.items.slice(0, FIRST_CAP)];
    for (let i = FIRST_CAP; i < d.items.length; i += MORE_CAP) out.push(d.items.slice(i, i + MORE_CAP));
    return out;
  }
  // IT: 대마다 한 줄(제조사·모델명·자산번호·시리얼·사양 — 사용자 2026-11-25 양식) · 줄이 1면 기준을 넘는 품목은 별지로
  const cost = (it: ConfItem) => Math.max(1, Number(it.qty) || 1) + (hasSpec(it.cat) ? 1 : 0);
  const out: ConfItem[][] = [[]];
  let used = 0;
  for (const it of d.items) {
    const cap = out.length === 1 ? IT_FIRST_ROWS : IT_MORE_ROWS;
    if (out[out.length - 1].length && used + cost(it) > cap) (out.push([]), (used = 0));
    out[out.length - 1].push(it);
    used += cost(it);
  }
  return out;
}
/** IT 줄 수(대수 + 소프트웨어 줄)가 1면 기준을 넘으면 촘촘한 모양 */
export const itCompact = (d: ConfDoc) => d.kind === 'it' && d.items.reduce((s, it) => s + Math.max(1, Number(it.qty) || 1) + (hasSpec(it.cat) ? 1 : 0), 0) > IT_FIRST_ROWS;

/** 계약기간: '3년 [26.11.23~29.11.22]' → 기간은 크게 · 날짜는 작게 한 줄 (칸 넘어 두 줄 되던 것 — 2026-11-25) */
const periodHtml = (t: string) => {
  const m = /^(.*?)\s*(\[[^\]]*\])\s*$/.exec(t ?? '');
  return m ? `${esc(m[1])} <small class="pd">${esc(m[2])}</small>` : esc(t);
};

/** 연락처 칸: 전화번호는 한 덩어리로 (010-0000- 뒤에서 줄이 끊기지 않게 — 2026-11-25) */
const tel = (v: string) => esc(v).replace(/(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/g, '<span style="white-space:nowrap">$1</span>');

/** IT 임대료 상자 — 월 렌탈료는 위쪽에 따로 (요청사항 칸엔 금액 없음 · 사용자 2026-11-25) */
function rentBox(d: ConfDoc): string {
  const its = d.items.filter((i) => i.model || i.cat);
  if (!its.length) return '';
  const rows = its
    .map((i) => {
      const q = Math.max(1, Number(i.qty) || 1);
      const per = i.rent ? Math.round(i.rent / q) : 0;
      return `<tr><td class="m">${esc(i.model || i.cat)} <span class="st">${esc(/중고|리퍼/.test(i.state) ? '리퍼' : i.state || '새기기')}</span></td><td class="r">${per ? won(per) : ''}</td><td class="c">${q}</td><td class="r"><b>${i.rent ? won(i.rent) : ''}</b></td></tr>`;
    })
    .join('');
  return `<div class="box"><h3>임대료 <small>VAT 별도 · 매월</small></h3><table class="it rent2"><colgroup><col><col style="width:30mm"><col style="width:16mm"><col style="width:32mm"></colgroup>
<thead><tr><th>품목</th><th>대당 월 렌탈료</th><th>수량</th><th>월 합계</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="2">합계</td><td class="c">${totalUnits(d)}대</td><td class="r"><b>${won(totalRent(d))}</b></td></tr></tfoot></table></div>`;
}

function page1(d: ConfDoc, img: string, more: number, first: ConfItem[] = d.items.slice(0, FIRST_CAP), marks = false /* [IT 표시] */) {
  const it = d.kind === 'it';
  const ct = contractType(d.contractMail);
  const dep = num(d.deposit);
  // 소모품 상자는 적은 게 있을 때만 (사용자 2026-11-24 — 없으면 아예 안 보이고 그 자리는 다른 칸이 넓게 씀)
  const supplies = d.supplies.filter((s) => s.name?.trim());
  const site = d.term === '현장/단기';
  const n = (site ? SITE_NOTICE : NOTICE)[d.kind];
  return `<div class="page${it ? ' it-p' : ''}${site ? ' t-site' : ''}">
${head(d, img, `${KIND_LABEL[d.kind]} 납품 확인서`, false, d.title?.trim() || titleConf(d))}
<div class="box"><h3>거래처 정보</h3><table class="kv k6">
  <tr><th>상호</th><td class="co" colspan="3">${esc(d.company)}</td><th>납품일</th><td><b>${esc(dayText(d.deliveryDate))}</b></td></tr>
  <tr><th>발주일</th><td>${esc(dayText(d.orderDate))}</td><th>유입담당</th><td>${esc(d.inflow)}</td><th>영업담당</th><td>${esc(d.sales)}</td></tr>
  ${it ? `<tr><th>업종</th><td colspan="5">${esc(d.industry)}</td></tr>` : `<tr><th>업종</th><td>${esc(d.industry)}</td><th>한조</th><td class="hj">${esc(d.hanjo)}</td><th>설치인원</th><td>${esc(d.installCount)}</td></tr>`}
  <tr><th>설치주소</th><td class="emph addrL" colspan="5">${esc(d.address)}</td></tr>
  ${it ? '' : `<tr><th>특이사항</th><td class="emph thin" colspan="5">${esc(d.special)}</td></tr>`}
 </table></div>
<div class="box"><h3>계약 조건</h3><table class="kv k6"><colgroup><col style="width:19mm"><col style="width:46mm"><col style="width:19mm"><col style="width:24mm"><col style="width:19mm"><col></colgroup>
  <tr><th>계약기간</th><td class="big2 per">${periodHtml(periodText(d.months))}</td><th>보증금</th><td class="big2">${dep ? won(dep) : '없음'}</td><th>계약서</th><td><span class="cb${ct === '전자' ? ' on' : ''}">전자</span><span class="cb${ct === '수기' ? ' on' : ''}">수기</span><span class="cb${ct === '확인서서명' ? ' on' : ''}">확인서서명</span></td></tr>
  ${d.payNote?.trim() ? `<tr><th>결제특이</th><td colspan="5">${esc(d.payNote)}</td></tr>` : ''}
  ${it
    ? `<tr class="xtr"><th>특이사항</th><td colspan="5">${esc([d.special, d.extra].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ')) || '-'}</td></tr>`
    : `<tr class="xtr"><th>추가조건<br>· 혜택</th><td colspan="5">${esc(d.extra) || '-'}</td></tr>`}
  ${site ? `<tr class="sitew"><th>유의사항</th><td colspan="5">${SITE_WARN}</td></tr>` : ''}
 </table></div>
${it ? rentBox(d) : ''}
${itemTable(d, first, 0, true, false, false, marks /* [IT 표시] */)}
${more ? `<div class="note2">품목이 많아 <b>${d.items.length - first.length}품목은 별지</b>에 이어서 적었습니다. 합계는 전체 기준입니다.</div>` : ''}
${supplies.length ? `<div class="box"><h3>소모품 · 부속 · 1회성 <small>단가는 청구 시 확정</small></h3><table class="it">
 <thead><tr><th>품목</th><th style="width:15mm">수량</th><th style="width:22mm">청구/무상</th><th style="width:24mm">단가</th><th style="width:55mm">비고</th></tr></thead>
 <tbody>${supplies
   .map((s) => `<tr><td>${esc(s.name)}</td><td class="c">${esc(s.qty)}</td><td class="c">${esc(s.charge)}</td><td class="c">${s.price ? esc(priceText(s.price)) : s.charge === '청구' ? '<span class="ph">청구 시</span>' : ''}</td><td>${esc(s.note)}</td></tr>`)
   .join('')}</tbody></table></div>` : ''}
<div class="box"><h3>거래처 연락처</h3><table class="kv big-ct ct6"><colgroup><col style="width:22mm"><col><col style="width:22mm"><col><col style="width:22mm"><col></colgroup>
 <tr><th>회사전화</th><td>${tel(d.phone)}</td><th>결제담당</th><td>${tel(d.payer)}</td><th>계약담당</th><td>${tel(d.contractor)}</td></tr>
 <tr><th>팩스</th><td>${tel(d.fax)}</td><th>${it ? 'IT담당' : '복합기담당'}</th><td>${tel(d.manager)}</td><th>현장상주자</th><td>${tel(d.resident)}</td></tr>
 <tr><th>계산서메일</th><td>${esc(d.taxMail)}</td><th>계약서메일</th><td colspan="3">${esc(d.contractMail)}</td></tr>
</table></div>
<div class="box warn"><h3 class="r">서명 전 반드시 확인</h3><div class="cols">
 <div><h5>안내사항</h5><ul>${n.guide.map((x) => `<li>${x}</li>`).join('')}</ul></div>
 <div><h5>주의사항</h5><ul>${n.caution.map((x) => `<li>${x}</li>`).join('')}</ul></div>
</div><div class="law">${LAW}</div></div>
<div class="box sign s2"><h3>확인란 <small>납품자 · 인수자</small></h3><table class="kv">
 <colgroup><col style="width:19mm"><col><col style="width:17mm"><col><col style="width:19mm"><col style="width:20mm"><col style="width:17mm"><col style="width:20mm"></colgroup>
 <tr><th>납품담당</th><td></td><th>설치담당</th><td></td><th>설치인원</th><td class="u">명</td><th>소요시간</th><td class="u">분</td></tr>
 <tr><th>현장확인</th><td colspan="7">${(it ? ['기기 작동 테스트 완료', '사용방법 설명 완료', 'S/W 설치 확인'] : ['기기 작동 테스트 완료', '사용방법 설명 완료', '개시 초카 확인', '라벨지 설명']).map((x) => `<span class="cb">${x}</span>`).join('')}</td></tr>
 <tr class="rcv"><th>인수자 성함</th><td></td><th>연락처</th><td></td><th>서명(날인)</th><td class="u" colspan="3">(인)</td></tr>
</table></div>
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 0}판 · ${esc(d.company)}${itStamp(marks) /* [IT 표시] */}</span><span>고객 서명 대상</span></div>
</div>`;
}

function pageMore(d: ConfDoc, img: string, items: ConfItem[], start: number, k: number, total: number, marks = false /* [IT 표시] */) {
  return `<div class="page${d.kind === 'it' ? ' it-p' : ''}">${head(d, img, `${KIND_LABEL[d.kind]} 납품 확인서 · 별지 ${total > 1 ? k : ''}`, true)}
<table class="kv box"><tr><th>상호</th><td class="co">${esc(d.company)}</td><th>납품일</th><td>${esc(dayText(d.deliveryDate))}</td></tr></table>
${itemTable(d, items, start, false, true, false, marks /* [IT 표시] */)}
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 0}판 · ${esc(d.company)}${itStamp(marks) /* [IT 표시] */}</span><span>별지 ${k}</span></div></div>`;
}

function page2(d: ConfDoc, img: string, marks = false /* [IT 표시] */) {
  const mfp = d.kind === 'mfp';
  return `<div class="page">${head(d, img, `출고 · 설치 확인서 (${KIND_LABEL[d.kind]})`, true)}
<table class="kv box"><tr><th>상호</th><td class="co">${esc(d.company)}</td><th>납품일</th><td>${esc(dayText(d.deliveryDate))}</td><th>납품대수</th><td><b>${totalUnits(d)}대</b></td></tr></table>
<div class="note2">기기별 <b>자산번호 · S/N${mfp ? ' · 개시 카운터 · 여분 토너/폐통' : ''}</b>은 <b>1면 '납품 정보'에 한 번만</b> 기재합니다. 2면은 확인·서명만 합니다.</div>
<div class="sec"><span>출고 정보</span></div>
<div class="box"><h3>출고 준비 · 검수 확인</h3>
 <div class="lead">1면 납품 정보의 <b>모델·자산번호·S/N${mfp ? '·출고 초카·여분' : ''}</b>과 소모품 장착 내역을 출고 시점에 확인하였으며, <b>출고 준비가 완료되었음</b>을 확인합니다.</div>
 <table class="kv">
  <tr><th>출고 준비자</th><td class="ph" style="text-align:center;height:9mm"${itAttrs(marks, 'preparer') /* [IT 표시] */}>성명 · 서명</td><th>출고일</th><td class="ph"${itAttrs(marks, 'ship-date') /* [IT 표시] */}>YYYY-MM-DD</td></tr>
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
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 0}판 · ${esc(d.company)}${itStamp(marks) /* [IT 표시] */}</span><span>출고·설치 (내부)</span></div></div>`;
}

/**
 * 확인서 HTML 전체
 * @param origin 이미지 주소 앞부분 (인쇄 새 창은 절대 주소가 필요)
 * @param withBack 2면(출고·설치) 포함
 */
/**
 * 1면이 넘칠 때만 (긴 연락처 · 현장 문구 · 소모품 여러 줄 등) 칸·글씨를 한 단계씩 줄임 — 확인란이 잘리지 않게 (2026-11-24)
 *  tight: 칸 높이·안내 글씨 조금 (수기 칸은 안 줄임) · tight2·3: 내용 전체를 조금씩 작게 (바닥글은 그대로)
 */
const TIGHT = `
.page.tight .kv th, .page.tight .kv td { height:4.8mm; padding-top:.3mm; padding-bottom:.3mm; }
.page.tight .big-ct th, .page.tight .big-ct td { height:6.2mm !important; font-size:9.2pt !important; }
.page.tight .warn .cols > div { font-size:7.2pt !important; line-height:1.22 !important; }
.page.tight .s2 th, .page.tight .s2 td { height:6.2mm; }
.page.tight .s2 tr.rcv th, .page.tight .s2 tr.rcv td { height:7.6mm; }
.page.tight { gap:1mm; }
.page.tight .box h3 { padding-top:.4mm; padding-bottom:.4mm; }
.page.tight .law { padding:.5mm 3mm !important; }
.page.tight2 > :not(.foot) { zoom:.95; }
.page.tight3 > :not(.foot) { zoom:.9; }
.page.tight4 > :not(.foot) { zoom:.84; } /* IT 30대 이상처럼 아주 많을 때만 마지막으로 */
.page.tight5 > :not(.foot) { zoom:.8; }
`;
/**
 * 복합기는 'SL-K6300LX × 2대' 한 칸이 아니라 한 대씩 따로 칸 (사용자 2026-11-24)
 *  — 대마다 자산번호·S/N·개시 카운터를 따로 적어야 해서. 임대료는 대당으로 나눔 (합계는 그대로)
 */
export function splitUnits(d: ConfDoc): ConfDoc {
  if (d.kind !== 'mfp' || !d.items.some((i) => (Number(i.qty) || 0) > 1)) return d;
  const items = d.items.flatMap((it) => {
    const n = Math.max(1, Number(it.qty) || 1);
    if (n === 1) return [it];
    const rent = Number(it.rent) || 0;
    const per = Math.floor(rent / n);
    return Array.from({ length: n }, (_, k) => ({ ...it, qty: 1, rent: rent ? per + (k === n - 1 ? rent - per * n : 0) : it.rent }));
  });
  return { ...d, items };
}

export function renderConfirm(d0: ConfDoc, origin = '', withBack = false /* 2면(출고·설치)은 CS 적응 전까지 안 냄 — 사용자 2026-11-24 */, marks = false /* [IT 표시] */): string {
  const d = splitUnits(d0);
  const img = `${origin}/confirm/rabbit.png`;
  const [first, ...chunks] = splitPages(d);
  const starts = chunks.map((_, k) => first.length + chunks.slice(0, k).reduce((s, c) => s + c.length, 0));
  const pages = [
    page1(d, img, chunks.length, first, marks /* [IT 표시] */),
    ...chunks.map((c, k) => pageMore(d, img, c, starts[k], k + 1, chunks.length, marks /* [IT 표시] */)),
    ...(withBack ? [page2(d, img, marks /* [IT 표시] */)] : []),
  ];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(`${d.no || '확인서'} ${d.company}`)}</title>${FONT_LINK}<style>${CSS}${PRINT_TUNE}${TIGHT}</style></head><body${itBodyAttrs(marks, 'confirm', d.ver, d.id) /* [IT 표시] */}>${pages.join('\n')}<script>(function(){function fill(){document.querySelectorAll('.page').forEach(function(pg){var over=function(){return pg.scrollHeight>pg.clientHeight+1};if(over())pg.classList.add('tight');if(over())pg.classList.add('tight2');if(over())pg.classList.add('tight3');if(over())pg.classList.add('tight4');if(over())pg.classList.add('tight5');var rows=[].slice.call(pg.querySelectorAll('tr.w'));var foot=pg.querySelector('.foot');if(!rows.length||!foot)return;var prev=foot.previousElementSibling;var slack=foot.getBoundingClientRect().top-prev.getBoundingClientRect().bottom-22;if(slack<=2)return;var add=slack/rows.length;rows.forEach(function(r){var td=r.querySelector('td');var h=td.getBoundingClientRect().height+add;var max=(+r.getAttribute('data-max')||40)*3.78;r.querySelectorAll('td').forEach(function(c){c.style.height=Math.min(h,max)+'px'})})})}var go=function(){var f=document.fonts&&document.fonts.ready;if(f)f.then(fill,fill);else fill()};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();})();</script></body></html>`;
}
/* ───────── 글꼴·가독성 (사용자 2026-11-23: 프리텐다드로) ─────────
 *  프리텐다드(무료 웹글꼴) — 인터넷 안 되면 맑은 고딕으로 나옴
 *  흐린 회색 글씨 진하게 · 칸 이름 더 굵게 · 안내문 글씨 조금 크게 (한 장 맞춤 확인함)
 */
export const FONT_LINK = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">';
export const PRINT_TUNE = `
html, body { font-family:'Pretendard','Malgun Gothic','맑은 고딕',sans-serif !important; }
.kv th, .cmp2 th, .ut th, .dmg th, .it th { font-weight:800 !important; }
.kv td, .cmp2 td, .ut td, .dmg td { color:#000; }
.cmp2 td small, .cmp2 td i, .ut td.na, .cmp2 td.af.w, .cond td.same { color:#4a4a4a !important; }
.box > h3 small { font-weight:500; }
.top .tl, .top .cc, .foot { color:#222; }
.warn .cols > div { font-size:7.7pt !important; line-height:1.3 !important; }
.it tr.w td i { color:#222 !important; }
/* 연한 색 (사용자 2026-11-24: 색이 전부 진해서 보기 불편) — 띠·칸 머리는 연한 바탕 + 진한 글씨 (철수는 이미 옅은 노랑이라 그대로) */
.page:not(.t-pull) .bar { background:var(--gl) !important; color:var(--gd) !important; box-shadow:inset 0 0 0 1.5px var(--g); }
.page:not(.t-pull) .bar > div { border-right-color:rgba(0,0,0,.1) !important; }
.page:not(.t-pull) .box > h3 { background:var(--gl) !important; color:var(--gd) !important; border-bottom:1.5px solid var(--g); }
.page:not(.t-pull) .box > h3 small { color:#444; }
.page:not(.t-pull) .ttl b { background:var(--gl) !important; color:var(--gd) !important; }
.page:not(.t-pull) .cmp2 tr.hd th { background:var(--gl) !important; color:var(--gd) !important; border-bottom:1.5px solid var(--g); }
.page:not(.t-pull) .cmp2 tr.hd th.af { background:var(--g) !important; color:#fff !important; }
.box > h3.r { background:#fdecea !important; color:#a33a2c !important; border-bottom:1.5px solid #e3a69c; }
.it tfoot td { background:var(--gl) !important; }
/* 거래처 연락처 크게 (사용자 2026-11-24: 너무 작음) */
.big-ct th, .big-ct td { font-size:9.6pt !important; height:7.2mm !important; line-height:1.15; }
.big-ct td { font-weight:700; }
/* 교체·철수 사유 크게 · 고른 항목 굵게 (사용자 2026-11-24: 너무 안 보임) */
.reasontx { font-size:10.5pt !important; font-weight:800 !important; color:#000 !important; line-height:1.4; }
.box .cb { font-size:9pt; }
.box .cb.on { font-weight:800; color:#000; }
/* 현장 납품 확인서: 연한 산호색 (일반=초록과 구분) */
.t-site { --g:#e8a48e; --gd:#9a4a33; --gl:#fdf0eb; }
.t-site .kv th, .t-site .it th { background:#fdf5f1; }
.kv tr.sitew th { background:#ffe600 !important; color:#000; }
.kv tr.sitew td { color:#c0392b; font-weight:800; font-size:9pt; }
.kv b.rd { color:#c0392b; }
/* 납품 거래처 정보: 설치주소는 상호보다 작게 · 보통보다 크게 / 특이사항은 보통 굵기 (사용자 2026-11-24) */
.kv td.addrL { font-size:10.2pt; }
.kv td.thin { font-weight:400; }
/* 납품: 6칸 표 · 계약 조건 */
.kv.k6 { table-layout:fixed; }
.kv.k6 th { width:19mm; }
.kv td.big2 { font-size:10.5pt; font-weight:800; }
/* 추가조건·혜택: 계약기간 값과 같은 크기 (사용자 2026-11-24: 엄청 크게는 아님) */
.kv tr.xtr th { white-space:normal; line-height:1.25; }
`;
/** 인쇄 창: 글꼴을 다 받은 뒤 인쇄 (최대 3초 기다림) */
export const PRINT_JS = '<script>window.onload=function(){var go=function(){setTimeout(function(){window.print()},250)};var t=setTimeout(go,3000);if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){clearTimeout(t);go()})}else{clearTimeout(t);go()}}</script>';

export const CONFIRM_CSS = () => CSS;
