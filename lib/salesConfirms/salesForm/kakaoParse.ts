/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/kakaoParse.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 0855a355c130c22a606dce15bea577468c26a2b4 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 카톡 '납품' 선행방 글 → 확인서 칸 (복붙 자동 채우기)
 *  사람마다 양식이 조금씩 달라도 줄 앞의 단어(상호명 · 납품주소 · 계산서 메일 …)로 알아봄.
 *  번호·기호(#, ㄴ, 1., -, •)·띄어쓰기·괄호는 무시. ':' 가 없는 줄은 바로 위 항목에 이어 붙임.
 *  외부 AI 없이 규칙으로만 (비용 0). 못 알아본 줄은 그대로 돌려줘 화면에 보여 줌.
 */
import { isInkjet } from './inkjet';
import { emptyItem, hasSpec, specKeys, wonNum, type ConfDoc, type ConfItem, type ConfKind } from './confirm';

export type ParseResult = { patch: Partial<ConfDoc>; kind: ConfKind | null; filled: string[]; unknown: string[] };

const norm = (s: string) => s.replace(/[\s()（）[\]_·.\-:]/g, '').toLowerCase();
const EMPTY = /^(없음|없습니다|해당\s*없음|x|-|무|미정|\.)?$/i;

/** 항목 이름 규칙 — 위에서부터 먼저 맞는 것 */
const KEYS: [RegExp, string][] = [
  [/캘린더|머리글|머릿글/, 'calendar'],
  [/유입경로|유입구분/, 'route'],
  [/영업.*담당|요청.*담당|담당영업/, 'sales'],
  [/유입담당/, 'inflow'],
  [/상호|업체명|회사명|거래처명/, 'company'],
  [/주소.*특이/, 'addrNote'],
  [/납품.*특이|설치.*특이|특이사항|요청사항|주의/, 'special'],
  [/납품.*주소|설치.*주소|배송.*주소|^주소/, 'address'], // '주소(엘리베이터 유무)' 도 주소 (엘베보다 먼저)
  [/엘베|엘리베이터|승강기/, 'elevator'],
  [/날짜|납품일|설치일|일자|일정/, 'date'],
  [/인터넷/, 'internet'],
  [/pc.*대수|설치.*인원|인원수|사용.*인원|대수/, 'pcCount'],
  [/mac|맥/, 'mac'],
  [/계산서.*메일|세금계산서|계산서/, 'taxMail'],
  [/계약서.*메일|계약.*메일/, 'contractMail'],
  [/사무실|팩스|대표.*번호|회사.*전화|전화번호/, 'phone'],
  [/결제.*계약|계약.*결제|발주(?!일)/, 'payContract'],
  [/결제/, 'payer'],
  [/계약.*담당/, 'contractor'],
  [/복합기.*담당|pc.*담당|it.*담당|기기.*담당|담당자|^성함|^이름/, 'manager'],
  [/상주|현장.*담당/, 'resident'],
  [/^사양|PC\s*사양|노트북\s*사양/, 'spec'],
  [/물품|품목|모델|기종|장비/, 'items'],
  [/계약기간|약정|기간/, 'months'],
  [/보증금/, 'deposit'],
  [/기본료|렌탈료|임대료|월.*금액/, 'rent'],
  [/기본매수|기본.*매수|매수|기본조건/, 'counts'],
  [/추가조건|추가.*조건|추가.*혜택|혜택/, 'extra'],
  [/결제.*특이|결제.*방법|결제일/, 'payNote'],
  [/업종/, 'industry'],
  [/해피콜/, 'skip'],
];
const LABEL: Record<string, string> = {
  company: '상호', date: '납품일', address: '설치주소', special: '특이사항', taxMail: '계산서메일', contractMail: '계약서메일', phone: '회사전화', fax: '팩스',
  payer: '결제담당', contractor: '계약담당', manager: '담당', resident: '현장상주자', items: '품목', months: '계약기간', deposit: '보증금', rent: '월 렌탈료',
  counts: '기본매수·초과', sales: '영업담당', inflow: '유입담당', installCount: '설치인원수', industry: '업종', payNote: '결제특이', extra: '추가조건·혜택',
};

const keyOf = (k: string) => KEYS.find(([re]) => re.test(norm(k)))?.[1] ?? null;
const num = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;

/** '2026년 11월 20일 금요일' · '11/20(금)' · '2026-11-20' · '11월 20일' → YYYY-MM-DD */
export function parseDate(s: string, today = new Date()): string {
  const y0 = today.getFullYear();
  let m = /(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // '26.11.26' · '26-11-26' (연도 두 자리)
  m = /(?<![\d])(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?![\d])/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `20${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /(\d{1,2})\s*[월./\-]\s*(\d{1,2})\s*일?/.exec(s);
  if (m) {
    const mo = +m[1];
    // 연말에 1~2월 날짜를 적으면 내년
    const y = mo < today.getMonth() + 1 - 6 ? y0 + 1 : y0;
    return `${y}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return '';
}

/** '3년' → 36 · '36개월' → 36 · '3개월' → 3 */
export function parseMonths(s: string): string {
  const y = /(\d+(?:\.\d+)?)\s*년/.exec(s);
  if (y) return String(Math.round(Number(y[1]) * 12));
  const m = /(\d+)\s*개?월/.exec(s) ?? /^(\d+)$/.exec(s.trim());
  return m ? String(+m[1]) : '';
}

/** 기본매수: '300/3000/90/9' (컬기본/흑기본/컬초과/흑초과) · '컬 1,000매/90원 흑 2,000매/9원' · '흑 3000매 10원' */
export function parseCounts(s: string): Partial<ConfItem> {
  const out: Partial<ConfItem> = {};
  // '컬 500/흑3000/100/10' = 컬 기본 / 흑 기본 / 컬 초과 / 흑 초과
  const four = /컬(?:러)?\D*?([\d,]+)\s*매?\s*\/\s*흑(?:백)?\D*?([\d,]+)\s*매?\s*\/\s*([\d,]+)\s*원?\s*\/\s*([\d,]+)/.exec(s);
  if (four) return { baseColor: String(num(four[1])), baseMono: String(num(four[2])), overColor: String(num(four[3])), overMono: String(num(four[4])) };
  // '컬'·'흑' 다음엔 숫자 아닌 글자만 건너뜀 ('흑3000/9' 처럼 붙여 써도 3000매/9원 — 예전엔 \S* 가 '3000/' 까지 삼켜 9매가 됨)
  // 매수와 초과 단가 사이: '/' · '장당' · '초과' ('흑 17,500매 장당 9원' — 2026-11-24 OO상사) [IT 가림]
  const c = /컬(?:러)?[^\d흑]*?([\d,]+)\s*매?\s*(?:\/|(?:초과\s*)?장당|초과)?\s*([\d,]+)?\s*원?/.exec(s);
  const k = /흑(?:백)?[^\d컬]*?([\d,]+)\s*매?\s*(?:\/|(?:초과\s*)?장당|초과)?\s*([\d,]+)?\s*원?/.exec(s);
  if (c || k) {
    if (c) (out.baseColor = String(num(c[1]))), c[2] && (out.overColor = String(num(c[2])));
    if (k) (out.baseMono = String(num(k[1]))), k[2] && (out.overMono = String(num(k[2])));
    // 초과 단가를 괄호에 따로: '컬300흑2000 (90,9)' · '(90/9)' · '(초과 90원, 9원)' → 컬러 90 · 흑백 9 (2026-11-24)
    const par = /\(\s*[^\d)]*([\d]+)\s*원?\s*[,/·]\s*([\d]+)\s*원?\s*\)/.exec(s);
    if (par && !out.overColor && !out.overMono) {
      if (c) (out.overColor = par[1]), (out.overMono = par[2]);
      else out.overMono = par[1];
    } else if (!out.overColor && !out.overMono) {
      const one = /\(\s*[^\d)]*(\d+)\s*원?\s*\)/.exec(s); // 흑백만: '흑3000 (10)'
      if (one && k && !c) out.overMono = one[1];
    }
    return out;
  }
  const v = s.match(/[\d,]+/g)?.map(num) ?? [];
  if (v.length >= 4) return { baseColor: String(v[0]), baseMono: String(v[1]), overColor: String(v[2]), overMono: String(v[3]) };
  if (v.length === 2) return { baseMono: String(v[0]), overMono: String(v[1]) }; // 흑백만
  return out;
}

const PC_RE = /데스크|노트북|모니터|맥북|아이맥|PC\b|본체|태블릿|그램/i;
/** 물품 한 덩어리 → 품목들: 'SL-X3220NR(새기기) 1대, 24인치 모니터 2대' */
export function parseItems(s: string): ConfItem[] {
  return s
    .split(/\s*(?:,|\/(?=\s*[A-Za-z가-힣])|\n|;|그리고|외\s)\s*/)
    .map((x) => x.trim())
    .filter((x) => x && !EMPTY.test(x))
    .map((x) => {
      const it = PC_RE.test(x);
      const e = emptyItem(it ? 'it' : 'mfp');
      const qty = /(\d+)\s*대/.exec(x);
      const state = /리퍼|중고/.test(x) ? '중고기' : '새기기';
      const model = x
        .replace(/\(?\s*(새\s*기기|새기|신품|리퍼|중고\s*기?)\s*\)?/g, '')
        .replace(/\d+\s*대/, '')
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const cat = it
        ? /노트북|그램|맥북/.test(x)
          ? '노트북'
          : /모니터/.test(x)
            ? '모니터'
            : '데스크탑'
        : /흑백|K\d{4}|M\d{4}/i.test(x)
          ? '흑백복합기'
          : '컬러복합기';
      return { ...e, cat, model, state, qty: qty ? +qty[1] : 1 };
    });
}

/** 카톡 글 전체 → 확인서 칸 */
export function parseKakao(text: string): ParseResult {
  const fields: Record<string, string> = {};
  const unknown: string[] = [];
  let last: string | null = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/^[\s#ㄴ└>\-•*·]*(\d+\s*[.)]\s*)?[\s#ㄴ└>\-•*·]*/, '').trim();
    if (!line || /^(납품|교체|철수|이전|반출)$/.test(line)) continue;
    // 첫 줄 '납품(현장/단기)' · '납품(일반/장기)' → 구분 (현장 확인서 양식)
    const hd = /^납품\s*\(([^)]*)\)\s*(.*)$/.exec(line);
    if (hd && !Object.keys(fields).length) {
      if (/현장/.test(hd[1])) fields.term = '현장/단기';
      else if (/일반/.test(hd[1]) && !/단기/.test(hd[1])) fields.term = '일반/장기';
      else if (/단기/.test(hd[1])) fields.term = '현장/단기'; // '단기'만 → 확인서 구분은 두 가지라 현장/단기로 (2026-11-25 OO상사) [IT 가림]
      // 위탁사: '위탁 : OO상사 위탁' · '> OO상사 위탁' · '[OO상사 발주]' · 'X 직송' [IT 가림]
      const whole = `${hd[1]} ${hd[2]}`;
      const cm = /(?:^|[>:：/\[\s])\s*([^\s:：/>\[\]()]+?)\s*(위탁|직송|발주)(?![가-힣])/.exec(whole.replace(/위탁\s*[:：]\s*/, ' '));
      if (cm && !/^(단기|장기|현장|일반)$/.test(cm[1])) (fields.consign = cm[1]), (fields.shipType = cm[2] === '직송' ? '직송' : '위탁');
      continue;
    }
    let m = /^([^:：]{1,30})[:：]\s*(.*)$/.exec(line);
    // 콜론 없이 '설치일 11/25' · '보증금 면제' — 앞 한두 단어가 항목 이름이면 새 항목
    if (!m) {
      const w = line.split(/\s+/);
      for (const n of [2, 1]) {
        if (w.length > n && keyOf(w.slice(0, n).join(' ')) && norm(w.slice(0, n).join('')).length <= 10) {
          m = Object.assign([line, w.slice(0, n).join(' '), w.slice(n).join(' ')], { index: 0, input: line }) as unknown as RegExpExecArray;
          break;
        }
      }
    }
    if (m && /미기재/.test(m[1])) {
      last = 'memo';
      fields.memo = m[2].trim();
      continue;
    }
    const key = m ? keyOf(m[1]) : null;
    if (m && key) {
      last = key;
      const v = m[2].trim();
      fields[key] = fields[key] ? `${fields[key]} / ${v}` : v;
    } else if (last && !m) {
      fields[last] = `${fields[last] ?? ''}\n${line}`.trim(); // 다음 줄로 이어 쓴 내용
    } else unknown.push(line);
  }

  const p: Partial<ConfDoc> = {};
  const filled = new Set<string>();
  const put = <K extends keyof ConfDoc>(k: K, v: ConfDoc[K] | undefined, label = k as string) => {
    if (v === undefined || v === '' || (typeof v === 'string' && EMPTY.test(v.trim()))) return;
    p[k] = v;
    filled.add(LABEL[label] ?? label);
  };
  const val = (k: string) => (fields[k] ?? '').trim();

  put('company', val('company'));
  if (val('consign')) (p.consign = val('consign')), (p.shipType = val('shipType') || '위탁'), filled.add('위탁사');
  put('deliveryDate', parseDate(val('date')), 'date');
  // 설치주소 끝에 (엘베 유무 · 주소 특이사항) — 특이사항 칸에는 납품 시 특이사항 + 맨 아래 특이사항만
  const elev = val('elevator');
  const addrExtra = [
    elev && `엘베 ${/무|없|x/i.test(elev) ? '무' : /유|있|o/i.test(elev) ? '유' : elev}`,
    !EMPTY.test(val('addrNote')) && val('addrNote'),
  ].filter(Boolean);
  put('address', [val('address').replace(/\s*\n\s*/g, ' '), addrExtra.length ? `(${addrExtra.join(' · ')})` : ''].filter(Boolean).join(' '));
  put('special', val('special').replace(/\s*\n\s*/g, ' · '));
  put('installCount', val('pcCount').replace(/^pc\s*/i, ''), 'installCount');
  // '기존동일 / 12월 1일자로 계산서 발행요청 …' → 메일은 앞만, 뒤 메모는 결제 특이로 (2026-11-25)
  const [taxMail0, ...taxMore] = val('taxMail').split(/\s*\/\s*/);
  put('taxMail', taxMail0 ?? '');
  const payMore: string[] = taxMore.filter((x) => x && !/@/.test(x));
  const cm = val('contractMail');
  put('contractMail', /상동|동일|위와|같음/.test(cm) && val('taxMail') ? val('taxMail') : cm);
  const phones = val('phone').match(/0\d{1,2}[-\s)]?\d{3,4}[-\s]?\d{4}/g) ?? [];
  if (phones[0]) put('phone', phones[0]);
  if (phones[1]) put('fax', phones[1], 'fax');
  else if (phones[0] && /팩스|fax/i.test(val('phone')) && /\//.test(val('phone'))) put('fax', phones[0], 'fax');
  if (val('payContract')) put('payer', val('payContract')), put('contractor', val('payContract'));
  put('payer', val('payer') || p.payer);
  put('contractor', val('contractor') || p.contractor);
  put('manager', val('manager'));
  put('resident', val('resident'));
  put('industry', val('industry'));
  // 결제 특이: 적힌 것 + 계산서 메일 뒤 메모 + 보증금 괄호 조건('면제(단,2개월 선납조건)')
  const depCond = /\(([^)]*)\)/.exec(val('deposit'))?.[1]?.replace(/^단\s*,?\s*/, '');
  const payAll = [val('payNote'), ...payMore, depCond ? `보증금 면제 조건: ${depCond}` : ''].filter(Boolean).join(' · ');
  put('payNote', payAll);
  put('extra', val('extra').replace(/\s*[,\n]\s*/g, ' · '));
  const sales = val('sales').split(/[/,]/).map((x) => x.trim()).filter(Boolean);
  if (sales.length >= 2) put('inflow', sales[0]), put('sales', sales[1]);
  else if (sales[0]) put('sales', sales[0]), put('inflow', sales[0]); // 한 명이면 유입·영업 모두
  if (val('inflow')) put('inflow', val('inflow'));
  put('months', val('months').replace(/\s+/g, ' ').trim(), 'months'); // 적은 그대로 ('3년' · '6개월 이상')
  const dep = val('deposit');
  if (dep) put('deposit', /면제|없|무/.test(dep) ? '0' : String(wonNum(dep) || ''), 'deposit'); // '20만원' → 200000

  // 품목 + 기본료·기본매수 (품목이 하나면 그 품목에, 여럿이면 첫 품목에 기본료 합계)
  const blk = parseItemBlock(text);
  const perRent = parseRentBlock(text);
  let items = blk?.items.length ? blk.items : parseItems(val('items'));
  // 물품 줄마다 '/ 대당 N원'이 있으면 그 값이 우선 ('10. 기본료' 줄은 사람이 보는 요약 — 대형거래처 견적 글)
  const lineRent = !!blk?.used.some((l) => /\/\s*(?:대당\s*[\d,.]+\s*(?:만\s*원?|원)|기간\s*총액\s*[\d,]+\s*원|단가\s*문의|(?:월\s*)?[\d,.]+\s*(?:만\s*원?|원))\s*$/.test(l));
  if (!lineRent && Object.keys(perRent.per).length) items = items.map((it) => ({ ...it, rent: (perRent.per[itemGroup(it.cat)] ?? 0) * (it.qty || 1) || it.rent }));
  if (blk?.supplies.length) (p.supplies = blk.supplies), filled.add('소모품');
  // '대당 4만원 별도 / 매입가 대당 2만원 별도(100%마진)' → 매입가 앞 금액만 (예전엔 숫자를 붙여 42,100원이 됨 — 2026-11-25)
  const rentText = val('rent').split(/\s*\/\s*(?=매입|원가|위탁)|매입가|원가/)[0];
  const rent = wonNum(rentText.replace(/[^\d,.원만천억]/g, ''));
  const counts = parseCounts(val('counts'));
  // '14. 사양 : 윈11프로/15.6인치/…' (번호 항목) → 사양 칸이 빈 노트북·데스크탑에 (2026-11-24)
  if (val('spec')) {
    items = items.map((it) => (hasSpec(it.cat) && !Object.values(it.spec ?? {}).some(Boolean) ? { ...it, spec: parseSpec(val('spec'), it.cat) } : it));
    filled.add('사양');
  }
  if (!items.length && (rent || Object.keys(counts).length)) items = [emptyItem('mfp')];
  if (items.length) {
    const multiRent = Object.keys(perRent.per).length > 0;
    // 기본매수·초과는 복합기마다 · 기본료가 하나면 첫 품목에
    const perUnit = /대당/.test(val('rent')) && items.length === 1; // '대당 167,500원' × 2대 = 335,000 (2026-11-24 OO상사) [IT 가림]
    // 흑백 매수만 적혀 있고 '컬러'라는 말이 없으면 흑백기
    const monoOnly = counts.baseMono && !counts.baseColor && !counts.overColor;
    items = items.map((it, i) => ({
      ...it,
      ...(isMfpCat(it.cat) && !/플로터/.test(it.cat) ? counts : {}),
      cat: monoOnly && it.cat === '컬러복합기' && !/컬러/.test(text) ? '흑백복합기' : it.cat,
      rent: multiRent || lineRent ? it.rent : i === 0 ? (rent ? rent * (perUnit ? it.qty || 1 : 1) : it.rent) : it.rent,
    }));
    p.items = items;
    filled.add('품목');
    if (rent || lineRent) filled.add('월 렌탈료');
    if (Object.keys(counts).length) filled.add('기본매수·초과');
  }
  const kind: ConfKind | null = items.length ? (items.every((i) => !isMfpCat(i.cat)) ? 'it' : 'mfp') : null;
  // 알아보지 못한 줄 + 확인서에 칸이 없는 정보(유입경로·추가조건 등)는 참고로
  if (val('calendar')) (p.head = val('calendar')), filled.add('앞머리글');
  if (fields.term) (p.term = fields.term as ConfDoc['term']), filled.add('구분');
  if (val('route')) (p.route = val('route')), filled.add('유입경로');
  const ref = [val('memo') && `(확인서에 안 넣은 미기재 메모) ${val('memo')}`, val('internet') && `인터넷: ${val('internet')}`, val('mac') && !EMPTY.test(val('mac')) && `MAC: ${val('mac')}`].filter(Boolean) as string[];
  // 물품·기본료 덩어리에서 읽은 줄은 '못 알아본 줄'에서 뺌
  const usedSet = [...(blk?.used ?? []), ...perRent.used].map((x) => norm(x)).filter(Boolean);
  const left = unknown.filter((u) => !usedSet.some((x) => norm(u).includes(x) || x.includes(norm(u))));
  return { patch: p, kind, filled: [...filled], unknown: [...ref, ...left] };
}

/* ───────── 물품 덩어리 · 품목별 기본료 (여러 품목이 섞인 글) — 2026-11-24 ─────────
 *  10. 물품 :
 *  SL-X4225RX(현장용) 1대 / T650(A0 플로터) 1대 / I5 고급설계/디자인 데스크탑 3대 / 27인치 모니터 6대   ← 한 줄 = 한 품목 ('/' 로 자르지 않음)
 *  > 무상 소모품 : 공유기 1개, 허브 공유기 1개 , 랜선 5개      → 소모품(무상)
 *  > 청구 소모품 :  1) … - 1박스 기준 35,000원 별도 / 2) … 개당 49,000원 …  → 소모품(청구, 단가)
 *  > 사양:  I5, 16GB, 500GB , 1TB , 3070 외장                  → PC 사양 (CPU·RAM·SSD·HDD·그래픽 순)
 *  13. 기본료 : 복합기 대당 : 20만원 / 플로터 대당 : 20만원 / 데탑대당 150,000원 / 모니터대당 30,000원  → 품목별 대당 × 수량
 */
const stripNo = (l: string) => l.replace(/^[\s#＃ㄴ└•*·]*(\d+\s*[.]\s*)?[\s#＃ㄴ└•*·]*/, '').trim();
const keyLine = (l: string) => /^([^:：]{1,30})[:：]\s*(.*)$/.exec(stripNo(l));
/** 원/만원 글 → 숫자 ('20만원' → 200000 · '150,000원' → 150000) */
function wonOf(s: string): number {
  const t = String(s ?? '').replace(/\s/g, '');
  const man = /([\d,.]+)만/.exec(t);
  if (man) return Math.round(Number(man[1].replace(/,/g, '')) * 10000);
  const n = /([\d,]+)원/.exec(t) ?? /([\d,]{4,})/.exec(t);
  return n ? Number(n[1].replace(/,/g, '')) || 0 : 0;
}
/** 품목 줄 → 품목구분 */
export function catOfLine(s: string): string {
  if (/플로터|DesignJet|\bT\d{3}\b/i.test(s)) return '플로터';
  if (isInkjet(s)) return '무한프린터'; // 잉크젯 = 무한프린터 (HP9010 등 · 2026-11-25)
  if (/모니터/.test(s)) return '모니터';
  if (/맥북|macbook/i.test(s)) return '맥북';
  if (/노트북|그램|갤럭시\s*북|\bNT\d{3}|\b\d{2}Z\d{2}/i.test(s)) return '노트북'; // 삼성 NT··· · LG 15Z90··· (2026-11-25)
  if (/데스크탑|데탑|본체|\bPC\b|설데|고사양|\b[Ii][3579](?![\d-])/i.test(s)) return '데스크탑'; // 고설데·일설데 · 'I7고설데' (2026-11-25)
  if (/태블릿|아이패드/.test(s)) return '태블릿';
  if (/공기청정기|세단기|파쇄기|문서세단/.test(s)) return '기타'; // 대형거래처 발주 (2026-11-24)
  if (/흑백|\bSL-?[KM]\d{4}/i.test(s)) return '흑백복합기'; // 삼성 SL-K·SL-M = 흑백기 (2026-11-24 OO상사 SL-K6300LX) [IT 가림]
  if (/프린터/.test(s)) return '컬러프린터';
  return '컬러복합기';
}
export const isMfpCat = (c: string) => /복합기|프린터|플로터/.test(c ?? '');
/** 기본료 덩어리의 품목 낱말 → 묶음 */
const rentGroup = (s: string) => (/플로터/.test(s) ? '플로터' : /모니터/.test(s) ? '모니터' : /노트북|맥북/.test(s) ? '노트북' : /데탑|데스크|PC|본체/i.test(s) ? '데스크탑' : /복합기|프린터/.test(s) ? '복합기' : '');
export const itemGroup = (cat: string) => (cat === '플로터' ? '플로터' : cat === '모니터' ? '모니터' : /노트북|맥북/.test(cat) ? '노트북' : cat === '데스크탑' ? '데스크탑' : isMfpCat(cat) ? '복합기' : '');

/** 한 항목(key) 아래 줄들 (다음 번호 항목 전까지) */
function blockOf(text: string, isKey: (k: string) => boolean): { first: string; lines: string[] } | null {
  const ls = text.replace(/\r/g, '').split('\n');
  const i = ls.findIndex((l) => {
    const m = keyLine(l);
    return !!m && isKey(m[1]);
  });
  if (i < 0) return null;
  const lines: string[] = [];
  for (let j = i + 1; j < ls.length; j++) {
    const raw = ls[j].trim();
    if (!raw) continue;
    // 다음 번호 항목('11. 계약기간 :') · '＃.' 항목이면 끝
    if (/^\d+\s*\.\s*\S/.test(raw) || /^[#＃]/.test(raw)) break;
    // 번호 없는 다음 항목('약정: 36개월' · '렌탈료: 9만원')도 끝 — '>' 로 시작하는 줄(소모품·사양)은 덩어리 안
    const km = /^[>›▶ㄴ└]/.test(raw) || /^[\-•]\s*.*소모품/.test(raw) ? null : keyLine(raw);
    if (km && keyOf(km[1]) && !isKey(km[1])) break;
    lines.push(raw);
  }
  return { first: keyLine(ls[i])![2].trim(), lines };
}

export function parseItemBlock(text: string): { items: ConfItem[]; supplies: ConfDoc['supplies']; used: string[] } | null {
  const b = blockOf(text, (k) => keyOf(k) === 'items');
  if (!b) return null;
  const items: ConfItem[] = [];
  const supplies: ConfDoc['supplies'] = [];
  const used: string[] = [];
  let spec = '';
  let mode: 'items' | 'free' | 'paid' = 'items';
  let lastHadQty = true; // 앞 품목 줄에 'N대'가 있었나 — 없으면 다음 '-' 설명 줄이 그 품목의 수량·사양
  const addItem = (line0: string) => {
    // 줄 끝 단가: 'I5 일반사무용 데스크탑 2대 / 대당 50,000원' · '/ 단가문의' (대형거래처 발주 글 — 2026-11-24)
    const pm = /\s*\/\s*(?:대당\s*([\d,.]+\s*(?:만\s*원?|원))|단가\s*문의|기간\s*총액\s*[\d,]+\s*원|(?:월\s*)?([\d,.]+\s*(?:만\s*원?|원)))\s*$/.exec(line0); // 기간총액(가구 등)은 월 임대료에 안 넣음
    const line = pm ? line0.slice(0, pm.index) : line0;
    const unit = pm?.[1] ? wonNum(pm[1]) : 0;
    const lineTotal = pm?.[2] ? wonNum(pm[2]) : 0; // '1대 / 11만원' — 대당 없이 적힌 금액 = 그 줄 합계 (2026-11-25)
    const q = [...line.matchAll(/(\d+)\s*대/g)];
    const qty = q.length ? Number(q[q.length - 1][1]) : 1;
    // '(새기기)' · '(리퍼)' 같은 상태 표시는 모델명에서 빼고 기기상태로 · '(현장용)' 등 다른 괄호는 그대로
    const model = line
      .replace(/\(?\s*(새\s*기기|새기|신품|리퍼|중고\s*기?)\s*\)?/g, '')
      .replace(/\s*\d+\s*대\s*$/, '')
      .replace(/\s+\d+\s*대(?=\s|$)/g, '')
      .trim();
    if (!model) return;
    const cat = catOfLine(model);
    const e = emptyItem(isMfpCat(cat) ? 'mfp' : 'it');
    items.push({ ...e, cat, model, qty, state: /리퍼|중고/.test(line) ? '중고기' : '새기기', ...(unit ? { rent: unit * qty } : lineTotal ? { rent: lineTotal } : {}) });
    lastHadQty = q.length > 0;
  };
  /** 'NT551XCJ-K04/C' 다음 줄 '- 15, ram 8GB, ssd 256G, 15 / 오피스 설치x 삼성노트북 17대' → 한 품목 (2026-11-25 OO상사) [IT 가림] */
  const mergeDesc = (desc: string): boolean => {
    const prev = items[items.length - 1];
    if (!prev || lastHadQty) return false;
    const q = [...desc.matchAll(/(\d+)\s*대/g)];
    if (q.length) prev.qty = Number(q[q.length - 1][1]);
    const cat = catOfLine(`${prev.model} ${desc}`);
    if (cat !== prev.cat) Object.assign(prev, { ...emptyItem(isMfpCat(cat) ? 'mfp' : 'it'), ...prev, cat });
    if (hasSpec(prev.cat)) prev.spec = { ...parseSpec(desc.replace(/[^,/]*\d+\s*대[^,/]*/g, ''), prev.cat), ...(prev.spec ?? {}) };
    const note = desc
      .split(/\s*[,/]\s*/)
      .map((x) => x.replace(/\S*(노트북|데스크탑|데탑|모니터|PC)\s*\d+\s*대/gi, '').replace(/\d+\s*대/g, '').trim())
      .filter((x) => /[가-힣]/.test(x) && !/^(노트북|데스크탑|모니터)$/.test(x))
      .join(' · ');
    if (note) prev.place = [prev.place, note].filter(Boolean).join(' · ');
    if (/리퍼|중고/.test(desc)) prev.state = '중고기';
    lastHadQty = true;
    return true;
  };
  for (const raw of [b.first, ...b.lines].filter(Boolean)) {
    const gt = /^[>›▶]\s*(.*)$/.exec(raw) ?? (/^[ㄴ└]\s*(.*(?:소모품|사양).*)$/.exec(raw) as RegExpExecArray | null) ?? (/^[\-•]\s*(.*소모품.*)$/.exec(raw) as RegExpExecArray | null);
    if (gt) {
      used.push(gt[1]);
      const body = gt[1];
      const after = body.replace(/^[^:：]*[:：]\s*/, '').trim();
      if (/무상\s*소모품/.test(body)) {
        mode = 'free';
        for (const x of after.split(/[,，]/).map((y) => y.trim()).filter(Boolean)) {
          const q = /(\d+)\s*(개|EA|ea|롤|박스|대|세트|set)?\s*$/i.exec(x);
          supplies.push({ name: x.replace(/\s*\d+\s*(개|EA|ea|롤|박스|대|세트|set)?\s*$/i, '').trim(), qty: q ? q[1] : '1', charge: '무상', price: '', note: /회수\s*조건/.test(body) ? '회수조건' : '' });
        }
      } else if (/청구\s*소모품/.test(body)) {
        mode = 'paid';
        // 같은 줄에 적은 것 (쉼표 뒤가 숫자면 금액 쉼표라 안 자름 — 2026-11-26)
        for (const x of after.split(/\s*[,，]\s*(?=[^\d\s])/).map((y) => y.trim()).filter(Boolean)) {
          const price = /([\d,]+)\s*원/.exec(x)?.[1] ?? '';
          const xs = x.replace(/\s*\(([^)]*)\)/g, (all: string, inner: string) => (/원/.test(inner) ? '' : all)).replace(/\s*[\d,]+\s*원.*$/, '').trim();
          const q = /\s(\d+)\s*(개|EA|ea|세트|set)\s*$/i.exec(xs);
          const name = q ? xs.slice(0, q.index).trim() : xs;
          if (name) supplies.push({ name, qty: q ? q[1] : '1', charge: '청구', price: price ? `${price}원` : '', note: /별도/.test(x) ? 'VAT별도' : '' });
        }
      }
      else if (/소모품/.test(body)) {
        // '소모품(무상회수조건) : XX 랜선, 중고공유기 XX, 현장에있음' — 정리된 목록이 아니면 한 줄 그대로 (비고)
        const label = body.replace(/[:：].*$/, '').trim();
        supplies.push({ name: label, qty: '', charge: /무상/.test(label) ? '무상' : '청구', price: '', note: after });
      }
      else if (/사양/.test(body)) {
        const prev = items[items.length - 1];
        if (/^[ㄴ└]/.test(raw) && prev && hasSpec(prev.cat)) prev.spec = parseSpec(after, prev.cat); // 'ㄴ 사양' = 바로 위 품목 것
        else spec = after;
      }
      continue;
    }
    if (mode === 'paid' && /^\(?\d+\s*\)/.test(raw)) {
      used.push(raw);
      const s = raw.replace(/^\(?\d+\s*\)\s*/, '');
      const [name, ...rest] = s.split(/\s+-\s+/);
      const restT = rest.join(' - ');
      const per = /개당\s*([\d,]+)\s*원/.exec(restT)?.[1] ?? /([\d,]+)\s*원/.exec(restT)?.[1] ?? '';
      const qty = /(\d+)\s*EA/i.exec(s)?.[1] ?? '1';
      supplies.push({ name: name.trim(), qty, charge: '청구', price: per ? `${per}원` : '', note: restT.replace(/\s*\/?\s*매입가.*$/, '').trim() });
      continue;
    }
    mode = 'items';
    used.push(raw);
    if (/^[-·•]\s*/.test(raw) && mergeDesc(raw.replace(/^[-·•]\s*/, ''))) continue;
    // 한 줄에 여러 품목: '그램 15 노트북 2대, 24인치 모니터 2대' → 쉼표로 나눔 (각 조각에 'N대'가 있을 때만)
    const parts = raw.split(/\s*[,，]\s*/);
    if (parts.length > 1 && parts.every((x) => /\d+\s*대/.test(x))) parts.forEach(addItem);
    else addItem(raw);
  }
  // PC 사양: 'I5, 16GB, 500GB, 1TB, 3070 외장' → 데스크탑·노트북에 CPU·RAM·SSD·HDD·그래픽 순
  if (spec) for (const it of items) if (hasSpec(it.cat)) it.spec = parseSpec(spec, it.cat);
  return { items, supplies, used };
}

/**
 * PC 사양 글 → 칸 (순서와 상관없이 낱말로 고름 — 2026-11-24 OO상사 '윈11프로/15.6인치/울트라5-225H/내장/16GB/256GB') [IT 가림]
 *  OS(윈·Win) · 인치 · CPU(i5·울트라·라이젠·셀러론·M1…) · 그래픽(내장·외장·RTX·GTX·3050…) · 용량: 64GB 이하 첫 값 = RAM, 그다음 SSD, 그다음 HDD ('HDD'·'SSD'라고 적혀 있으면 그 칸)
 *  알아보지 못한 조각은 빈 칸에 예전 순서(CPU·RAM·SSD·HDD·그래픽)대로
 */
export function parseSpec(text: string, cat: string): Record<string, string> {
  const keys = specKeys(cat);
  const out: Record<string, string> = {};
  const rest: string[] = [];
  const put = (k: string, v: string) => {
    if (keys.includes(k as never) && !out[k]) return (out[k] = v.replace(/^(?:ram|ssd|hdd|cpu|os|메모리|램)\s*[:：]?\s*/i, '')), true; // 'ram 8GB' → '8GB'
    return false;
  };
  for (const v of String(text ?? '').split(/\s*[,，/]\s*/).map((x) => x.trim()).filter(Boolean)) {
    const cap = /(\d+(?:\.\d+)?)\s*(GB|G|기가|TB|T|테라)\b/i.exec(v);
    const gb = cap ? Number(cap[1]) * (/T|테라/i.test(cap[2]) ? 1024 : 1) : 0;
    if (/윈도우|윈\s*\d|win\s*\d|windows|mac\s*os|macos|리눅스|linux|free\s*dos|프리도스|노\s*OS/i.test(v)) put('OS', v) || rest.push(v);
    else if (/\d{2}(?:\.\d)?\s*(인치|"|inch)/i.test(v)) put('인치', v) || rest.push(v);
    else if (/\bi\s?[3579]\b|i[3579][-\s]|울트라|ultra|코어|core|라이젠|ryzen|셀러론|celeron|펜티엄|pentium|\bM[1-4]\b|인텔|intel/i.test(v)) put('CPU', v) || rest.push(v);
    else if (/내장|외장|RTX|GTX|지포스|geforce|라데온|radeon|그래픽|\b(?:10|16|20|30|40|50)[5-9]0\b/i.test(v) && !gb) put('그래픽', v) || rest.push(v);
    else if (gb && /HDD/i.test(v)) put('HDD', v) || rest.push(v);
    else if (gb && /SSD|NVMe/i.test(v)) put('SSD', v) || rest.push(v);
    else if (gb && gb <= 64 && !out.RAM && !/SSD|HDD/i.test(v)) put('RAM', v) || rest.push(v);
    else if (gb) put('SSD', v) || put('HDD', v) || rest.push(v);
    else rest.push(v);
  }
  // 모르는 조각: '15'(13~17) 숫자만이면 노트북 인치 · 한글 설명('오피스 설치x')은 사양에 안 넣음 · 나머지는 빈 칸에 예전 순서대로
  for (const v of rest) {
    if (/^1[3-7](?:\.\d)?$/.test(v) && keys.includes('인치' as never) && !out['인치']) {
      out['인치'] = `${v}인치`;
      continue;
    }
    if (/[가-힣]/.test(v) && !/[A-Za-z]\d|\d\s*(GB|TB)/i.test(v)) continue;
    for (const k of ['CPU', 'RAM', 'SSD', 'HDD', '그래픽', 'OS']) if (put(k, v)) break;
  }
  return out;
}

/** 품목별 대당 기본료: '복합기 대당 : 20만원' · '데탑대당 150,000원' → { 복합기: 200000, 데스크탑: 150000 } */
export function parseRentBlock(text: string): { per: Record<string, number>; used: string[] } {
  const b = blockOf(text, (k) => keyOf(k) === 'rent');
  const per: Record<string, number> = {};
  const used: string[] = [];
  if (!b) return { per, used };
  for (const raw of b.lines) {
    const g = rentGroup(raw);
    const n = wonOf(raw);
    if (g && n) (per[g] = n), used.push(raw);
  }
  // 한 줄에 품목 둘 이상: '노트북-57,000원 / 모니터 대당 5,000원' (2026-11-24 OO상사) — 품목 낱말이 두 개 이상일 때만 나눔 [IT 가림]
  const seg = b.first.split(/\s*[/，]\s*|\s*,\s*(?=\D)/).filter(Boolean); // 금액 안 쉼표(57,000)는 안 자름
  if (seg.filter((x) => rentGroup(x)).length >= 2)
    for (const x of seg) {
      const g = rentGroup(x);
      const n = wonOf(x);
      if (g && n && !per[g]) per[g] = n;
    }
  return { per, used };
}
