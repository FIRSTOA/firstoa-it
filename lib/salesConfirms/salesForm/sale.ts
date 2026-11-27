/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/sale.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob ddecf29c5fbf76572f8f00ae1a1347ad6cccf3f4 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 판매 납품 확인서 — 임대가 아닌 판매(구매) 납품 (노트북·소프트웨어 등)
 *  카톡 선행방 '납품' 글을 붙여 넣으면 칸이 채워짐 (납품 확인서와 같은 해석 규칙: kakaoParse)
 *  금액은 모두 VAT 별도 · 판매조건/설치조건은 자유 글
 */
export type SaleItem = { name: string; maker: string; spec: string; price: string; qty: string; cost?: string /* 대당 매입가 (현황표용 · 확인서엔 안 나옴) */ };
export type SaleDoc = {
  id: string;
  no: string; // S-261120-01
  ver: number;
  region: string;
  statusNo: string; // 현황표 순 (적은 뒤)
  orderDate: string;
  deliveryDate: string;
  company: string;
  branch: string; // 부서/지점
  address: string;
  industry: string;
  items: SaleItem[];
  saleCond: string; // 판매조건 (예: 판매스티커 부착 후 출고)
  installCond: string; // 설치조건
  contract: string; // 전자 · 수기 · 확인서 서명 필수
  tax: string; // 세금계산서: 발행 · 미발행 · 카드결제
  phone: string; // 회사 전화/팩스
  receiver: string; // 수령인
  payer: string; // 결제담당
  contractor: string; // 계약담당
  taxMail: string;
  contractMail: string;
  special: string;
  inflow: string;
  sales: string;
  route?: string;
  shipType?: string; // 위탁 · 직송 (위탁사가 있을 때 — 현황표 납품담당)
  head?: string;
  consign?: string;
  title?: string;
  savedBy?: string;
  savedAt?: string;
};
export const emptySaleItem = (): SaleItem => ({ name: '', maker: '', spec: '', price: '', qty: '1' });
const kst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export function emptySale(): SaleDoc {
  return {
    id: '', no: '', ver: 0, region: '', statusNo: '', orderDate: kst(), deliveryDate: '', company: '', branch: '', address: '', industry: '',
    items: [emptySaleItem()], saleCond: '', installCond: '', contract: '확인서 서명 필수', tax: '발행', phone: '', receiver: '', payer: '', contractor: '',
    taxMail: '', contractMail: '', special: '', inflow: '', sales: '', route: '', head: '', consign: '', title: '', shipType: '',
  };
}
export const saleNum = (v: string) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
export const saleQty = (v: string) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0));
export const saleTotal = (d: Pick<SaleDoc, 'items'>) => d.items.reduce((s, i) => s + saleNum(i.price) * (saleQty(i.qty) || 0), 0);
export const saleUnits = (d: Pick<SaleDoc, 'items'>) => d.items.reduce((s, i) => s + (i.name.trim() ? saleQty(i.qty) : 0), 0);

/* ───────── 카톡 선행방 '판매납품' 글 → 판매 확인서 칸 ───────── */
const BRANDS = /^(삼성|LG|엘지|레노버|Lenovo|HP|에이치피|델|DELL|Dell|애플|Apple|에이수스|ASUS|한성|MSI|에이서|Acer|MS|마이크로소프트|로지텍|캐논|엡손|브라더)$/i;
/** '193만원' → 1930000 · '165,000원' → 165000 · '17.5만' → 175000 */
export function saleMoney(s: string): number {
  const t = String(s ?? '').replace(/\s/g, '');
  const man = /([\d,.]+)만/.exec(t);
  if (man) return Math.round(Number(man[1].replace(/,/g, '')) * 10000);
  const n = /([\d,]+)/.exec(t);
  return n ? Number(n[1].replace(/,/g, '')) || 0 : 0;
}
/**
 * 판매 글 예)
 *   판매납품(OO상사, OO상사 직송) [IT 가림]
 *   업종 : … / 유입경로: 증설/확장성관리 / 유입/영업 담당: 홍길동/홍길동/홍길동 / 날짜 : 11.25(수) 수령예정일 [IT 가림]
 *   업체명 : … / 주소 : … / 발주: 홍길동 대리님 010-… / 수령: 홍길동 070-… [IT 가림]
 *   품목:
 *   (1) 삼성 갤럭시북5 NT750XHW-A51A 노트북 1대(+OS 정품 씰 포함) 1대
 *   > 매입가: 172만원 / 판매가: 193만원 (13% 마진)
 *   명세서,계산서 : 고객 측 수령 후 요청시 발행 (생성완료) / 특이사항 : 판매스티커 부착 후 출고
 *  첫 줄 괄호 = 앞머리글(제목) · '직송' 이면 위탁사(괄호 안 업체명)
 *  판매가 = 대당 판매금액, 매입가 = 대당 매입가(현황표 매입가 칸)
 */
export function parseSaleKakao(text: string, parseDate: (s: string) => string): { doc: Partial<SaleDoc>; filled: string[]; unknown: string[] } {
  const d: Partial<SaleDoc> = {};
  const items: SaleItem[] = [];
  const unknown: string[] = [];
  const filled = new Set<string>();
  const put = <K extends keyof SaleDoc>(k: K, v: SaleDoc[K], label: string) => {
    if (typeof v === 'string' && (!v.trim() || /^(모름|미정|없음|-|x)$/i.test(v.trim()))) return;
    d[k] = v;
    filled.add(label);
  };
  /** 품목 한 줄: '삼성 갤럭시북5 … 노트북 1대(+OS 정품 씰 포함) 1대' · 'AC2561(새기기)+팩스킷 제외 1대' */
  const addItem = (line: string) => {
    let s = line.trim();
    if (!s) return;
    const qtys = [...s.matchAll(/(\d+)\s*대/g)];
    const qty = qtys.length ? qtys[qtys.length - 1][1] : '1';
    const extra = [...s.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].replace(/^\+\s*/, '').trim()).filter((x) => x && !/^(새\s*기기|새기|신품)$/.test(x));
    // '+팩스킷 제외' 같은 덧붙임은 사양으로
    const plus = /\+\s*([^()]+?)(?=\s*\d+\s*대|$)/.exec(s.replace(/\([^)]*\)/g, ''))?.[1]?.trim();
    if (plus) extra.push(plus);
    s = s.replace(/\([^)]*\)/g, ' ').replace(/\+\s*[^()]+?(?=\s*\d+\s*대|$)/, ' ').replace(/\d+\s*대/g, ' ').replace(/\s+/g, ' ').trim();
    const first = s.split(' ')[0] ?? '';
    items.push({ ...emptySaleItem(), name: s, maker: BRANDS.test(first) ? first : '', spec: extra.join(' · '), qty });
    filled.add('품목');
  };
  /** '2,450,000원 (2,695,000원 VAT포함)' → 앞 금액(공급가) */
  const firstMoney = (v: string) => saleMoney(v.replace(/\(.*$/, ''));
  let inItems = false;
  for (const raw0 of String(text ?? '').split(/\r?\n/)) {
    const raw = raw0.trim();
    if (!raw) continue;
    // 첫 줄: 판매납품(OO상사, OO상사 직송) · 판매납품(OO상사 직송, 요청완료) [IT 가림]
    const hd = /^판매\s*납품\s*(?:\((.*)\))?\s*$/.exec(raw);
    if (hd) {
      const inner = (hd[1] ?? '').trim();
      if (inner) {
        put('head', inner, '앞머리글');
        const c = /^(.*?)\s*직송/.exec(inner)?.[1]?.trim();
        if (c) put('consign', c, '위탁사');
      }
      continue;
    }
    // '※ 실 고객 판매가 …' · '>> 청구관련 …' = 내부 메모 → 확인서에 안 넣음 (참고로만)
    if (/^(※|>>|＞＞)/.test(raw)) {
      unknown.push(`(확인서에 안 넣은 내부 메모) ${raw.replace(/^(※|>>|＞＞)\s*/, '')}`);
      inItems = false;
      continue;
    }
    // 품목 줄: (1) … 1대  /  > 매입가: … / 판매가: …
    if (inItems && /^\(?\s*\d+\s*\)/.test(raw)) {
      addItem(raw.replace(/^\(?\s*\d+\s*\)\s*/, ''));
      continue;
    }
    if (inItems && /^[>›▶ㄴ-]/.test(raw) && items.length) {
      const it = items[items.length - 1];
      const sell = /판매가\s*[:：]?\s*([\d,.]+\s*만?\s*원?)/.exec(raw);
      const buy = /매입가\s*[:：]?\s*([\d,.]+\s*만?\s*원?)/.exec(raw);
      if (sell) (it.price = String(saleMoney(sell[1]))), filled.add('판매가');
      if (buy) (it.cost = String(saleMoney(buy[1]))), filled.add('매입가');
      continue;
    }
    const m = /^(?:[#＃]\s*\.?\s*|\d+\s*[.)]\s*|ㄴ\s*)?([^:：]{1,24}?)\s*[:：]\s*(.*)$/.exec(raw);
    if (!m) {
      // '2. 옥외광고/관리, OO상사/홍길동/홍길동' — 항목 이름 없이 유입경로, 유입/영업 담당 [IT 가림]
      const body = raw.replace(/^\d+\s*[.)]\s*/, '');
      const pr = /^([^,，]+\/[^,，]+)\s*[,，]\s*([^,，]+\/[^,，]+)$/.exec(body);
      if (pr) {
        put('route', pr[1].trim(), '유입경로');
        const p = pr[2].split('/').map((x) => x.trim()).filter(Boolean);
        if (p[0]) put('inflow', p[0], '유입담당');
        if (p.length) put('sales', p[p.length - 1], '영업담당'); // 한 명이면 유입·영업 모두 그 이름
        continue;
      }
      unknown.push(raw);
      continue;
    }
    const key = m[1].replace(/[\s()（）]/g, '');
    const v = m[2].trim();
    inItems = false;
    if (/업종/.test(key)) put('industry', v, '업종');
    else if (/유입경로/.test(key)) put('route', v, '유입경로');
    else if (/담당/.test(key) && /유입|영업/.test(key)) {
      const p = v.split('/').map((x) => x.trim()).filter(Boolean);
      if (p[0]) put('inflow', p[0], '유입담당');
      if (p.length) put('sales', p[p.length - 1], '영업담당'); // 한 명이면 유입·영업 모두 그 이름
    } else if (/날짜|수령예정|납품일|출고일/.test(key)) put('deliveryDate', parseDate(v), '납품일');
    else if (/업체명|상호/.test(key)) put('company', v, '상호');
    else if (/주소/.test(key)) put('address', v, '주소');
    else if (/^발주|^요청자|^주문/.test(key)) {
      put('contractor', v, '계약담당');
      put('payer', v, '결제담당');
    } else if (/^수령|현장|상주/.test(key)) put('receiver', v, '수령인');
    else if (/품목|물품|모델/.test(key)) {
      inItems = true;
      if (v) addItem(v);
    } else if (/판매가|판매금액/.test(key)) {
      if (items.length) (items[items.length - 1].price = String(firstMoney(v))), filled.add('판매가');
    } else if (/매입가|매입금액/.test(key)) {
      if (items.length) (items[items.length - 1].cost = String(firstMoney(v))), filled.add('매입가');
    } else if (/명세서|계산서/.test(key)) put('taxMail', v, '계산서');
    else if (/계약서/.test(key)) {
      put('contractMail', v, '계약서 메일');
      put('contract', /@/.test(v) ? '전자' : /수기/.test(v) ? '수기' : '확인서 서명 필수', '계약서');
    } else if (/전화|팩스/.test(key)) put('phone', v, '회사 전화');
    else if (/특이사항|판매조건/.test(key)) {
      // 판매 글의 특이사항은 대개 출고 조건 (예: 판매스티커 부착 후 출고)
      if (/스티커|출고|부착|포장/.test(v)) put('saleCond', v, '판매조건');
      else put('special', v, '특이사항');
    } else if (/설치/.test(key)) put('installCond', v, '설치조건');
    else unknown.push(raw);
  }
  if (items.length) d.items = items;
  return { doc: d, filled: [...filled], unknown };
}
