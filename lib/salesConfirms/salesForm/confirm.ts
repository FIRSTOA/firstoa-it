/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/confirm.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 1d5cd4b7474c84f4fc377f77e2cf06b49ff32905 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
import { rowOf, statusDeposit, statusDeliverer, statusPeople, statusContract, statusDevice, statusItem, statusModel, statusPeriod, statusYm } from './statusRow';
/**
 * 납품 확인서 (복합기 · IT) — 화면·서버·출력이 함께 쓰는 모양과 규칙
 *  복합기와 IT는 출고 준비 부서가 달라 확인서를 반드시 따로 쓴다.
 *  한 건 = 여러 판(1판, 2판 …) — 고치면 새 판으로 쌓이고 예전 판은 그대로 남는다.
 *  자산번호 · S/N · 개시 카운터 · 여분은 출력한 종이에 직접 적는 칸 (앱에는 비워 둠).
 */
export type ConfKind = 'mfp' | 'it';
export const KIND_LABEL: Record<ConfKind, string> = { mfp: '복합기', it: 'IT' };

export type ConfItem = {
  cat: string; // 품목구분 (컬러복합기 · 흑백복합기 · 데스크탑 · 노트북 · 모니터 …)
  model: string;
  maker: string;
  state: string; // 새기기 · 중고기
  qty: number;
  rent: number; // 월 렌탈료 (줄 합계, VAT 별도)
  baseColor: string; // 컬러 기본매수 (숫자)
  overColor: string; // 컬러 초과 장당 (원)
  baseMono: string;
  overMono: string;
  spec: Record<string, string>; // IT 사양 (SPEC_KEYS)
  place: string; // 설치장소 · 요청사항
};
export type ConfSupply = { name: string; qty: string; charge: '무상' | '청구'; price: string; note: string };

export type ConfDoc = {
  id: string; // 저장하면 생김
  no: string; // 확인서 번호 D-261118-03
  ver: number; // 판
  kind: ConfKind;
  region: string; // 수도권A ~ E (E = 수도권 외 전부)
  term: '일반/장기' | '현장/단기';
  statusNo: string; // 현황표 순 (현황표에 적은 뒤 채움)
  company: string; // 상호-현장명
  orderDate: string; // YYYY-MM-DD
  deliveryDate: string;
  inflow: string; // 유입담당 (퍼스트전산)
  sales: string; // 영업담당
  industry: string;
  hanjo: string; // 한조 (복합기)
  installCount: string; // 설치인원수 (복합기)
  address: string;
  special: string;
  months: string; // 계약기간 (개월)
  deposit: string; // 보증금 (원)
  payNote: string; // 결제특이
  extra: string; // 추가조건·혜택 (예: 초과료 3개월 누적 적용 · 본사 A3 장비 통합 합산)
  phone: string;
  fax: string;
  payer: string; // 결제담당
  contractor: string; // 계약담당
  manager: string; // 복합기담당 / IT담당
  resident: string; // 현장상주자
  taxMail: string;
  contractMail: string; // 메일주소 → 전자 · '수기' → 수기 · 그 외 → 확인서서명
  items: ConfItem[];
  supplies: ConfSupply[];
  /** 제목용 — 앞머리글(특이사항 머리) · 위탁사명(비우면 퍼스트) · 제목(비우면 자동) */
  head?: string;
  consign?: string;
  title?: string;
  shipType?: string; // 위탁 · 직송 (위탁사가 있을 때 — 현황표 납품담당)
  route?: string; // 유입경로 (증설 · 옥외광고 · 낙주체크 · 소개 · 개인영업(…) 등)
  consultNo?: string;
  quoteId?: string;
  savedBy?: string;
  savedAt?: string;
};

export const REGIONS = ['수도권A', '수도권B', '수도권C', '수도권D', '수도권E'];
export const MFP_CATS = ['컬러복합기', '흑백복합기', '컬러프린터', '흑백프린터', '무한프린터', '플로터', '기타']; // 무한프린터 = 잉크젯 (2026-11-25)
export const IT_CATS = ['데스크탑', '노트북', '모니터', '맥북', '태블릿', '기타'];
/** IT 사양 — 기본 순서. 인치는 노트북일 때만 */
export const SPEC_KEYS = ['인치', 'CPU', 'RAM', 'SSD', 'HDD', '그래픽', 'OS'] as const;
export const hasSpec = (cat: string) => /데스크탑|노트북|맥북|PC|본체/.test(cat);
export const specKeys = (cat: string) => (/노트북|맥북/.test(cat) ? [...SPEC_KEYS] : SPEC_KEYS.filter((k) => k !== '인치'));

/** 계약서메일 칸 → 계약서 종류 */
export function contractType(mail: string): '전자' | '수기' | '확인서서명' {
  const m = (mail ?? '').trim();
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(m)) return '전자';
  if (/^수기/.test(m)) return '수기';
  return '확인서서명';
}

/**
 * 금액·숫자 글 → 숫자. '20만원' → 200000 · '12.5만' → 125000 · '1억 2천만' → 120000000 · '5천원' → 5000 · '150,000원' → 150000
 *  (예전엔 숫자만 남겨 '20만원'이 20이 되던 문제 — 2026-11-24 보증금)
 */
export function wonNum(s: string | number | null | undefined): number {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const t = String(s ?? '').replace(/[\s,]/g, '');
  if (/[억만천]/.test(t)) {
    let total = 0;
    let hit = false;
    for (const [re, mul] of [[/([\d.]+)억/, 1e8], [/([\d.]+)천만/, 1e7], [/([\d.]+)백만/, 1e6], [/([\d.]+)만/, 1e4], [/([\d.]+)천(?!만)/, 1e3]] as [RegExp, number][]) {
      const m = re.exec(t);
      if (m) (total += Number(m[1]) * mul), (hit = true);
    }
    const tail = /만(\d+)원?$/.exec(t); // '20만5000원'
    if (tail) total += Number(tail[1]);
    if (hit) return Math.round(total);
  }
  const n = Number(t.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
export const num = (s: string | number | null | undefined) => wonNum(s);
export const won = (n: number) => `₩${Math.round(n).toLocaleString()}`;
export const totalRent = (d: Pick<ConfDoc, 'items'>) => d.items.reduce((s, i) => s + (Number(i.rent) || 0), 0);
export const totalUnits = (d: Pick<ConfDoc, 'items'>) => d.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

const kst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export const emptyItem = (kind: ConfKind): ConfItem => ({
  cat: kind === 'mfp' ? '컬러복합기' : '데스크탑',
  model: '',
  maker: '',
  state: '새기기',
  qty: 1,
  rent: 0,
  baseColor: '',
  overColor: '',
  baseMono: '',
  overMono: '',
  spec: {},
  place: '',
});
export function emptyConf(kind: ConfKind): ConfDoc {
  return {
    id: '',
    no: '',
    ver: 0,
    kind,
    region: '',
    term: '일반/장기',
    statusNo: '',
    company: '',
    orderDate: kst(),
    deliveryDate: '',
    inflow: '',
    sales: '',
    industry: '',
    hanjo: '',
    installCount: '',
    address: '',
    special: '',
    months: '',
    deposit: '',
    payNote: '',
    extra: '',
    phone: '',
    fax: '',
    payer: '',
    contractor: '',
    manager: '',
    resident: '',
    taxMail: '',
    contractMail: '',
    head: '',
    consign: '',
    shipType: '',
    route: '',
    title: '',
    items: [emptyItem(kind)],
    supplies: [],
  };
}

/** 'YYYY-MM-DD' → '2026-11-20 (금)' */
export function dayText(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return s ?? '';
  return `${s} (${'일월화수목금토'[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]})`;
}

/* ───────── 견적 기록 → 확인서 (품목·조건 자동 채우기) ───────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQ = any;
const PC_SPEC: Record<string, string> = { 화면: '인치', CPU: 'CPU', 메모리: 'RAM', SSD: 'SSD', HDD: 'HDD', 그래픽카드: '그래픽', OS: 'OS' };

/** 견적 종류로 확인서 종류 (pc → IT, 그 외 → 복합기) */
export const kindOfQuote = (q: AnyQ): ConfKind => (q?.kind === 'pc' || q?.state?.kind === 'pc' ? 'it' : 'mfp');

export function fromQuote(q: AnyQ): Partial<ConfDoc> {
  const kind = kindOfQuote(q);
  const out: Partial<ConfDoc> = { quoteId: q.id, consultNo: q.consultNo || undefined };
  if (q.customer?.company) out.company = q.customer.company;
  if (q.customer?.email) out.contractMail = q.customer.email;
  const contact = [q.customer?.contact, q.customer?.phone].filter(Boolean).join(' ');
  if (contact) out.contractor = contact;
  if (kind === 'it' && Array.isArray(q.state?.items)) {
    const st = q.state;
    if (st.years) out.months = String(Math.round(Number(st.years) * 12) || '');
    if (st.deposit) out.deposit = String(num(st.deposit) || '');
    // 단가: 견적 기록 items(공급가) 순서 = 화면 품목 순서
    const recItems: AnyQ[] = Array.isArray(q.items) ? q.items : [];
    out.items = st.items.map((p: AnyQ, i: number) => {
      const spec: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.specs ?? {})) if (PC_SPEC[k] && v) spec[PC_SPEC[k]] = String(v);
      const r = recItems[i];
      const qty = num(p.qty) || 1;
      return { ...emptyItem('it'), cat: p.cat || '데스크탑', model: p.title || '', maker: p.maker || '', qty, rent: r?.supplyTotal ?? (num(p.unit) * qty || 0), spec };
    });
    return out;
  }
  const items: AnyQ[] = (q.items ?? []).filter((i: AnyQ) => i.recommended || (q.items ?? []).length === 1);
  const use = items.length ? items : (q.items ?? []).slice(0, 1);
  if (use[0]?.months) out.months = String(use[0].months);
  out.items = use.map((i: AnyQ) => ({
    ...emptyItem('mfp'),
    cat: /흑백|mono/i.test(`${i.category} ${i.model}`) ? '흑백복합기' : '컬러복합기',
    model: i.model || '',
    state: /리퍼|중고/.test(i.condition ?? '') ? '중고기' : '새기기',
    qty: i.qty || 1,
    rent: i.supplyTotal || (i.unit || 0) * (i.qty || 1),
    baseColor: i.baseColor != null ? String(i.baseColor) : '',
    baseMono: i.baseMono != null ? String(i.baseMono) : '',
    overColor: i.overColor != null ? String(i.overColor) : '',
    overMono: i.overMono != null ? String(i.overMono) : '',
  }));
  return out;
}

/* ───────── 현황표 한 줄 (붙여넣기용) — 값 규칙은 lib/statusRow.ts (납품·교체·철수 공통) ───────── */
export { STATUS_COLS, toTsv } from './statusRow';
/** 납품: 품목마다 한 줄 */
export function statusRows(d: ConfDoc): string[][] {
  const ct = contractType(d.contractMail);
  const [route, ...routeMore] = (d.route ?? '').split('/').map((x) => x.trim());
  return d.items.map((it, idx) =>
    rowOf({
      구분: d.term === '현장/단기' ? '현장/단기' : '일반/장기',
      지역: d.region,
      납품담당: statusDeliverer(d),
      분류: '납품',
      년월: statusYm(d.deliveryDate || d.orderDate),
      납품일: d.deliveryDate,
      계약서여부: statusContract(ct),
      업체명: d.company,
      계약기간: statusPeriod(d.months),
      기본료: it.rent ? String(Math.round(it.rent / Math.max(1, it.qty || 1))) : '0', // 무상·빈칸 → 0 (2026-11-26)
      품목: statusItem(it.cat),
      유입경로: route ?? '',
      '유입경로 (자세히)': routeMore.join('/'),
      ...statusPeople(d.inflow, d.sales),
      ...statusDeposit(idx === 0 ? num(d.deposit) : 0), // 보증금은 계약 하나에 한 번 (첫 줄에만)
      교체전기종: statusDevice(it.cat),
      기종: statusModel(it.model, it.state),
      수량: String(it.qty || ''),
      업종: d.industry,
    }),
  );
}

/* ───────── 지역 자동 구분 (주소 → 수도권A~E, E = 수도권 외 전부) — 사용자 제공 기준 2026-11-18 ───────── */
const REGION_RULES: { region: string; area: '서울' | '경기' | '인천' | '충북'; names: string[] }[] = [
  { region: '수도권A', area: '서울', names: ['강북구', '노원구', '도봉구', '동대문구', '마포구', '서대문구', '성북구', '용산구', '은평구', '종로구', '중구', '중랑구'] },
  { region: '수도권A', area: '경기', names: ['가평군', '고양시', '구리시', '남양주시', '동두천시', '양주시', '연천군', '의정부시', '파주시', '포천시'] },
  { region: '수도권B', area: '서울', names: ['관악구', '구로구', '금천구', '동작구', '양천구', '영등포구', '강서구'] },
  { region: '수도권B', area: '경기', names: ['광명시', '김포시', '부천시', '시흥시', '안산시'] },
  { region: '수도권B', area: '인천', names: ['갈산동', '강화군', '계양구', '남구', '남동구', '동구', '미추홀구', '부평구', '서구', '연수구', '옹진군', '중구'] },
  { region: '수도권C', area: '서울', names: ['강남구', '강동구', '서초구', '송파구', '광진구', '성동구'] },
  { region: '수도권D', area: '경기', names: ['광주시', '군포시', '성남시', '수원시', '안성시', '안양시', '여주시', '오산시', '용인시', '의왕시', '이천시', '평택시', '하남시', '화성시', '과천시', '양평군'] },
  { region: '수도권D', area: '충북', names: ['진천군', '음성군'] },
];
const AREA_RE: [RegExp, '서울' | '경기' | '인천' | '충북' | '기타'][] = [
  [/^서울/, '서울'],
  [/^경기/, '경기'],
  [/^인천/, '인천'],
  [/^(충북|충청북도)/, '충북'],
  [/^(부산|대구|광주광역|대전|울산|세종|강원|충남|충청남도|전북|전라|전남|경북|경남|경상|제주)/, '기타'],
];
/**
 * 주소 → 지역 (수도권A~D · 수도권 외는 수도권E). 모르면 ''.
 *  같은 이름(서울 중구 · 인천 중구 · 경기 광주시 · 광주광역시)은 시·도를 먼저 보고 가름.
 *  시·도 없이 '고양시 …'로 시작해도 이름이 한 곳에만 있으면 그 지역.
 */
export function regionOf(address: string): string {
  const a = (address ?? '').trim().replace(/\s+/g, ' ');
  if (!a) return '';
  const area = AREA_RE.find(([re]) => re.test(a))?.[1];
  if (area === '기타') return '수도권E'; // 수도권 외 전부 = 수도권E
  const words = a.split(/[\s,()]+/);
  // '의정부' '진천' 처럼 시·군을 빼고 적은 경우도
  const has = (n: string) => words.some((w) => w === n || w === n.replace(/(시|군)$/, ''));
  const found = [...new Set(REGION_RULES.filter((r) => (!area || r.area === area) && r.names.some(has)).map((r) => r.region))];
  if (found.length === 1) return found[0];
  if (area === '충북') return '수도권E';
  return ''; // 모르거나 두 곳 이상(시·도 없이 '중구')이면 직접 고르게
}

/* ───────── 계약기간: 적은 그대로 ('3년' · '6개월 이상' · '8개월(7월 중순까지)') — 사용자 2026-11-24 ───────── */
/** 화면·출력용: 숫자만 있으면 '36개월', 글이면 그대로 */
export const periodText = (v: string) => {
  const t = String(v ?? '').trim();
  return /^\d+$/.test(t) ? `${t}개월` : t;
};
/** 개월 수 (장기/단기 가름용): '3년' → 36 · '6개월 이상' → 6 · '36' → 36 · 모르면 0 */
export function periodMonths(v: string): number {
  const t = String(v ?? '');
  const y = /(\d+(?:\.\d+)?)\s*년/.exec(t);
  if (y) return Math.round(Number(y[1]) * 12);
  const m = /(\d+)\s*개?월/.exec(t) ?? /^\s*(\d+)\s*$/.exec(t);
  return m ? Number(m[1]) : 0;
}
