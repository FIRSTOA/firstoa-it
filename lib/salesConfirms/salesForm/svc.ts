/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/svc.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob a88d7f74e4e855e351589477a949fccabe25f849 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * IT 유지보수 · 소프트웨어(구독) 확인서 — 월 요금 + 계약기간 + 서비스 내용
 *  종류: '유지보수' (PC·노트북 유지보수, 대당 월 요금) / '소프트웨어' (MS 365 등 구독)
 *  카톡 선행방 글 두 모양을 읽음 → parseSvcKakao
 *   ① 'IT유지보수' 글: 캐린더 글머리 · 날짜 · 유입경로 · 영업(요청)담당자 · 상호 · 성함 · 주소 · 장비소유주 · 물품 · 계약기간 · 기본료 · 계약서(기간) · 유지보수 내용(①~⑦)
 *   ② '납품 (일반/장기) / [OO상사 발주]' 소프트웨어 글: 물품 '…_소프트웨어 구독 1개' · 계약기간 '약 7개월 20일 [26-11-19 ~ 27-07-08]' · 기본료 여러 줄 [IT 가림]
 *  내부 금액(위탁가·매입·마진)은 확인서에 안 넣고 매입가(현황표용)로만
 */
export type SvcKind = '유지보수' | '소프트웨어';
export type SvcItem = { name: string; qty: string; price: string /* 대당·개당 월 요금 (VAT별도) */; cost?: string /* 매입가 (현황표용) */ };
export type SvcDoc = {
  id: string;
  no: string; // V-261201-01
  ver: number;
  kind: SvcKind;
  term: string; // 일반/장기 · 현장/단기 …
  region: string;
  statusNo: string;
  orderDate: string;
  startDate: string; // 시작일(납품일)
  company: string;
  industry: string;
  address: string;
  special: string;
  items: SvcItem[];
  period: string; // 계약기간 (적은 그대로: '1년' · '약 7개월 20일')
  range: string; // 기간 날짜 ('26.12.1 ~ 27.11.30')
  deposit: string;
  feeNote: string; // 요금 안내 (일할계산 등, 여러 줄)
  scope: string; // 유지보수·서비스 내용 (여러 줄)
  contract: string; // 전자 · 수기 · 확인서 서명 필수
  contractMail: string;
  taxMail: string;
  phone: string;
  payer: string;
  contractor: string;
  manager: string; // 담당자 (성함·연락처)
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

/** 유지보수 내용 기본 문구 (사용자 카톡 양식 2026-11-24) */
export const MAINT_SCOPE = `① 원격지원 무상
ㆍ고객사 보유 소프트웨어 인증 지원
ㆍ업무용 프로그램 무상 설치 지원 (당사에서 보유한 소프트웨어에 한함)
ㆍOS 재설치 (원격으로 1차 처리 → 원격 처리 불가 시 방문 처리, 1회 30,000원 별도)
ㆍ하드웨어 장애 처리
② 방문지원 [1회 30,000원]
ㆍ현장 점검 요청 · 원인 불명 · 장애 원인 확인 등
ㆍOS 재설치
③ 방문수리
ㆍ건별 사전 견적 협의 후 진행 [수리비 및 부품비 별도]
ㆍ1회 출장비 30,000원
④ 기술 지원
ㆍ전화 및 원격 지원 (4시간 이내 응답)
⑤ 자산 관리
ㆍ자산번호 부착 관리
⑥ 접수시간
ㆍ평일 오전 9시 ~ 오후 6시 (공휴일 제외)
⑦ 데이터 복구
ㆍ유지보수 대상에 포함되지 않음
ㆍ하드디스크 데이터 손실 시, 전문 복구 업체를 통해 별도 진행`;

export const emptySvcItem = (): SvcItem => ({ name: '', qty: '1', price: '' });
const kst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export function emptySvc(kind: SvcKind = '유지보수'): SvcDoc {
  return {
    id: '', no: '', ver: 0, kind, term: '일반/장기', region: '', statusNo: '', orderDate: kst(), startDate: '', company: '', industry: '', address: '', special: '',
    items: [emptySvcItem()], period: '', range: '', deposit: '', feeNote: '', scope: kind === '유지보수' ? MAINT_SCOPE : '', contract: '확인서 서명 필수',
    contractMail: '', taxMail: '', phone: '', payer: '', contractor: '', manager: '', inflow: '', sales: '', route: '', head: '', consign: '', shipType: '', title: '',
  };
}
export const svcNum = (v: string) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
export const svcQty = (v: string) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0));
export const svcMonthly = (d: Pick<SvcDoc, 'items'>) => d.items.reduce((s, i) => s + svcNum(i.price) * (svcQty(i.qty) || 0), 0);
export const svcUnits = (d: Pick<SvcDoc, 'items'>) => d.items.reduce((s, i) => s + (i.name.trim() ? svcQty(i.qty) : 0), 0);
export const svcKindOf = (s: string): SvcKind => (/소프트웨어|S\/W|SW|365|구독|라이선스|오피스|한글|어도비|Adobe/i.test(s ?? '') ? '소프트웨어' : '유지보수');

/** '대당 3,000원' · '월 14,000원씩' · '1만원' → 숫자 */
function money(s: string): number {
  const t = String(s ?? '').replace(/\s/g, '');
  const man = /([\d,.]+)만/.exec(t);
  if (man) return Math.round(Number(man[1].replace(/,/g, '')) * 10000);
  const n = /([\d,]+)원/.exec(t) ?? /([\d,]{4,})/.exec(t);
  return n ? Number(n[1].replace(/,/g, '')) || 0 : 0;
}
const EMPTY = /^(없음|무|x|X|-|모름|미정)?$/;

/** 카톡 선행방 글 → 확인서 칸 */
export function parseSvcKakao(text: string, parseDate: (s: string) => string): { doc: Partial<SvcDoc>; filled: string[]; unknown: string[] } {
  const d: Partial<SvcDoc> = {};
  const items: SvcItem[] = [];
  const unknown: string[] = [];
  const filled = new Set<string>();
  const put = <K extends keyof SvcDoc>(k: K, v: SvcDoc[K], label: string) => {
    if (typeof v === 'string' && EMPTY.test(v.trim())) return;
    d[k] = v;
    filled.add(label);
  };
  let block: 'fee' | 'scope' | 'items' | null = null;
  let freeAll = false; // 금액 무상
  let headMemo = ''; // 첫 줄 '/' 뒤 설명 (예: '재계약 혜택 무상')
  const fee: string[] = [];
  const scope: string[] = [];
  let name = '';
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  /** 품목 한 줄(쉼표로 여러 개): 'Microsoft 365 Apps for business_1개 구독' · '노트북 유지보수 4대' */
  const addItems = (v: string) => {
    for (const x of v.split(/\s*[,，]\s*(?=\S)/)) {
      const q = [...x.matchAll(/(\d+)\s*(대|개|명|카피|copy|EA|user|유저|석)/gi)];
      const qty = q.length ? q[q.length - 1][1] : '1';
      const nm = x
        .replace(/[\s_]*\d+\s*(대|개|명|카피|copy|EA|user|유저|석)\s*(구독|라이선스|라이센스)?\s*$/i, '')
        .replace(/[\s_]+$/, '')
        .trim();
      if (nm) items.push({ ...emptySvcItem(), name: nm, qty });
    }
    if (items.length) filled.add('품목');
  };
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx].trim();
    if (!raw) continue;
    // 첫 줄: 'IT유지보수' · '납품 (일반/장기) / [OO상사 발주]' [IT 가림]
    if (idx === 0 || !Object.keys(d).length) {
      if (/^IT\s*유지\s*보수|^유지\s*보수/.test(raw)) {
        // 'IT유지보수(일반/장기) / 재계약 혜택 무상' — 구분 · '/' 뒤 설명은 특이사항 (2026-11-24 OO상사) [IT 가림]
        put('kind', '유지보수', '종류');
        const tm = /\(([^)]*)\)/.exec(raw)?.[1] ?? '';
        if (tm) put('term', /현장/.test(tm) ? '현장/단기' : '일반/장기', '구분');
        const noParen = raw.replace(/\([^)]*\)/g, ''); // '(일반/장기)' 안의 '/'는 빼고
        const memo = noParen.includes('/') ? noParen.replace(/^[^/]*\/\s*/, '').trim() : '';
        if (memo) (headMemo = memo), put('special', memo, '특이사항');
        continue;
      }
      const hd = /^납품\s*(?:\(([^)]*)\))?\s*(?:\/\s*\[?([^\]]*)\]?)?\s*$/.exec(raw);
      if (hd) {
        if (hd[1]) put('term', /현장/.test(hd[1]) ? '현장/단기' : '일반/장기', '구분');
        const c = /^(.*?)\s*(발주|직송|진행)/.exec(hd[2] ?? '');
        if (c?.[1]) {
          put('consign', c[1].trim(), '위탁사');
          put('shipType', c[2] === '직송' ? '직송' : '위탁', '위탁·직송');
        }
        continue;
      }
    }
    const m = /^(?:[#＃]\s*\.?\s*|\d+\s*[.)]\s*|ㄴ\s*)?([^:：]{1,30}?)\s*[:：]\s*(.*)$/.exec(raw);
    const isNumberedKey = !!m && /^(?:[#＃]|\d+\s*\.)/.test(raw);
    // 여러 줄 덩어리 (기본료 · 유지보수 내용) — 다음 번호 항목 전까지
    if (block && !isNumberedKey) {
      if (block === 'scope') scope.push(raw.replace(/\s*\d+\s*\.\s*기타\s*[:：].*$/, '').trim());
      else if (block === 'items') addItems(raw.replace(/^[-·•ㄴ]\s*/, ''));
      else fee.push(raw);
      continue;
    }
    block = null;
    // 'ㄴ …' 덧붙임 줄(항목 이름이 없거나 아주 긴 설명) → 특이사항
    if (/^ㄴ/.test(raw) && (!m || m[1].length > 20)) {
      put('special', [d.special, raw.replace(/^ㄴ\s*/, '')].filter(Boolean).join(' · '), '특이사항');
      continue;
    }
    if (!m) {
      unknown.push(raw);
      continue;
    }
    const key = m[1].replace(/\([^)]*\)/g, '').replace(/[\s()（）]/g, '');
    const v = m[2].trim();
    if (/글머리|머리글|앞머리|캘린더|캐린더/.test(key)) put('head', v, '앞머리글');
    else if (/^날짜|시작일|납품일/.test(key)) put('startDate', parseDate(v), '시작일');
    else if (/업종/.test(key)) put('industry', v, '업종');
    else if (/유입경로/.test(key)) put('route', v, '유입경로');
    else if ((/담당/.test(key) && /영업|요청|유입/.test(key)) || /^요청자?$/.test(key)) {
      const p = v.split('/').map((x) => x.trim()).filter(Boolean);
      if (p[0]) put('inflow', p[0], '유입담당');
      if (p.length) put('sales', p[p.length - 1], '영업담당'); // 한 명이면 유입·영업 모두 그 이름
    } else if (/^상호|업체명/.test(key)) put('company', v.replace(/\s*\(\s*\d+\s*\)\s*$/, ''), '상호');
    else if (/^성함|^이름/.test(key)) (name = v), put('manager', v, '담당자');
    else if (/^담당자$/.test(key)) put('manager', v.split('/').map((x) => x.trim()).filter(Boolean).join(' '), '담당자'); // '홍길동/매니저/01000000000' [IT 가림]
    else if (/^연락처|^전화번호/.test(key)) put('manager', [name, v].filter(Boolean).join(' '), '담당자');
    else if (/주소/.test(key) && !/특이/.test(key)) put('address', v, '주소');
    else if (/주소특이|엘베|엘리베이터/.test(key)) {
      if (!EMPTY.test(v) && !/^무\(/.test(v)) put('special', [d.special, v].filter(Boolean).join(' · '), '특이사항');
    } else if (/장비소유주/.test(key)) {
      if (v && !/퍼스트|ㅍㅅㅌ/.test(v)) put('consign', v, '위탁사');
    } else if (/^물품|^품목/.test(key)) {
      if (v) addItems(v);
      else block = 'items'; // '물품 :' 뒤가 비면 다음 줄들이 품목
    } else if (/계약기간|약정/.test(key)) {
      const r = /\[([^\]]+)\]/.exec(v)?.[1] ?? /\(([^)]*~[^)]*)\)/.exec(v)?.[1];
      if (r) put('range', r.trim(), '기간');
      put('period', v.replace(/\s*[[(][^\])]*~[^\])]*[\])]\s*/, '').trim(), '계약기간');
    } else if (/보증금/.test(key)) put('deposit', v, '보증금');
    else if (/^금액|^비용|^단가/.test(key)) {
      // '금액 : 무상' → 요금 안내 · 품목 단가 0 (재계약 혜택 등)
      if (/무상|무료/.test(v)) (d.feeNote = [d.feeNote, `무상${headMemo ? ` (${headMemo})` : ''}`].filter(Boolean).join('\n')), filled.add('요금 안내'), (freeAll = true);
      else if (v) fee.push(v);
    }
    else if (/기본료|월요금|요금/.test(key)) {
      if (v) fee.push(v);
      block = 'fee';
    } else if (/유지보수내용|서비스내용|지원내용/.test(key)) {
      if (v) scope.push(v);
      block = 'scope';
    } else if (/계산서/.test(key)) put('taxMail', v, '계산서 메일');
    else if (/계약서메일|계약메일/.test(key)) put('contractMail', /상동/.test(v) ? d.taxMail ?? '' : v, '계약서 메일');
    else if (/^계약서/.test(key)) {
      put('contract', /전자|@/.test(v) ? '전자' : /수기/.test(v) ? '수기' : '확인서 서명 필수', '계약서');
      const r = /\(([^)]*~[^)]*)\)/.exec(v)?.[1];
      if (r && !d.range) put('range', r.trim(), '기간');
    } else if (/^결제(방법|방식)?$/.test(key) && !/\d{3,}|[가-힣]{2,4}\s*(대리|과장|차장|부장|팀장|매니저|주임|사원|대표)/.test(v)) {
      put('special', [d.special, `결제: ${v}`].filter(Boolean).join(' · '), '특이사항'); // '월 결제 진행' — 결제 방법 (2026-11-26)
    } else if (/결제|계약담당|발주/.test(key)) {
      put('payer', v, '결제담당');
      put('contractor', v, '계약담당');
    } else if (/사무실|팩스|회사전화/.test(key)) put('phone', v, '회사 전화');
    else if (/특이사항/.test(key) && !/미기재/.test(key)) put('special', [d.special, v].filter(Boolean).join(' · '), '특이사항');
    else if (/추가조건|기타/.test(key)) put('special', [d.special, v].filter(Boolean).join(' · '), '특이사항');
    else if (/기본매수|인터넷|PC대수|MAC|해피콜/i.test(key)) {
      /* 이 확인서엔 안 씀 */
    } else unknown.push(raw);
  }
  // 기본료: '대당 3,000원 *4대' · '월 14,000원씩' → 대당 월 요금 · 위탁가·마진 줄은 확인서에 안 넣고 매입가로
  const pub: string[] = [];
  let cost = 0;
  for (const f of fee) {
    if (/위탁가|매입|마진/.test(f)) {
      unknown.push(`(확인서에 안 넣은 내부 메모) ${f}`);
      const c = /기존\s*월\s*([\d,]+)\s*원/.exec(f)?.[1] ?? /월\s*([\d,]+)\s*원/.exec(f)?.[1] ?? /(?:개당|대당)\s*([\d,]+)\s*원/.exec(f)?.[1];
      if (c) cost = Number(c.replace(/,/g, ''));
      continue;
    }
    pub.push(f);
  }
  if (pub.length) {
    const perLine = pub.find((x) => /대당|개당|월\s*[\d,]+\s*원/.test(x)) ?? pub[pub.length - 1];
    const monthly = /월\s*([\d,]+)\s*원/.exec(perLine)?.[1] ?? /(?:대당|개당)\s*([\d,]+)\s*원/.exec(perLine)?.[1];
    const per = monthly ? Number(monthly.replace(/,/g, '')) : money(perLine);
    if (per && items.length === 1) (items[0].price = String(per)), filled.add('월 요금');
    if (pub.length > 1 || !/^(대당|개당|월)?\s*[\d,]+\s*원/.test(pub[0])) put('feeNote', pub.join('\n'), '요금 안내');
  }
  if (cost && items.length === 1) items[0].cost = String(cost);
  if (scope.length) put('scope', scope.join('\n').replace(/\n{2,}/g, '\n').trim(), '서비스 내용');
  // 계약서 칸이 따로 없고 계약서 메일이 이메일이면 전자계약
  if (!d.contract && /@/.test(d.contractMail ?? '')) put('contract', '전자', '계약서');
  if (freeAll) items.forEach((i) => (i.price ||= '0')); // 금액 무상 → 단가 0
  if (items.length) {
    d.items = items;
    if (!d.kind) put('kind', svcKindOf(items.map((i) => i.name).join(' ')), '종류');
  }
  return { doc: d, filled: [...filled], unknown };
}
