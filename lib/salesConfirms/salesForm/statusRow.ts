/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/statusRow.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 80ab3214713645595544d7a1eca413e3f79ffca8 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 현황표('납품,교체,철수(현황표)') 붙여넣기 줄 — 납품 · 교체 · 철수 공통
 *  실제 현황표 값에 맞춤 (2026-11-24, 매출 통계 앱 원본 자료로 확인):
 *   구분 = 일반/장기 · 현장/단기 · 현장/장기 · 일반/단기
 *   품목 = 프린팅 · IT제품 · 세단기 · 공기청정기 · 기타
 *   '교체전기종' 칸(실제 값은 장비종류) = 컬러기 · 흑백기 · 무한프린터 · 모니터 · 데스크탑 · 노트북 · 기타
 *   기종 = 모델명 (+ '(리퍼)')
 *   계약서여부 = 전자계약서미작성 · 수기계약서미작성 · X(확인서 서명 · 철수)
 *   계약기간 = 3년 · 2년 · 1년 · ○개월 (철수는 빈칸)
 *  한 줄 = 기종 1건 (수량 N)
 */
import type { SwapDoc } from './swap';
import type { PullDoc } from './pull';
import { shortAddr, type MoveDoc } from './move';
import { saleNum, saleQty, type SaleDoc } from './sale';
import { svcQty, type SvcDoc } from './svc';
import { wonNum } from './confirm'; // 함수는 부를 때만 쓰므로 서로 불러와도 괜찮음
import { furnMonthly, furnSummary, type FurnDoc } from './furn';
export const STATUS_COLS = [
  '구분', '지역', '분류', '년월', '납품일', '납품담당', '납품여부', '통합리스트순', '계약서여부', '업체명', '계약기간', '기본료', '품목',
  '유입경로', '유입경로 (자세히)', '매입가', '교체/철수사유 (자세히)', '유입담당자', '영업담당자', '계약검수자', '보증금', '보증금입금확인',
  '교체전기종', '기종', '수량', '담당자', '설치인원', '소요시간', '업종',
] as const;
export type StatusRow = Partial<Record<(typeof STATUS_COLS)[number], string>>;

/** 품목 대분류 */
export function statusItem(item: string): string {
  const s = item ?? '';
  if (/세단/.test(s)) return '세단기';
  if (/공기청정|공청/.test(s)) return '공기청정기';
  if (/복합기|프린터|플로터|팩스|스캐너/.test(s)) return '프린팅';
  if (/PC|피씨|노트북|모니터|데스크|맥|태블릿|소프트웨어|S\/W|유지보수|본체|그램|NAS|나스|오피스|365/i.test(s)) return 'IT제품';
  // 애매하면 비움 (사용자 2026-11-24) — 직접 고른 '기타'만 기타
  return s.trim() === '기타' ? '기타' : '';
}
/** 장비종류 ('교체전기종' 칸) */
export function statusDevice(item: string): string {
  const s = item ?? '';
  if (/무한/.test(s)) return '무한프린터';
  if (/플로터/.test(s)) return '플로터';
  if (/세단/.test(s)) return '세단기';
  if (/흑백/.test(s)) return '흑백기';
  if (/컬러|복합기|프린터/.test(s)) return '컬러기';
  if (/모니터/.test(s)) return '모니터';
  if (/노트북|맥북|그램/.test(s)) return '노트북';
  if (/데스크|PC|본체/i.test(s)) return '데스크탑';
  if (/소프트웨어|S\/W|오피스|365/i.test(s)) return '소프트웨어';
  if (/NAS|나스/i.test(s)) return '나스';
  if (/태블릿|아이패드|갤럭시\s*탭/.test(s)) return '태블릿PC';
  if (/유지보수/.test(s)) return '유지보수';
  if (/공기청정|공청/.test(s)) return '공기청정기';
  if (/가구|의자|책상|테이블|캐비닛|소파/.test(s)) return '가구';
  return s.trim() === '기타' ? '기타' : '';
}
/** 기종: 끝에 '(리퍼)' 또는 '(새기기)'를 꼭 붙임 (사용자 2026-11-24 · 철수는 안 씀) — 이미 붙어 있으면 그대로 */
export const statusModel = (model: string, state = '') => {
  const m = (model ?? '').trim();
  if (!m) return '';
  if (/\((?:[^)]*)(리퍼|새기기|중고)(?:[^)]*)\)\s*$/.test(m)) return m;
  return `${m}(${/리퍼|중고/.test(state) ? '리퍼' : '새기기'})`;
};
/** 보증금 칸 · 입금확인 칸: 금액이 있으면 숫자 + '미입금'(처음엔 다 미입금), 없으면 무 · 무 */
export function statusDeposit(v: string | number): StatusRow {
  const n = wonNum(v); // '20만원' → 200000
  return n > 0 ? { 보증금: String(n), 보증금입금확인: '미입금' } : { 보증금: '무', 보증금입금확인: '무' };
}
/** 계약서여부 */
export const statusContract = (c: string) => (/전자/.test(c) ? '전자계약서미작성' : /수기/.test(c) ? '수기계약서미작성' : 'X');
/** 계약기간: 36 → '3년' · 18 → '18개월' · '36개월 (…)' → '3년' (글이면 그대로) */
export function statusPeriod(v: string): string {
  const t = String(v ?? '').trim();
  if (!t || /기존동일/.test(t)) return '';
  // 글로 적은 것('3년' · '6개월 이상' · '1년 이상')은 그대로 (현황표에도 그렇게 씀)
  if (!/^\d+$/.test(t)) return t;
  const m = /^(\d+)\s*(개월)?/.exec(t);
  if (!m) return t;
  const n = Number(m[1]);
  if (/년/.test(t.slice(m[0].length, m[0].length + 2)) || /^\d+\s*년/.test(t)) return `${n}년`;
  return n % 12 === 0 && n >= 12 ? `${n / 12}년` : `${n}개월`;
}
/** 날짜 글 → Date ('2026-06-23' · '2026. 6. 23.' · '26.6.23') */
function day(s: string): Date | null {
  const m = /(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/.exec(s ?? '');
  if (!m) return null;
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  return new Date(y, Number(m[2]) - 1, Number(m[3]));
}
/** 두 날짜 사이 개월 수 (모르면 null) */
export function monthsBetween(a: string, b: string): number | null {
  const x = day(a);
  const y = day(b);
  if (!x || !y) return null;
  return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()) - (y.getDate() < x.getDate() ? 1 : 0);
}
/**
 * 구분(계약유형) — 임대리스트 '일반/현장' 기준 (사용자 2026-11-24)
 *  일반 → 일반/장기 · 현장 → 1년(12개월) 미만이면 현장/단기, 이상이면 현장/장기
 *  months: 철수 = 계약일~철수일, 교체 = 임대리스트 계약기간
 */
export function statusTerm(kind: string, months: number | null, fallback: string): string {
  if (/현장/.test(kind ?? '')) return months != null && months < 12 ? '현장/단기' : months == null ? fallback : '현장/장기';
  if (/일반/.test(kind ?? '')) return '일반/장기';
  return fallback;
}
/**
 * 납품담당 (사용자 2026-11-24): 퍼스트가 준비 → '퍼스트' · 위탁 → '위탁사명(위탁)' · 직송 → 매입처명만
 *  위탁/직송은 제목 칸에서 고름 (안 고르면 앞머리글에 '직송'이 있으면 직송)
 */
export function statusDeliverer(d: { consign?: string; head?: string; shipType?: string }): string {
  const c = (d.consign ?? '').trim();
  if (!c) return '퍼스트';
  const direct = d.shipType ? d.shipType === '직송' : /직송/.test(d.head ?? '');
  return direct ? c : `${c}(위탁)`;
}
/** 담당자 세 칸 (유입담당자 · 영업담당자 · 계약검수자) — 한 사람이면 세 칸 모두 그 이름 */
export function statusPeople(inflow: string, sales: string): StatusRow {
  const i = (inflow ?? '').trim();
  const s = (sales ?? '').trim() || i;
  return { 유입담당자: i || s, 영업담당자: s, 계약검수자: s };
}
/** 'YYYY-MM-DD' → 'YYMM' (현황표 년월) */
export const statusYm = (day: string) => (/^\d{4}-\d{2}/.test(day ?? '') ? `${day.slice(2, 4)}${day.slice(5, 7)}` : '');
/** 금액 글 → 숫자 글 ('₩90,000' → '90000') */
export const statusNum = (v: string) => String(v ?? '').replace(/[^\d]/g, '');
/** 현황표 기본료: 무상·0·빈칸 → '0' (2026-11-26 사용자 — 무상은 비우지 말고 0) · zeroIfEmpty=false 면 빈칸은 그대로(교체 '기존동일') */
export const rentCell = (v: string | number | undefined, zeroIfEmpty = true) => {
  const t = String(v ?? '').trim();
  if (/무상|무료/.test(t)) return '0';
  const n = t.replace(/[^\d]/g, '');
  return n ? String(Number(n)) : zeroIfEmpty ? '0' : '';
};

export const rowOf = (v: StatusRow) => STATUS_COLS.map((h) => v[h] ?? '');
export const toTsv = (rows: string[][]) => rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n');

/* ───────── 교체 · 철수 (확인서 → 현황표 줄) ───────── */

/** 교체: 한 줄 (기존 → 새 기기) */
export function swapStatusRows(d: SwapDoc): string[][] {
  const item = d.after.item || d.before.item;
  return [
    rowOf({
      구분: statusTerm(d.leaseKind ?? '', d.leasePeriod ? Number(String(d.leasePeriod).replace(/[^\d]/g, '')) || null : null, '일반/장기'),
      지역: d.region,
      납품담당: statusDeliverer(d),
      분류: '교체',
      ...statusDeposit(0), // 보증금 · 입금확인 = 무 · 무 (현황표 원본 그대로)
      년월: statusYm(d.swapDate),
      납품일: d.swapDate,
      통합리스트순: d.leaseNo,
      계약서여부: statusContract(d.contract),
      업체명: d.company,
      계약기간: statusPeriod(d.cond.periodAfter),
      기본료: rentCell(d.cond.rentAfter || d.cond.rentBefore, false),
      품목: statusItem(item),
      '교체/철수사유 (자세히)': [d.reason, d.reasonText].filter((x) => x?.trim()).join(' - '),
      ...statusPeople(d.requester, d.requester),
      교체전기종: statusDevice(item),
      기종: statusModel(d.after.model, d.after.state),
      수량: '1',
    }),
  ];
}
/** 철수: 기기마다 한 줄 */
/**
 * 같은 기기(모델·품목, 철수는 대당 임대료까지 같음)는 한 줄로 묶고 수량만 늘림 (사용자 2026-11-24)
 *  예) 27모니터 S27D304GAK 2대 → 한 줄 · 수량 2 · 순번은 '00000, 00000' [IT 가림]
 */
/**
 * 모니터 인치 — 품목 '24모니터'·'24인치' 또는 모델 'F24T354FHK'·'S24C314EAK'·'LS27…'·'24MP400' 에서 (모니터가 아니면 '')
 */
export function monitorInch(item: string, model: string): string {
  if (statusDevice(`${item ?? ''} ${model ?? ''}`) !== '모니터' && !/모니터/.test(item ?? '')) return '';
  const ok = (x?: string) => (x && Number(x) >= 15 && Number(x) <= 49 ? x : '');
  const m = (model ?? '').trim().toUpperCase();
  return ok(/(\d{2})\s*(?:인치|"|형|모니터)/.exec(item ?? '')?.[1]) || ok(/^[A-Z]{1,3}(\d{2})[A-Z]/.exec(m)?.[1]) || ok(/^(\d{2})[A-Z]/.exec(m)?.[1]);
}

/**
 *  모니터는 모델이 달라도 인치·대당 임대료가 같으면 한 줄 → 기종 '24모니터' (사용자 2026-11-26 OO상사 F24T354FHK 2 + S24C314EAK 2 → 24모니터 4) [IT 가림]
 */
function groupUnits<U extends { no: string; model: string; item?: string; rent?: string }>(units: U[], withRent: boolean): { u: U; nos: string[]; n: number; model: string }[] {
  const out: { u: U; nos: string[]; n: number; model: string }[] = [];
  const at = new Map<string, number>();
  for (const u of units) {
    const inch = monitorInch(u.item ?? '', u.model);
    const rent = withRent ? statusNum(u.rent ?? '') : '';
    const k = inch ? ['모니터', inch, rent].join('|') : [(u.item ?? '').trim(), u.model.trim(), rent].join('|');
    const i = k.replace(/\|/g, '') ? at.get(k) : undefined; // 모델·품목이 다 비면 묶지 않음
    if (i === undefined) (at.set(k, out.length), out.push({ u, nos: u.no ? [u.no] : [], n: 1, model: u.model }));
    else {
      const g = out[i];
      g.n++;
      if (u.no) g.nos.push(u.no);
      if (inch && u.model.trim().toUpperCase() !== g.u.model.trim().toUpperCase()) g.model = `${inch}모니터`; // 모델이 섞이면 인치로
    }
  }
  return out;
}

export function pullStatusRows(d: PullDoc): string[][] {
  return groupUnits(d.units, true).map(({ u, nos, n, model }) =>
    rowOf({
      구분: statusTerm(d.leaseKind ?? '', monthsBetween(d.start, d.pullDate), d.type === '현장/단기 종료' ? '현장/단기' : '일반/장기'),
      지역: d.region,
      납품담당: statusDeliverer(d),
      분류: '철수',
      ...statusDeposit(0), // 보증금 · 입금확인 = 무 · 무 (현황표 원본 그대로)
      년월: statusYm(d.pullDate),
      납품일: d.pullDate,
      통합리스트순: nos.join(', ') || d.leaseNo,
      계약서여부: 'X',
      업체명: d.company,
      기본료: statusNum(u.rent),
      품목: statusItem(u.item || u.model),
      '교체/철수사유 (자세히)': `${d.fault ? `${d.fault}: ` : ''}${d.reason || d.type}${d.reasonText?.trim() ? `-사유: ${d.reasonText.trim()}` : ''}`,
      ...statusPeople(d.requester, d.requester),
      교체전기종: statusDevice(u.item || u.model),
      기종: model,
      수량: String(n),
    }),
  );
}

/* ───────── 이전 · 판매 ───────── */
/** 이전: 기기마다 한 줄 · 기본료는 모두 0 (이전 비용은 안 씀) */
export function moveStatusRows(d: MoveDoc): string[][] {
  return groupUnits(d.units, false).map(({ u, nos, n, model }) =>
    rowOf({
      구분: statusTerm(d.leaseKind ?? '', d.leasePeriod ? Number(String(d.leasePeriod).replace(/[^\d]/g, '')) || null : null, '일반/장기'),
      지역: d.region,
      납품담당: statusDeliverer(d),
      분류: '이전',
      ...statusDeposit(0), // 보증금 · 입금확인 = 무 · 무 (현황표 원본 그대로)
      년월: statusYm(d.moveDate),
      납품일: d.moveDate,
      통합리스트순: nos.join(', ') || d.leaseNo,
      계약서여부: statusContract(d.contract),
      업체명: d.company,
      기본료: '0', // 이전은 줄마다 임대료 0 · 이전 비용은 현황표에 안 씀 (사용자 2026-11-26)
      품목: statusItem(u.item || u.model),
      '교체/철수사유 (자세히)': `${d.paid} 이전${d.fromAddr || d.toAddr ? ` (${shortAddr(d.fromAddr)}->${shortAddr(d.toAddr)})` : ''}`,
      ...statusPeople(d.requester, d.requester),
      교체전기종: statusDevice(u.item || u.model),
      기종: model,
      수량: String(n),
      업종: d.industry,
    }),
  );
}
/** 판매: 품목마다 한 줄 (기본료 칸 = 대당 판매금액) */
export function saleStatusRows(d: SaleDoc): string[][] {
  const [route, ...routeMore] = (d.route ?? '').split('/').map((x) => x.trim());
  return d.items
    .filter((i) => i.name.trim())
    .map((i) =>
      rowOf({
        구분: '판매',
        지역: d.region,
        납품담당: statusDeliverer(d),
        분류: '판매',
        년월: statusYm(d.deliveryDate || d.orderDate),
        납품일: d.deliveryDate,
        계약서여부: statusContract(d.contract),
        업체명: d.company,
        계약기간: '판매',
        기본료: rentCell(i.price),
        ...statusDeposit(saleNum(i.price) * (saleQty(i.qty) || 0)),
        매입가: statusNum(i.cost ?? ''),
        품목: statusItem(`${i.name} ${i.spec}`),
        유입경로: route ?? '',
        '유입경로 (자세히)': routeMore.join('/'),
        ...statusPeople(d.inflow, d.sales),
        교체전기종: statusDevice(`${i.name} ${i.spec}`),
        기종: statusModel([i.name, i.spec].filter((x) => x.trim()).join(' '), /리퍼|중고/.test(`${i.name} ${i.spec}`) ? '리퍼' : '새기기'),
        수량: String(saleQty(i.qty) || ''),
        업종: d.industry,
      }),
    );
}

/* ───────── IT 유지보수 · 소프트웨어 ───────── */
/** 품목마다 한 줄 — 분류 '납품' · 품목 'IT제품' · 장비종류 '유지보수' / '소프트웨어' · 기본료 = 대당(개당) 월 요금 */
export function svcStatusRows(d: SvcDoc): string[][] {
  const [route, ...routeMore] = (d.route ?? '').split('/').map((x) => x.trim());
  return d.items
    .filter((i) => i.name.trim())
    .map((i) =>
      rowOf({
        구분: d.term || '일반/장기',
        지역: d.region,
        분류: '납품',
        년월: statusYm(d.startDate || d.orderDate),
        납품일: d.startDate,
        납품담당: d.kind === '소프트웨어' ? statusDeliverer(d) : '퍼스트', // 유지보수는 위탁 없이 퍼스트 (2026-11-24)
        계약서여부: statusContract(d.contract),
        업체명: d.company,
        계약기간: statusPeriod(d.period),
        기본료: rentCell(i.price),
        매입가: statusNum(i.cost ?? ''),
        품목: 'IT제품',
        유입경로: route ?? '',
        '유입경로 (자세히)': routeMore.join('/'),
        ...statusPeople(d.inflow, d.sales),
        ...statusDeposit(d.deposit),
        교체전기종: d.kind === '소프트웨어' ? '소프트웨어' : '유지보수',
        기종: i.name,
        수량: String(svcQty(i.qty) || ''),
        업종: d.industry,
      }),
    );
}

/**
 * 가구·가전 (현장): 한 건 한 줄 (예전 양식처럼 '가구' · '냉난방기' 한 줄) — 2026-11-25
 *  가구 = 수량 1 · 기본료 = 월 임대료 / 가전 = 대수 · 기본료 = 월 임대료 ÷ 대수 → 기본료 × 수량 = 월 임대료 (일일 매출 보고와 맞음)
 *  매입가 = 위탁가 총액 · 품목 '기타'
 */
export function furnStatusRows(d: FurnDoc): string[][] {
  const [route, ...routeMore] = (d.route ?? '').split('/').map((x) => x.trim());
  const sum = furnSummary(d);
  const m = /^(.*?)\s*(\d+)\s*대$/.exec(sum);
  const qty = m ? Number(m[2]) || 1 : 1;
  const monthly = furnMonthly(d);
  if (!monthly && !sum) return [];
  return [
    rowOf({
      구분: d.term || '현장/단기',
      지역: d.region,
      분류: '납품',
      년월: statusYm(d.deliveryDate || d.orderDate),
      납품일: d.deliveryDate,
      납품담당: statusDeliverer(d),
      계약서여부: statusContract(d.contract),
      업체명: d.company,
      계약기간: statusPeriod(d.months),
      기본료: monthly ? String(Math.round(monthly / qty)) : '0',
      매입가: statusNum(d.consignPrice),
      품목: '기타',
      유입경로: route ?? '',
      '유입경로 (자세히)': routeMore.join('/'),
      ...statusPeople(d.inflow, d.sales),
      ...statusDeposit(d.deposit),
      교체전기종: m ? '가전' : '가구',
      기종: m ? m[1] : sum,
      수량: String(qty),
      업종: d.industry,
    }),
  ];
}
