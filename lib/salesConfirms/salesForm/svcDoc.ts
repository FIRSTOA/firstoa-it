/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것 · IT 칸 표시 속성(P 자리)만 덧붙임]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/svcDoc.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 81ae1ad9a4f8dea5225d1dcb02ebb2817aac3eb7 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// P 자리 = marks 인자가 참일 때만 붙는 IT 칸 표시 속성(data-it…, 이름·글자는 ./itFill.ts 한 곳). 자리마다 `[IT 표시]` 주석.
//   marks 없이(기본 false) 부르면 영업 원본과 글자까지 같은 HTML. 영업이 표시를 직접 붙이면 P 자리는 없애고 그냥 사본으로.
// =====================================================================================
/**
 * IT 유지보수 · 소프트웨어 확인서 출력 양식 (HTML 한 장) — 같은 틀, 색은 연한 하늘
 *  거래처 정보 / 계약 조건(계약기간·기간·보증금·계약서·요금 안내) / 품목(월 요금) / 서비스 내용 / 연락처 / 안내·주의 / 확인란
 */
import { CONFIRM_CSS, FONT_LINK, PRINT_TUNE, ttl } from './confirmDoc';
import { titleSvc } from './confTitle';
import { svcMonthly, svcNum, svcQty, svcUnits, type SvcDoc } from './svc';
import { itBodyAttrs, itItemAttr, itStamp } from './itFill'; // [IT 표시]

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const WD = '일월화수목금토';
const day = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? `${m[1]}년 ${+m[2]}월 ${+m[3]}일 (${WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]})` : esc(s);
};
const won = (n: number) => (n ? `₩${n.toLocaleString()}` : '');
const cb = (label: string, on = false) => `<span class="cb${on ? ' on' : ''}">${label}</span>`;

const EXTRA = `
.t-svc { --g:#7fa8d6; --gd:#2f5d8c; --gl:#eef4fb; }
.t-svc .kv th, .t-svc .it2 th { background:#f5f8fc; }
.cb { white-space:nowrap; }
.ct { table-layout:fixed; width:100%; }
.ct th { width:26mm; }
.it2 { width:100%; border-collapse:collapse; table-layout:fixed; }
.it2 th, .it2 td { border:1px solid var(--line); padding:.8mm 1.5mm; font-size:8.8pt; height:7.5mm; vertical-align:middle; }
.it2 th { font-weight:700; text-align:center; white-space:nowrap; }
.it2 td.c { text-align:center; } .it2 td.r { text-align:right; }
.it2 td.m { font-weight:800; }
.it2 tfoot td { background:var(--gl); font-weight:800; font-size:9.5pt; }
.kv td.pre { white-space:pre-line; line-height:1.45; }
.warn h5 small { font-weight:500; color:#555; font-size:7.4pt; margin-left:1mm; }
.scope { padding:1.5mm 3mm; font-size:8.4pt; line-height:1.5; white-space:pre-line; columns:2; column-gap:6mm; }
`;
const LAW = '<div class="law">본 확인서에 서명하면 위 서비스 내용·기간·요금에 동의한 것으로 보며,<br>별도 계약서를 작성하지 않은 경우에도 해당 합의는 법적 효력을 갖습니다.</div>';
/** 안내·주의 (사용자 제공 문구 2026-11-24 — 겹치는 것 합치고, 서비스 내용 ①~⑦과 겹치는 것은 뺌) */
const NOTICE = {
  유지보수: `<div class="box warn"><h3 class="r">서명 전 반드시 확인</h3><div class="cols">
 <div><h5>안내사항</h5><ul>
  <li>요금은 대당 월 요금(VAT 별도)이며, 계약기간 동안 매월 청구됩니다.</li>
  <li>방문 출장비, 수리비·부품비, 용량 증설·S/W·H/W 등 유상 항목은 위 유지보수 내용대로 별도 청구됩니다.</li>
  <li>중요한 자료는 따로 저장해 주세요. 자동 백업은 지원하지 않습니다.</li>
 </ul></div>
 <div><h5>주의사항 <small>아래 사유로 생긴 문제는 퍼스트전산 책임 범위에 포함되지 않습니다</small></h5><ul>
  <li>데이터 손실·복구</li>
  <li>당사가 제공하지 않은 소프트웨어·비정품 소프트웨어로 생긴 저작권·기술적·법적 문제</li>
  <li>사전 동의 없이 고객사 직원이 임의로 설정해 생긴 장애</li>
  <li>천재지변·화재·전쟁 등 불가항력</li>
 </ul></div>
</div>${LAW}</div>`,
  소프트웨어: `<div class="box warn"><h3 class="r">서명 전 반드시 확인</h3><div class="cols">
 <div><h5>안내사항</h5><ul>
  <li>라이선스는 사용자(계정) 기준으로 제공됩니다. 기존 계정 사용 여부와 라이선스 이전 가능 여부는 미리 확인이 필요합니다.</li>
  <li>구독형 상품은 계약기간 동안 사용할 수 있으며, 계약이 끝나면 사용이 제한될 수 있습니다.</li>
  <li>업무용 정품 소프트웨어는 당사 매입 원가로 공급합니다. 설치·세팅은 고객사가 직접 하는 것이 원칙입니다(협의 가능).</li>
 </ul></div>
 <div><h5>주의사항</h5><ul>
  <li>라이선스는 제조사 정책에 따라 공급되며, 등록을 마친 뒤에는 취소·환불이 안 될 수 있습니다.</li>
  <li>계정 분실·비밀번호 관리 등 사용자 계정 관리는 고객사 책임입니다.</li>
  <li>당사가 제공하지 않은 소프트웨어의 저작권·법적 문제는 책임지지 않습니다.</li>
 </ul></div>
</div>${LAW}</div>`,
};

export function renderSvc(d: SvcDoc, origin = '', marks = false /* [IT 표시] */): string {
  const img = `${origin}/confirm/rabbit.png`;
  const sw = d.kind === '소프트웨어';
  const items = d.items.filter((i) => i.name.trim());
  const rows = [...items, ...Array.from({ length: items.length ? 0 : 1 } /* 빈 줄 채우지 않음 (2026-11-24) */, () => null)]
    .map((i, k) =>
      i
        ? `<tr${itItemAttr(marks, k + 1) /* [IT 표시] */}><td class="c">${k + 1}</td><td class="m">${esc(i.name)}</td><td class="c">${svcQty(i.qty) || ''}</td><td class="r">${won(svcNum(i.price))}</td><td class="r">${won(svcNum(i.price) * svcQty(i.qty))}</td></tr>`
        : '<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td></tr>',
    )
    .join('');
  const ct = d.contract;
  const unit = sw ? '개당' : '대당';
  const page = `<div class="page t-svc">
<div class="top"><img src="${img}" alt=""><div><div class="nm">(주)퍼스트전산</div><div class="tl">고객센터 1522-1093</div></div>${ttl(d.title?.trim() || titleSvc(d))}</div>
<div class="bar"><div class="rg"><small>지역</small>${esc(d.region || '　')}</div><div>${esc(d.term)}</div><div class="t">${sw ? '소프트웨어 확인서' : 'IT 유지보수 확인서'}</div><div>현황표 순 <b>${esc(d.statusNo) || '&nbsp;&nbsp;&nbsp;&nbsp;'}</b></div></div>
<div class="box"><h3>거래처 정보</h3><table class="kv k6">
 <tr><th>상호</th><td class="co" colspan="3">${esc(d.company)}</td><th>시작일</th><td><b>${day(d.startDate)}</b></td></tr>
 <tr><th>발주일</th><td>${esc(d.orderDate)}</td><th>유입담당</th><td>${esc(d.inflow)}</td><th>영업담당</th><td>${esc(d.sales)}</td></tr>
 <tr><th>업종</th><td colspan="5">${esc(d.industry)}</td></tr>
 <tr><th>주소</th><td class="emph addrL" colspan="5">${esc(d.address)}</td></tr>
 <tr><th>특이사항</th><td class="emph thin" colspan="5">${esc(d.special)}</td></tr>
</table></div>
<div class="box"><h3>계약 조건</h3><table class="kv k6"><colgroup><col style="width:19mm"><col style="width:34mm"><col style="width:19mm"><col><col style="width:19mm"><col style="width:30mm"></colgroup>
 <tr><th>계약기간</th><td class="big2">${esc(d.period)}</td><th>기간</th><td>${esc(d.range)}</td><th>보증금</th><td>${esc(d.deposit) || '없음'}</td></tr>
 <tr><th>계약서</th><td colspan="5">${cb('전자', /전자/.test(ct))}${cb('수기', /수기/.test(ct))}${cb('확인서 서명', /확인서/.test(ct))}</td></tr>
 ${d.feeNote.trim() ? `<tr><th>요금 안내</th><td class="pre" colspan="5">${esc(d.feeNote)}</td></tr>` : ''}
</table></div>
<div class="box"><h3>${sw ? '구독 품목' : '유지보수 대상'} <small>요금 VAT 별도 · 매월</small></h3>
 <table class="it2"><colgroup><col style="width:8mm"><col><col style="width:16mm"><col style="width:30mm"><col style="width:30mm"></colgroup>
 <thead><tr><th>#</th><th>품목</th><th>수량</th><th>${unit} 월 요금</th><th>월 합계</th></tr></thead>
 <tbody>${rows}</tbody>
 <tfoot><tr><td colspan="2">합계 <small>(VAT별도 · 매월)</small></td><td class="c">${svcUnits(d)}</td><td></td><td class="r">${won(svcMonthly(d))}</td></tr></tfoot></table></div>
${d.scope.trim() ? `<div class="box"><h3>${sw ? '서비스 내용' : '유지보수 내용'}</h3><div class="scope">${esc(d.scope)}</div></div>` : ''}
<div class="box"><h3>거래처 연락처</h3><table class="kv ct big-ct">
 <tr><th>결제담당</th><td>${esc(d.payer)}</td><th>계약담당</th><td>${esc(d.contractor)}</td></tr>
 <tr><th>${sw ? '사용 담당자' : 'IT 담당자'}</th><td>${esc(d.manager)}</td><th>회사 전화</th><td>${esc(d.phone)}</td></tr>
 <tr><th>계산서 메일</th><td>${esc(d.taxMail)}</td><th>계약서 메일</th><td>${esc(d.contractMail)}</td></tr>
</table></div>
${NOTICE[d.kind] ?? NOTICE.유지보수}
<div class="box sign"><h3>확인란</h3><table class="kv ct">
 <tr><th>담당</th><td>_______________</td><th>인수자</th><td></td></tr>
 <tr><th>현장확인</th><td colspan="3">${(sw ? ['계정·라이선스 전달', '설치·로그인 확인', '사용방법 안내'] : ['자산번호 부착', '원격 프로그램 설치', '접수 방법 안내']).map((x) => cb(x)).join('')}</td></tr>
 <tr><th>공급자 서명</th><td class="big">서명</td><th>고객 서명</th><td class="big">서명 (인)</td></tr>
</table></div>
<div class="foot"><span>${esc(d.no || '저장 전')} · ${d.ver || 1}판 · ${esc(d.company)}${itStamp(marks) /* [IT 표시] */}</span><span>고객 서명 대상</span></div>
</div>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${sw ? '소프트웨어' : 'IT 유지보수'} 확인서 ${esc(d.company)}</title>${FONT_LINK}<style>${CONFIRM_CSS()}${EXTRA}${PRINT_TUNE}</style></head><body${itBodyAttrs(marks, 'svc', d.ver, d.id) /* [IT 표시] */}>${page}</body></html>`;
}
