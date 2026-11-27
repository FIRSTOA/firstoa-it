/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것 · IT 칸 표시 속성(P 자리)만 덧붙임]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/swapDoc.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 22565f61b7ff14a1ba2f163bf7092a3d1e2b5733 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// P 자리 = marks 인자가 참일 때만 붙는 IT 칸 표시 속성(data-it…, 이름·글자는 ./itFill.ts 한 곳). 자리마다 `[IT 표시]` 주석.
//   marks 없이(기본 false) 부르면 영업 원본과 글자까지 같은 HTML. 영업이 표시를 직접 붙이면 P 자리는 없애고 그냥 사본으로.
// =====================================================================================
/**
 * 교체 확인서 출력 양식 (HTML 한 장) — 사용자 확정 시안6 (2026-11-20) 그대로
 *  고장 교체 = 남색 · 머리 띠 '고장/AS' · 고장 내용 · 수리담당 · 조건 기존동일
 *  일반 교체 = 청록 · 머리 띠 교체 사유 · 조건 변경 표 (비워 두면 기존동일)
 *  공통 틀(글꼴·여백·상자·서명란)은 납품 확인서(confirmDoc) CSS 를 같이 씀
 */
import { CONFIRM_CSS, FONT_LINK, NOTICE as DELIV_NOTICE, PRINT_TUNE, ttl } from './confirmDoc';
import { titleSwap } from './confTitle';
import { fmtCount, fmtCountPair, fmtWon, isFix, type SwapDoc } from './swap';
import { itAttrs, itBodyAttrs, itStamp } from './itFill'; // [IT 표시]

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const WD = '일월화수목금토';
const day = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return '';
  return `${m[1]}년 ${+m[2]}월 ${+m[3]}일 (${WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]})`;
};
const won = (v: string) => esc(fmtWon(v));
const cb = (label: string, on = false) => `<span class="cb${on ? ' on' : ''}">${label}</span>`;

const EXTRA = `
.t-fix  { --g:#26436e; --gd:#1b3256; --gl:#e4eaf4; }
.t-swap { --g:#2a7f8c; --gd:#1d6571; --gl:#e0f1f3; }
.cmp2 td.af .st { font-size:10pt; font-weight:400; color:#000; margin-left:1.2mm; white-space:nowrap; } /* 새기기·리퍼: 굵게·상자 없이 검정 글씨, 크기만 조금 크게 (2026-11-25) */
.t-fix .kv th, .t-fix .cmp2 th { background:#eef2f8; }
.t-swap .kv th, .t-swap .cmp2 th { background:#ecf6f7; }
.bar .badge { background:#ffe600; color:#d40000; font-size:15pt; font-weight:900; letter-spacing:2px; padding:0 5mm; display:flex; align-items:center; }
.t-swap .bar .badge { background:#fff; color:#c2410c; }
.cb { white-space:nowrap; }
.kv td.dd { font-size:10.5pt; font-weight:800; color:var(--gd); }
.fault { padding:2mm 3mm; font-size:10.5pt; font-weight:700; line-height:1.5; min-height:22mm; background:#fffbe6; white-space:pre-line; }
.kv td.hl, .kv th.hl { background:#ffe600 !important; color:#c00000; font-weight:800; }
.cmp2 { width:100%; border-collapse:collapse; table-layout:fixed; }
.cmp2 th, .cmp2 td { border:1px solid var(--line); padding:.9mm 2mm; font-size:8.6pt; height:6mm; vertical-align:middle; }
.cmp2 th { font-weight:700; text-align:center; white-space:nowrap; padding:.9mm 1.5mm; }
.cmp2 tr.hd th { background:var(--g) !important; color:#fff; font-size:9pt; }
.cmp2 tr.hd th.af { background:var(--gd) !important; font-size:10.5pt; }
.cmp2 td.bf { color:#333; }
.cmp2 td.af { font-weight:800; font-size:10pt; }
.cmp2 td.af.w { font-weight:400; font-size:8pt; color:#999; }
.cmp2 td.af.big { font-size:12pt; }
.cmp2 td small { font-style:normal; color:#888; font-size:7.4pt; font-weight:400; }
.cmp2 tr.wr td, .cmp2 tr.wr th { height:8.5mm; }
.cmp2 tr.cnt td, .cmp2 tr.cnt th { height:11mm; vertical-align:top; }
.cmp2 tr.cnt th { vertical-align:middle; }
.cmp2 td.ar { padding:0; background:var(--gd) !important; }
.cond td.new { font-weight:800; font-size:10pt; color:#000; }
.cond td.same { color:#777; }
.ct { table-layout:fixed; width:100%; }
.ct th { width:22mm; }
.reasontx { padding:0 2.5mm 1.5mm; font-size:8.6pt; min-height:9mm; white-space:pre-line; }
`;

const LAW = '<div class="law">본 확인서에 서명하면 견적서의 임대 조건과 본 확인서에 명시된 조건에 동의한 것으로 보며,<br>별도 계약서를 작성하지 않은 경우에도 해당 합의는 법적 효력을 갖습니다.</div>';
// 납품 확인서와 같은 문구 (복합기 / IT 각각) — 보증금 항목만 뺌 (사용자 2026-11-20)
const notice = (kind: 'mfp' | 'it') => {
  const n = DELIV_NOTICE[kind];
  const li = (xs: string[]) => xs.filter((x) => !/보증금/.test(x)).map((x) => `<li>${x}</li>`).join('');
  return `<div class="box warn"><h3 class="r">서명 전 반드시 확인</h3><div class="cols">
 <div><h5>안내사항</h5><ul>${li(n.guide)}</ul></div>
 <div><h5>주의사항</h5><ul>${li(n.caution)}</ul></div>
</div>${LAW}</div>`;
};

export function renderSwap(d: SwapDoc, origin = '', marks = false /* [IT 표시] */): string {
  const fix = isFix(d);
  const it = d.kind === 'it';
  const mon = /모니터/.test(`${d.before.item}${d.after.item}`);
  const img = `${origin}/confirm/rabbit.png`;
  const b = d.before;
  const a = d.after;
  const c = d.cond;
  const same = (v: string) => (v.trim() ? `<td class="new">${esc(v)}</td>` : '<td class="same">기존동일</td>');
  const showCount = fix;
  const nRows = showCount ? 7 : 6;
  const head = `<div class="top"><img src="${img}" alt=""><div><div class="nm">(주)퍼스트전산</div><div class="tl">고객센터 1522-1093</div></div>${ttl(d.title?.trim() || titleSwap(d))}</div>
<div class="bar"><div class="rg"><small>지역</small>${esc(d.region || '　')}</div><div class="badge">${fix ? '고장/AS' : esc(d.reason)}</div><div class="t">${it ? 'IT제품' : '복합기'} 교체 확인서</div><div>임대리스트 순 <b>${esc(d.leaseNo)}</b></div></div>`;
  const left = `<div class="box"><h3>거래처 · 교체일</h3><table class="kv ct">
  <tr><th>교체일</th><td class="dd" colspan="3">${day(d.swapDate)}</td></tr>
  <tr><th>상호</th><td class="co" colspan="3">${esc(d.company)}</td></tr>
  ${fix ? `<tr><th>교체요청</th><td>${esc(d.requester)}</td><th class="hl">수리담당</th><td class="hl">${esc(d.repair)}</td></tr>` : it ? `<tr><th>교체요청</th><td colspan="3">${esc(d.requester)}</td></tr>` : `<tr><th>교체요청</th><td>${esc(d.requester)}</td><th>한조</th><td class="hj">${esc(d.hanjo)}</td></tr>`}
  ${fix && !it ? `<tr><th>한조</th><td class="hj" colspan="3">${esc(d.hanjo)}</td></tr>` : ''}
  <tr><th>설치주소</th><td class="emph" colspan="3">${esc(d.address)}</td></tr>
  <tr><th>특이사항</th><td class="emph" colspan="3">${esc(d.special)}</td></tr>
 </table></div>`;
  const contract = `${cb('전자', d.contract === '전자')}${cb('수기', d.contract === '수기')}${cb('확인서 서명 필수', d.contract === '확인서 서명 필수')}`;
  const right = fix
    ? `<div class="box"><h3 class="d">고장 내용</h3><div class="fault">${esc(d.reasonText)}</div>
  <table class="kv ct"><tr><th>기존 임대료</th><td>${won(c.rentBefore)}</td><th>변경</th><td><b>기존동일</b></td></tr>
  <tr><th>계약서</th><td colspan="3">${contract}</td></tr></table></div>`
    : `<div class="box"><h3 class="d">교체 사유</h3>
  <div style="padding:1.5mm 2.5mm"><span style="display:flex;flex-wrap:wrap;gap:1mm 0">${(['재계약', '기기상향', '기기하향', '기기불만', '단순'] as const).map((r) => cb(r, d.reason === r)).join('')}</span></div>
  <div class="reasontx">${esc(d.reasonText)}</div>
  <table class="kv ct"><tr><th>계약서</th><td>${contract}</td></tr>
  <tr><th>계약서 메일</th><td>${esc(d.contractMail)}</td></tr></table></div>`;
  const hwHint = mon ? '인치 / 해상도 / 단자' : 'CPU / 세대 / RAM / SSD / HDD / 그래픽 / OS';
  const mk = (m: string, k: string) => [m, k].filter((x) => x?.trim()).join(' · ');
  const af = (v: string, extra = '', mark = '' /* [IT 표시] */) => (v.trim() ? `<td class="af${extra}"${mark}>${esc(v)}</td>` : `<td class="af w"${mark}></td>`);
  const body = it
    ? `<tr><th>품목</th><td class="bf">${esc(b.item)}</td><td class="af">${esc(a.item || b.item)}</td></tr>
  <tr><th>모델명·상태</th><td class="bf">${esc(b.model)}</td><td class="af big"${itAttrs(marks, 'after-model') /* [IT 표시] */}>${esc(a.model)}${a.state ? ` <span class="st">${esc(a.state)}</span>` : ''}</td></tr>
  <tr><th>제조사·기종</th><td class="bf">${esc(mk(b.maker, b.kindModel))}</td>${af(mk(a.maker, a.kindModel), '', itAttrs(marks, 'after-maker') /* [IT 표시] */)}</tr>
  <tr class="wr"><th>기번(S/N)</th><td class="bf"${itAttrs(marks, 'before-sn') /* [IT 표시] */}>${esc(b.sn)}</td>${af(a.sn, '', itAttrs(marks, 'after-sn') /* [IT 표시] */)}</tr>
  <tr class="wr"><th>자산번호</th><td class="bf"${itAttrs(marks, 'before-asset') /* [IT 표시] */}>${esc(b.asset)}</td>${af(a.asset, '', itAttrs(marks, 'after-asset') /* [IT 표시] */)}</tr>
  <tr class="cnt"><th>하드웨어</th><td class="bf">${b.hw ? `${esc(b.hw)}<br>` : ''}<small>${hwHint}</small></td><td class="af${a.hw ? '' : ' w'}"${itAttrs(marks, 'after-hw') /* [IT 표시] */}>${a.hw ? `${esc(a.hw)}<br>` : ''}<small>${hwHint}</small></td></tr>
  <tr><th>소프트웨어</th><td class="bf">${b.sw ? `${esc(b.sw)} ` : ''}<small>WIN 및 기타 프로그램</small></td><td class="af${a.sw ? '' : ' w'}"${itAttrs(marks, 'after-sw') /* [IT 표시] */}>${a.sw ? `${esc(a.sw)} ` : ''}<small>WIN 및 기타 프로그램</small></td></tr>`
    : `<tr><th>품목</th><td class="bf">${esc(b.item)}</td><td class="af">${esc(a.item || b.item)}</td></tr>
  <tr><th>모델명·상태</th><td class="bf">${esc(b.model)}</td><td class="af big">${esc(a.model)}${a.state ? ` <span class="st">${esc(a.state)}</span>` : ''}</td></tr>
  <tr class="wr"><th>기번(S/N)</th><td class="bf">${esc(b.sn)}</td><td class="af w"></td></tr>
  <tr class="wr"><th>자산번호</th><td class="bf">${esc(b.asset)}</td><td class="af w"></td></tr>
  ${showCount ? `<tr><th>기본매수</th><td class="bf">${esc(fmtCountPair(b.count))}</td><td class="af">기존동일</td></tr>` : ''}
  <tr class="cnt"><th>카운터</th><td class="bf"><small>교체 전 · 컬A4 / 컬A3 / 흑 / HP 합계</small></td><td class="af w"><small>교체 후 · 컬A4 / 컬A3 / 흑 / HP 합계</small></td></tr>
  <tr class="wr"><th>여분 토너·폐통</th><td class="bf"><small>회수</small></td><td class="af w"><small>설치</small></td></tr>`;
  const rows = it ? 7 : nRows;
  const items = `<div class="box"><h3>교체 품목 <small>왼쪽 = 기존 기기(임대리스트) · 오른쪽 = 교체 후 기기 · 빈칸은 현장에서 기재</small></h3>
 <table class="cmp2"><colgroup><col style="width:27mm"><col><col style="width:3mm"><col></colgroup><tbody>
  <tr class="hd"><th>구분</th><th>교체 전</th><td class="ar" rowspan="${rows + 1}"></td><th class="af">교체 후</th></tr>
  ${body}
 </tbody></table></div>`;
  const cond = fix
    ? ''
    : `<div class="box"><h3>조건 변경 <small>바뀌는 칸은 굵게 · 비워 두면 기존동일</small></h3>
 <table class="cmp2 cond"><colgroup><col style="width:27mm"><col><col style="width:3mm"><col></colgroup><tbody>
  <tr class="hd"><th>항목</th><th>기존</th><td class="ar" rowspan="${it ? 4 : 6}"></td><th class="af">변경</th></tr>
  <tr><th>월 임대료 <small>VAT별도</small></th><td>${won(c.rentBefore)}</td>${c.rentAfter.trim() ? `<td class="new">${won(c.rentAfter)}</td>` : '<td class="same">기존동일</td>'}</tr>
  <tr><th>계약기간</th><td>${esc(c.periodBefore)}</td>${same(c.periodAfter)}</tr>
  ${it ? '' : `<tr><th>컬러 기본/초과</th><td>${esc(fmtCount(c.colorBefore))}</td>${same(fmtCount(c.colorAfter))}</tr>
  <tr><th>흑백 기본/초과</th><td>${esc(fmtCount(c.monoBefore))}</td>${same(fmtCount(c.monoAfter))}</tr>`}
  <tr><th>추가 혜택</th><td>-</td>${same(c.benefit)}</tr>
 </tbody></table></div>`;
  const contacts = `<div class="box"><h3>거래처 연락처 (비상연락망)</h3><table class="kv ct big-ct">
 <tr><th>결제·계약</th><td>${esc(d.payer)}</td><th>복합기 총괄</th><td>${esc(d.mfpManager)}</td></tr>
 <tr><th>교체 요청자</th><td>${esc(d.contact)}</td><th>IT 총괄</th><td>${esc(d.itManager)}</td></tr>
</table></div>`;
  const sign = `<div class="box sign"><h3>확인란</h3><table class="kv ct">
 <tr><th>납품·설치</th><td>_______________ / _______________</td><th>설치</th><td>인원 ___명 · 소요 ____분</td></tr>
 <tr><th>인수자</th><td></td><th>연락처</th><td></td></tr>
 <tr><th>현장확인</th><td colspan="3">${(it ? ['기존 기기 회수', '신규 기기 작동 테스트', '데이터 이전·백업 안내', 'S/W 설치 확인', '사용방법 설명'] : ['기존 기기 회수', '신규 기기 작동 테스트', '카운터 확인', '사용방법 설명']).map((x) => cb(x)).join('')}</td></tr>
 <tr><th>공급자 서명</th><td class="big">서명</td><th>고객 서명</th><td class="big">서명 (인)</td></tr>
</table></div>`;
  const foot = `<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 1}판 · ${esc(d.company)}${itStamp(marks) /* [IT 표시] */}</span><span>고객 서명 대상</span></div>`;
  const page = `<div class="page ${fix ? 't-fix' : 't-swap'}">${head}
<div class="row2" style="grid-template-columns:1.25fr 1fr">${left}${right}</div>
${items}${cond}${contacts}${notice(it ? 'it' : 'mfp')}${sign}${foot}</div>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>교체 확인서 ${esc(d.company)}</title>${FONT_LINK}<style>${CONFIRM_CSS()}${EXTRA}${PRINT_TUNE}</style></head><body${itBodyAttrs(marks, 'swap', d.ver, d.id) /* [IT 표시] */}>${page}</body></html>`;
}
