/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/swap.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob ff56bd529448db52585ba82e7e7fd9f94135c93f — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
import { parseDate } from './kakaoParse';
/**
 * 교체 확인서 (고장 교체 / 일반 교체) — 화면·서버·출력이 함께 쓰는 모양과 규칙
 *  고장 교체 = 교체 사유 '기기고장' (남색 · 고장/AS · 조건 기존동일 · 수리담당)
 *  일반 교체 = 재계약 · 기기상향 · 기기하향 · 기기불만 · 단순 (청록 · 조건 변경 표)
 *  한 건 = 여러 판 (고치면 새 판). 교체 후 기번·자산번호·카운터·여분은 출력한 종이에 직접 적음.
 *  카톡 선행방 '교체' 글(업체 통합검색 › 교체 양식)을 붙여 넣으면 칸이 채워짐 → parseSwapKakao
 *  kind: 'mfp' 복합기 교체 (카운터·토너·기본매수) / 'it' IT제품 교체 (기종·제조사·하드웨어·소프트웨어)
 */
export type SwapKind = 'mfp' | 'it';
/** 임대리스트 품목으로 복합기/IT 가르기 */
export const swapKindOf = (item: string): SwapKind => (!item || /복합기|프린터|팩스|세단기|스캐너/.test(item) ? 'mfp' : 'it');
export type SwapReason = '기기고장' | '재계약' | '기기상향' | '기기하향' | '기기불만' | '단순';
export const SWAP_REASONS: SwapReason[] = ['기기고장', '재계약', '기기상향', '기기하향', '기기불만', '단순'];
export type SwapContract = '' | '전자' | '수기' | '확인서 서명 필수'; // '' = 글에 없음 (2026-11-25 — 예전엔 기본 '전자')

export type SwapDoc = {
  id: string;
  kind: SwapKind;
  no: string; // C-261125-01
  ver: number;
  region: string; // 수도권A~E
  reason: SwapReason;
  reasonText: string; // 고장 내용 / 교체 사유(자세히)
  leaseNo: string; // 임대리스트 순번
  company: string; // 상호-현장명
  swapDate: string; // YYYY-MM-DD
  requester: string; // 교체요청 (영업 담당)
  shipType?: string; // 위탁 · 직송 (위탁사가 있을 때 — 현황표 납품담당)
  hanjo?: string; // 한조 코드 (복합기 · 임대리스트 '코드')
  leaseKind?: string; // 임대리스트 '일반/현장' (현황표 구분)
  leasePeriod?: string; // 임대리스트 계약기간 (예: 8개월 — 현장 단기/장기 가름)
  repair: string; // 수리담당 (고장 교체)
  address: string;
  special: string;
  contract: SwapContract;
  contractMail: string;
  before: { item: string; model: string; sn: string; asset: string; count: string; kindModel: string; maker: string; hw: string; sw: string };
  /** 교체 후 기번·자산번호는 보통 종이에 손으로 (알면 미리 적어도 됨) */
  after: { item: string; model: string; state: string; kindModel: string; maker: string; sn: string; asset: string; hw: string; sw: string };
  cond: { rentBefore: string; rentAfter: string; periodBefore: string; periodAfter: string; colorBefore: string; colorAfter: string; monoBefore: string; monoAfter: string; benefit: string };
  payer: string; // 결제·계약 담당
  contact: string; // 교체 요청자 (고객) 성함/번호
  mfpManager: string;
  itManager: string;
  /** 제목용 — 앞머리글(특이사항 머리) · 위탁사명(비우면 퍼스트) · 제목(비우면 자동) */
  head?: string;
  consign?: string;
  title?: string;
  savedBy?: string;
  savedAt?: string;
};

export const isFix = (d: Pick<SwapDoc, 'reason'>) => d.reason === '기기고장';

export function emptySwap(kind: SwapKind = 'mfp'): SwapDoc {
  return {
    id: '', kind, no: '', ver: 0, region: '', reason: '재계약', reasonText: '', leaseNo: '', company: '', swapDate: '', requester: '', repair: '퍼스트', address: '', special: '',
    contract: '', contractMail: '',
    before: { item: '', model: '', sn: '', asset: '', count: '', kindModel: '', maker: '', hw: '', sw: '' },
    after: { item: '', model: '', state: kind === 'it' ? '리퍼' : '새기기', kindModel: '', maker: '', sn: '', asset: '', hw: '', sw: '' },
    cond: { rentBefore: '', rentAfter: '', periodBefore: '', periodAfter: '', colorBefore: '', colorAfter: '', monoBefore: '', monoAfter: '', benefit: '' },
    payer: '', contact: '', mfpManager: '', itManager: '', head: '', consign: '', title: '', hanjo: '', shipType: '', leaseKind: '', leasePeriod: '',
  };
}

/** '2026년 11월 24일 화요일' · '2026-11-24' · '26.11.24' → 'YYYY-MM-DD' */
export function parseDay(s: string): string {
  const t = String(s ?? '');
  let m = /(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /\b(\d{2})\.(\d{1,2})\.(\d{1,2})\b/.exec(t);
  if (m) return `20${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return parseDate(t); // '11.26' · '11월 26일' · '11/26(목)' — 연도 없으면 올해 (2026-11-25)
}

/** '기존동일 (기존 150,000원)' → { now:'기존동일', old:'150,000원' } · '170,000원 (기존 150,000원)' → { now:'170,000원', old:'150,000원' } */
function nowOld(v: string) {
  const m = /^(.*?)\s*\(\s*기존\s*([^)]*)\)\s*$/.exec(v.trim());
  if (!m) return { now: v.trim(), old: '' };
  const now = m[1].trim();
  const old = m[2].trim();
  // 바뀐 값이 기존과 같으면 기존동일
  return { now: now.replace(/\s/g, '') === old.replace(/\s/g, '') ? '기존동일' : now, old };
}

/**
 * 카톡 선행방 '교체' 글 → 교체 확인서 칸
 *  1 캘린더 앞머리글 · 2 날짜 · 3 요청자 · 4 교체 사유 · 5 순번 · 6 업체명 · 7 담당자 성함/번호 · 8 주소
 *  9 물품: 기존 → 새 (+ 다음 줄 '(기존 물품 자산번호/SN: …)') · 10 계약기간 · 11 기본료 · 12 기본매수 · 13 추가 혜택 · 14 계약서 · 16 특이사항
 *  예전 양식(5 업체명(순 ○○) · 6 담당자 · 7 주소 · 8 물품 …)도 같은 칸 이름으로 알아봄
 *  못 알아본 줄은 unknown 으로 돌려줌
 */
export function parseSwapKakao(text: string): { doc: Partial<SwapDoc>; unknown: string[] } {
  const d: Partial<SwapDoc> = {};
  const before: Partial<SwapDoc['before']> = {};
  const after: Partial<SwapDoc['after']> = {};
  const cond: Partial<SwapDoc['cond']> = {};
  const unknown: string[] = [];
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim());
  let last = '';
  for (const raw of lines) {
    if (!raw || /^교체$/.test(raw)) continue;
    // 양식 안내 줄 '(고장교체시에는 CS인원 필수입력(대표님지시사항) : 요청자(본인), 지역팀, CSR, 외부)' 은 칸이 아님 (2026-11-26)
    if (/^[(（]/.test(raw) && /필수|지시|입력/.test(raw)) continue;
    // 값 없는 칸 이름만 있는 줄 ('5. 수리배정 담당자')
    if (/^(?:\d+\s*[.)]\s*)?수리\s*배정/.test(raw) && !/[:：]/.test(raw)) continue;
    // 물품 다음 줄: (기존 물품 자산번호/SN: X0000 / 000000000000) [IT 가림]
    const idl = /자산번호\s*\/?\s*SN\s*[:：]\s*([^)]*)\)?/i.exec(raw);
    if (idl) {
      const [a0, s0] = idl[1].split('/').map((x) => x.trim());
      before.asset = a0 ?? '';
      before.sn = s0 ?? '';
      continue;
    }
    const m = /^(?:\d+\s*[.)]\s*)?([^:：]{1,40}?)\s*[:：]\s*(.*)$/.exec(raw);
    const key = m ? m[1].replace(/\([^)]*\)/g, '').replace(/\s+/g, '') : '';
    const v = m ? m[2].trim() : raw;
    if (!m) {
      // 물품 다음 줄: (기존 물품 자산번호/SN: X0000 / 000000000000)  ·  D420 / X0000 / 0000… → D470(새기기) 1대 [IT 가림]
      const id = /자산번호\s*\/?\s*SN\s*[:：]\s*([^)]*)\)?/i.exec(raw);
      if (id) {
        const [a, s] = id[1].split('/').map((x) => x.trim());
        before.asset = a ?? '';
        before.sn = s ?? '';
      } else if (last === '물품' && /→|->|>/.test(raw)) parseItem(raw);
      else unknown.push(raw);
      continue;
    }
    last = '';
    if (/앞머리|글머리|캘린더|캐린더/.test(key)) d.head = v; // 제목 맨 앞 (특이사항 머리)
    else if (key === '날짜' || /교체일/.test(key)) d.swapDate = parseDay(v);
    else if (key === '요청자' || /영업.*담당|요청.*담당/.test(key)) d.requester = v;
    else if (/교체.*사유|철수사유|^사유$/.test(key)) {
      // '기기고장 - 캐리지 소음' · '기기고장, 캐리지 모터 굉음' → 사유 + 자세히
      //  사유 낱말로 시작할 때만 '-'·',' 뒤를 자세히로 · 아니면 글 전체가 자세히 ('AS 진행중 C현상기,C드럼 인식이 계속안됨' — 2026-11-26)
      const lead = SWAP_REASONS.find((x) => v.startsWith(x));
      const r = lead ?? (/고장|굉음|소음|불량|안\s*됨|에러|A\/?S|인식|걸림|파손|누수/i.test(v) ? '기기고장' : /불만/.test(v) ? '기기불만' : undefined);
      if (r) d.reason = r;
      if (lead) {
        const rest = v.slice(lead.length).replace(/^\s*[-–,，:]?\s*/, '');
        if (rest) d.reasonText = rest.trim();
      } else if (v) d.reasonText = v;
    } else if (/수리배정/.test(key)) {
      if (v) d.repair = v;
    } else if (key === '순번') d.leaseNo = v.replace(/[^\d,\s]/g, '').trim();
    else if (key === '업체명' || key === '상호') {
      // '업체명(순 ○○)' · 'OO상사 ( 00000 )' → 순번 [IT 가림]
      const sn = /\(\s*(?:순\s*)?(\d{1,6})\s*\)\s*$/.exec(v);
      if (sn) d.leaseNo = d.leaseNo || sn[1];
      d.company = v.replace(/\(\s*(?:순\s*)?\d{1,6}\s*\)\s*$/, '').trim();
    } else if (/^담당자/.test(key)) d.contact = v;
    else if (key === '성함' || key === '연락처' || key === '전화번호') {
      if (v) d.contact = [d.contact, v].filter(Boolean).join(' / ');
    } else if (key === '유입경로') {
      /* 확인서에는 안 씀 */
    } else if (key === '주소') d.address = v;
    else if (key === '물품') {
      last = '물품';
      if (v) parseItem(v);
    } else if (key === '계약기간') {
      // 예전 양식: 기기고장·기기불만이면 '36개월 (25.9.1 ~ 28.8.31)' 처럼 기존 기간만 적혀 옴 → 기존동일로 (2026-11-25 OO상사) [IT 가림]
      const st = /\(\s*(\d{2})\.(\d{1,2})\.(\d{1,2})\s*~/.exec(v);
      const startDay = st ? `20${st[1]}-${st[2].padStart(2, '0')}-${st[3].padStart(2, '0')}` : '';
      if (!/기존/.test(v) && startDay && startDay < (d.swapDate || new Date().toISOString().slice(0, 10))) {
        cond.periodAfter = '';
        cond.periodBefore = v.trim();
        continue;
      }
      const x = nowOld(v);
      cond.periodAfter = /기존동일/.test(x.now) ? '' : x.now;
      cond.periodBefore = x.old;
    } else if (key === '기본료') {
      const x = nowOld(v);
      cond.rentAfter = /기존동일/.test(x.now) ? '' : fmtWon(x.now);
      cond.rentBefore = fmtWon(x.old);
    } else if (key === '기본매수') {
      const x = nowOld(v);
      const sp = (s: string) => {
        const p = splitCount(s);
        return p ? [p.color, p.mono] : [fmtCount(s), ''];
      };
      const [cb, kb] = sp(x.old);
      cond.colorBefore = cb;
      cond.monoBefore = kb;
      if (!/기존동일/.test(x.now)) {
        const [ca, ka] = sp(x.now);
        cond.colorAfter = ca;
        cond.monoAfter = ka;
      }
      before.count = fmtCountPair(x.old);
    } else if (/추가혜택/.test(key)) cond.benefit = /기존동일/.test(v) ? '' : v;
    else if (key === '계약서') {
      if (/확인서/.test(v)) d.contract = '확인서 서명 필수';
      else if (/수기/.test(v)) d.contract = '수기';
      else d.contract = '전자';
      const mail = /[^\s@()]+@[^\s@()]+\.[^\s@()]+/.exec(v);
      if (mail) d.contractMail = mail[0];
    } else if (key === '특이사항') d.special = [d.special, v].filter(Boolean).join(' · ');
    else if (/장비소유주/.test(key)) {
      /* 확인서에는 안 씀 */
    } else unknown.push(raw);
  }
  function parseItem(s: string) {
    const [l, r] = s.split(/\s*(?:→|->|>)\s*/).map((x) => x.trim());
    const parts = (l ?? '').split('/').map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 3) {
      before.model = parts[0];
      before.asset = parts[1];
      before.sn = parts[2];
    } else before.model = parts[0] ?? '';
    const rr = (r ?? '').replace(/\s*\d+\s*대\s*$/, '').trim();
    const st = /\(\s*(새기기|새\s*장비|새\s*기계|신품|새것|중고|리퍼|중고기)\s*\)/.exec(rr);
    after.model = rr.replace(/\(\s*(새기기|새\s*장비|새\s*기계|신품|새것|중고|리퍼|중고기)\s*\)/, '').trim();
    if (st) after.state = st[1] === '중고기' ? '중고' : /^(새|신품)/.test(st[1]) ? '새기기' : st[1];
  }
  if (Object.keys(before).length) d.before = { ...emptySwap().before, ...before };
  if (Object.keys(after).length) d.after = { ...emptySwap().after, ...after };
  if (Object.keys(cond).length) d.cond = { ...emptySwap().cond, ...cond };
  return { doc: d, unknown };
}

/* ───────── 입력 정리 (적는 대로 받아서 모양 맞추기) ───────── */
const comma = (s: string) => {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && s.replace(/,/g, '') !== '' ? n.toLocaleString() : s;
};

/** 기본매수/초과단가 한 칸: '200/90' → '200매/90원' · '2000' → '2,000매' · '무제한' · '-' 그대로 */
export function fmtCount(s: string): string {
  const t = String(s ?? '').trim();
  if (!t || /기존동일/.test(t)) return t;
  const m = /^(무제한|-|[\d,]+)\s*매?\s*(?:\/\s*(-|[\d,.]+)\s*원?)?$/.exec(t);
  if (!m) return t;
  const a = /^[\d,]+$/.test(m[1]) ? `${comma(m[1])}매` : m[1];
  if (m[2] === undefined) return a;
  const b = /^[\d,.]+$/.test(m[2]) ? `${comma(m[2])}원` : m[2];
  return `${a}/${b}`;
}

/** '컬 200/90 흑 2000/9' → { color:'200매/90원', mono:'2,000매/9원' } (컬·흑 글자가 없으면 null) */
export function splitCount(s: string): { color: string; mono: string } | null {
  const t = String(s ?? '');
  if (!/컬|흑/.test(t)) return null;
  // 숫자 속 쉼표(2,500)는 그대로 두고, 끝에 붙은 구분 쉼표·점만 뗌
  const cut = (x?: string) => (x ?? '').trim().replace(/[,·\s]+$/, '');
  const c = cut(/컬(?:러)?\s*[:：]?\s*([^흑·]*)/.exec(t)?.[1]);
  const k = cut(/흑(?:백)?\s*[:：]?\s*([^컬·]*)/.exec(t)?.[1]);
  return { color: fmtCount(c), mono: fmtCount(k) };
}

/** 컬·흑 함께 적은 한 줄 정리: '컬 200/90 흑 2000/9' → '컬 200매/90원 · 흑 2,000매/9원' */
export function fmtCountPair(s: string): string {
  const p = splitCount(s);
  if (!p) return fmtCount(s);
  return [p.color && `컬 ${p.color}`, p.mono && `흑 ${p.mono}`].filter(Boolean).join(' · ');
}

/** 금액: '170000' · '170,000원' · '17만' → '₩170,000' (숫자가 아니면 그대로) */
export function fmtWon(s: string): string {
  const t = String(s ?? '').trim();
  if (!t || /기존동일/.test(t)) return t;
  const man = /^([\d,.]+)\s*만\s*원?$/.exec(t);
  if (man) return `₩${Math.round(Number(man[1].replace(/,/g, '')) * 10000).toLocaleString()}`;
  const m = /^₩?\s*([\d,]+)\s*원?$/.exec(t);
  return m ? `₩${Number(m[1].replace(/,/g, '')).toLocaleString()}` : t;
}
