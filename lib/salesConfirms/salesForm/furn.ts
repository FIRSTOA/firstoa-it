/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/furn.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 463ab61424c43ffcebde652299d4be64f17fddf5 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 가구 · 가전 확인서 (현장 납품 기준 — 사용자 2026-11-25)
 *  가구(책상·의자·테이블·수납장…)와 가전(냉난방기·냉장고·정수기…)을 한 양식으로. 대부분 위탁(OO상사·OO상사 등) [IT 가림]
 *  품목 줄마다 규격·품명 / 수량 / 개당(대당) 월 단가 → 월 임대료 = 합계 · 기간 총액 = 월 × 개월
 *  위탁가·영업 특이사항은 내부용 → 확인서에 안 찍음 (화면·현황표 매입가에만)
 *  추가조건은 거의 늘 '계약기간 내 반출 시, 잔여기간의 100% 임대료 청구'
 */
export type FurnItem = { name: string; qty: string; price: string /* 개당·대당 월 단가 (VAT별도) */ };
export type FurnDoc = {
  id: string;
  no: string; // F-261125-01
  ver: number;
  term: string; // 현장/단기 · 현장/장기
  region: string;
  statusNo: string;
  orderDate: string;
  deliveryDate: string;
  company: string;
  industry: string;
  address: string;
  items: FurnItem[];
  extras: FurnItem[]; // 추가 소모품 (가전 배관·전선 등 — 설치 때 청구 · 월 임대료에 안 넣음 · 단가 비우면 '현장 확인 후 안내')
  summary: string; // 제목·현황표 품목 이름 ('가구' · '냉난방기 2대') — 비우면 자동
  monthly: string; // 월 임대료 (비우면 품목 합계)
  months: string; // 계약기간 (적은 그대로: '7개월' · '9개월 (27년 7월까지)')
  total: string; // 기간 총액 (비우면 월 × 개월)
  deposit: string;
  extra: string; // 추가조건
  contract: string; // 전자 · 수기 · 확인서 서명 필수
  payer: string;
  contractor: string;
  resident: string; // 현장 상주
  phone: string;
  taxMail: string;
  contractMail: string;
  consignPrice: string; // 위탁가 총액 (내부 · 현황표 매입가)
  memo: string; // 내부 메모 (특이사항 · 영업 특이사항 · 위탁 조건) — 확인서에 안 찍음
  inflow: string;
  sales: string;
  route?: string;
  head?: string;
  consign?: string;
  shipType?: string;
  title?: string;
  savedBy?: string;
  savedAt?: string;
};

export const FURN_EXTRA = '계약기간 내 반출 시, 잔여기간의 100% 임대료 청구';
export const emptyFurnItem = (): FurnItem => ({ name: '', qty: '1', price: '' });
const kst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export function emptyFurn(): FurnDoc {
  return {
    id: '', no: '', ver: 0, term: '현장/단기', region: '', statusNo: '', orderDate: kst(), deliveryDate: '', company: '', industry: '', address: '',
    items: [emptyFurnItem()], extras: [], summary: '', monthly: '', months: '', total: '', deposit: '', extra: FURN_EXTRA, contract: '확인서 서명 필수',
    payer: '', contractor: '', resident: '', phone: '', taxMail: '', contractMail: '', consignPrice: '', memo: '', inflow: '', sales: '',
    route: '', head: '', consign: '', shipType: '', title: '',
  };
}

export const furnNum = (v: string) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
export const furnQty = (v: string) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0));
/** 품목 합계 (개당 월 단가 × 수량) */
export const furnItemsSum = (d: Pick<FurnDoc, 'items'>) => d.items.reduce((s, i) => s + furnNum(i.price) * (furnQty(i.qty) || 0), 0);
export const furnMonthly = (d: Pick<FurnDoc, 'items' | 'monthly'>) => furnNum(d.monthly) || furnItemsSum(d);
/** '7개월' · '9개월 (27년 7월까지)' · '1년' → 개월 수 */
export const furnMonthsN = (s: string) => {
  const y = /(\d+(?:\.\d+)?)\s*년/.exec(s ?? '');
  if (y && !/년\s*\d+\s*월/.test(s)) return Math.round(Number(y[1]) * 12);
  const m = /(\d+)\s*개월/.exec(s ?? '');
  return m ? Number(m[1]) : 0;
};
export const furnTotal = (d: Pick<FurnDoc, 'items' | 'monthly' | 'months' | 'total'>) => furnNum(d.total) || furnMonthly(d) * furnMonthsN(d.months);
export const furnUnits = (d: Pick<FurnDoc, 'items'>) => d.items.reduce((s, i) => s + (i.name.trim() ? furnQty(i.qty) : 0), 0);

const APPLIANCE = /냉난방|에어컨|냉장고|정수기|전자레인지|공기청정|세탁기|TV|티비|온풍기|난방기|가습기|제습기|냉온수기|커피|선풍기|히터/i;
/** 가전이면 true (나머지는 가구) — 확인서에서 가구는 '가구 일괄' 한 줄 + 상세, 가전은 한 대씩 */
export const isAppliance = (name: string) => APPLIANCE.test(name ?? '');
/** 추가 소모품 낱말 (가전 설치용) */
export const EXTRA_RE = /배관|전선|드레인|배수\s*호스|앵글|타공|실외기\s*받침|연장\s*선/;
/** 제목·현황표 품목 이름: 가전이면 '냉난방기 2대' 처럼, 가구면 '가구' (가전·가구 섞이면 '가구·가전') */
export function furnSummary(d: Pick<FurnDoc, 'items' | 'summary'>): string {
  if (d.summary.trim()) return d.summary.trim();
  const its = d.items.filter((i) => i.name.trim());
  if (!its.length) return '';
  const app = its.filter((i) => APPLIANCE.test(i.name));
  if (app.length && app.length === its.length) {
    const word = /냉난방|에어컨/.test(app.map((i) => i.name).join(' ')) ? '냉난방기' : app[0].name.replace(/^[\d*×xX\s평형]+/, '').trim();
    const n = app.reduce((s, i) => s + (furnQty(i.qty) || 1), 0);
    return `${word} ${n}대`;
  }
  return app.length ? '가구·가전' : '가구';
}

const EMPTY = /^(없음|무|x|X|-|모름|미정|확인\s*필요)?$/;
/** '월 169,000원' · '총 211,000원' · '1,183,000원' · '20만원' → 숫자 */
function money(s: string): number {
  const t = String(s ?? '').replace(/\s/g, '');
  const man = /([\d,.]+)만/.exec(t);
  if (man) return Math.round(Number(man[1].replace(/,/g, '')) * 10000);
  const n = /([\d,]+)원/.exec(t) ?? /([\d,]{4,})/.exec(t);
  return n ? Number(n[1].replace(/,/g, '')) || 0 : 0;
}

/** 품목 한 줄: '1400*800 탑책상 2개 / 개당 10,000원' · '15평 스탠드 인버터 냉난방기 1개' */
function itemOf(line: string): FurnItem | null {
  const t = line.replace(/^[ㄴ└\-•·]\s*/, '').trim();
  if (!t || /상세\s*품목|견적서\s*참조/.test(t) && !/\d+\s*(개|대|EA|세트)/i.test(t)) return null;
  const q = /(\d+)\s*(개|대|EA|ea|세트|SET)/.exec(t);
  if (!q) return null;
  const price = /(?:개당|대당|단가)?\s*([\d,]+)\s*원/.exec(t.slice(q.index + q[0].length));
  const name = t.slice(0, q.index).replace(/[/,\s]+$/, '').trim();
  return name ? { name, qty: q[1], price: price ? String(Number(price[1].replace(/,/g, ''))) : '' } : null;
}

/**
 * 카톡 선행방 '납품(현장/단기) > OO상사 위탁' 글 → 칸 [IT 가림]
 *  업종 · 날짜 · 유입경로 · 영업(요청)담당자(유입/영업/검수) · 상호 · 성함/담당자 · 주소 · 물품(+ ㄴ 상세품목 줄들)
 *  계약기간 · 기본료/기본금액(월 · 총합 · ㄴ 위탁가) · 기본 조건(→ 추가조건) · 보증금 · 계산서 · 계약서 · 특이사항(→ 내부 메모)
 */
export function parseFurnKakao(text: string, parseDate: (s: string) => string): { doc: Partial<FurnDoc>; filled: string[]; unknown: string[] } {
  const d: Partial<FurnDoc> = {};
  const items: FurnItem[] = [];
  const extras: FurnItem[] = [];
  const unknown: string[] = [];
  const memo: string[] = [];
  const filled = new Set<string>();
  const put = <K extends keyof FurnDoc>(k: K, v: FurnDoc[K], label: string) => {
    if (typeof v === 'string' && EMPTY.test(v.trim())) return;
    d[k] = v;
    filled.add(label);
  };
  let block: 'items' | 'fee' | null = null;
  const fee: string[] = [];
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx].trim();
    if (!raw) continue;
    // 첫 줄: '납품(현장/단기) > OO상사 위탁' · '납품(현장/단기) > OO상사 위탁' [IT 가림]
    const hd = /^납품\s*\(([^)]*)\)\s*(?:[>›/]\s*(.+))?$/.exec(raw);
    if (hd && !Object.keys(d).length) {
      put('term', /장기/.test(hd[1]) ? '현장/장기' : '현장/단기', '구분');
      const c = /^(.*?)\s*(위탁|직송|발주|진행)\s*$/.exec(hd[2] ?? '');
      if (c?.[1]) put('consign', c[1].trim(), '위탁사'), put('shipType', c[2] === '직송' ? '직송' : '위탁', '위탁·직송');
      continue;
    }
    const m = /^(?:[#＃]\s*\.?\s*|\d+\s*[.)]\s*|-\s*)?([^:：]{1,30}?)\s*[:：]\s*(.*)$/.exec(raw);
    const isKey = !!m && /^(?:[#＃]|\d+\s*[.)]|-\s*\S)/.test(raw);
    // 'ㄴ 위탁가 : …' · 'ㄴ위탁금액 : …' (덩어리 안이어도 내부 금액)
    if (/^ㄴ\s*위탁/.test(raw)) {
      const v = raw.replace(/^ㄴ\s*위탁[^:：]*[:：]\s*/, '');
      const tot = /총(?:합)?\s*([\d,]+)\s*원/.exec(v)?.[1] ?? /([\d,]{5,})\s*원/.exec(v)?.[1];
      if (tot) put('consignPrice', String(Number(tot.replace(/,/g, ''))), '위탁가');
      memo.push(`위탁가: ${v}`);
      continue;
    }
    if (block && !isKey) {
      if (block === 'items') {
        const it = itemOf(raw);
        if (it) (EXTRA_RE.test(it.name) ? extras : items).push(it);
        else if (!/상세\s*품목/.test(raw)) memo.push(raw);
      } else fee.push(raw.replace(/^ㄴ\s*/, ''));
      continue;
    }
    block = null;
    if (!m) {
      unknown.push(raw);
      continue;
    }
    const key = m[1].replace(/\([^)]*\)/g, '').replace(/[\s()（）]/g, '');
    const v = m[2].trim();
    if (/글머리|머리글|앞머리|캘린더|캐린더/.test(key)) put('head', v, '앞머리글');
    else if (/업종/.test(key)) put('industry', v, '업종');
    else if (/^날짜|납품일/.test(key)) put('deliveryDate', parseDate(v), '납품일');
    else if (/유입경로/.test(key)) put('route', v, '유입경로');
    else if (/담당/.test(key) && /영업|요청|유입/.test(key)) {
      const p = v.split('/').map((x) => x.trim()).filter(Boolean);
      if (p[0]) put('inflow', p[0], '유입담당');
      if (p.length) put('sales', p.length > 1 ? p[1] : p[0], '영업담당');
    } else if (/^상호|업체명/.test(key)) put('company', v.replace(/\s*\(\s*\d+\s*\)\s*$/, ''), '상호');
    else if (/^성함|^이름|^담당자$|^담당자성함|현장담당|상주/.test(key)) {
      put('payer', v, '결제담당');
      put('contractor', v, '계약담당');
      put('resident', v, '현장 상주');
    } else if (/결제|발주및상담|계약담당/.test(key)) {
      put('payer', v, '결제담당');
      put('contractor', v, '계약담당');
    } else if (/주소/.test(key)) put('address', v, '주소');
    else if (/^물품|^품목/.test(key)) {
      const it = itemOf(v);
      if (it) items.push(it);
      else if (v && !/견적서\s*참조/.test(v)) put('summary', v.replace(/\s*\(.*$/, '').trim(), '품목 이름');
      else if (v) put('summary', v.replace(/\s*\(.*$/, '').trim(), '품목 이름');
      block = 'items';
    } else if (/추가\s*소모품|소모품|배관|전선/.test(key)) {
      if (!EMPTY.test(v)) for (const x of v.split(/\s*[,，]\s*/).filter(Boolean)) extras.push(itemOf(x) ?? { name: x, qty: '', price: '' });
    } else if (/계약기간|약정|임대기간/.test(key)) put('months', v, '계약기간');
    else if (/기본료|기본금액|임대료|월요금|금액/.test(key) && !/위탁/.test(key)) {
      if (v) fee.push(v);
      block = 'fee';
    } else if (/기본조건|추가조건/.test(key)) put('extra', v, '추가조건');
    else if (/보증금/.test(key)) put('deposit', /없|무|면제/.test(v) ? '' : v, '보증금');
    else if (/계산서/.test(key)) put('taxMail', v, '계산서 메일');
    else if (/계약서메일/.test(key)) put('contractMail', v, '계약서 메일');
    else if (/^계약서/.test(key)) put('contract', /전자|@/.test(v) ? '전자' : /수기/.test(v) ? '수기' : '확인서 서명 필수', '계약서');
    else if (/사무실|팩스|회사전화/.test(key)) put('phone', v, '회사 전화');
    else if (/특이사항|비고|메모/.test(key)) {
      if (v) memo.push(`${/영업/.test(key) ? '영업 특이사항' : '특이사항'}: ${v}`);
    } else unknown.push(raw);
  }
  if (items.length) (d.items = items), filled.add('품목');
  if (extras.length) (d.extras = extras), filled.add('추가 소모품');
  // 기본료 덩어리: '월 169,000원 (7개월 임대료 총합 1,183,000원)' · '15평형 스탠드 1대 140,000원' · '2대 총 211,000원 (9개월 총 1,899,000원)'
  if (fee.length) {
    const all = fee.join('\n');
    const per = /월\s*([\d,]+)\s*원/.exec(all)?.[1] ?? /(?:^|\n)\s*(?:\d+\s*대\s*)?총\s*([\d,]+)\s*원/.exec(all)?.[1];
    const total = /(?:총합|총\s*금액|\d+\s*개월\s*(?:임대료\s*)?총(?:합)?)\s*([\d,]+)\s*원/.exec(all)?.[1];
    if (per) put('monthly', String(Number(per.replace(/,/g, ''))), '월 임대료');
    if (total) put('total', String(Number(total.replace(/,/g, ''))), '기간 총액');
    // 품목별 단가가 기본료 줄에만 있으면(가전): '15평형 스탠드 1대 140,000원' → 같은 낱말 품목에
    for (const f of fee) {
      const fm = /^(.*?)\s*(\d+)\s*대\s*([\d,]+)\s*원/.exec(f);
      if (!fm || /총/.test(fm[1])) continue;
      const words = fm[1].replace(/평형?/g, '평').split(/\s+/).filter((w) => w.length >= 2);
      const hit = items.find((i) => !furnNum(i.price) && words.some((w) => i.name.replace(/평형?/g, '평').includes(w)));
      if (hit) hit.price = String(Math.round(Number(fm[3].replace(/,/g, '')) / (Number(fm[2]) || 1)));
    }
    if (!per && !total && money(all)) put('monthly', String(money(all)), '월 임대료');
  }
  if (memo.length) put('memo', memo.join('\n'), '내부 메모');
  return { doc: d, filled: [...filled], unknown };
}
