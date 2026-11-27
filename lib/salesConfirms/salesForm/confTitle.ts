/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/confTitle.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob c8f8e40261ff511ff5f8875cd47e8e6700ee15ff — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 확인서 '제목' — 카톡 선행방에 확인서 사진과 함께 올리는 한 줄 (사용자 규칙 2026-11-23)
 *
 *  [★][앞머리글-][IT/]종류(일반|현장)/퍼스트/운영팀/…/계약서
 *   · 앞머리글(특이사항)이 있으면 맨 앞 + '-'      예) 전일연락필수-교체(일반)/…
 *   · IT 면 종류 앞에 'IT/'                        예) …-IT/납품(현장)/…
 *   · 퍼스트가 기기를 준비하면 '퍼스트/운영팀'
 *   · 위탁이면 맨 앞 ★ + '위탁납품' + 퍼스트 자리에 위탁사명 (운영팀 없음)   예) ★IT/위탁납품(일반)/OO상사/단순/OO상사/전자 [IT 가림]
 *   · ⭐ 는 중요한 문구에 사람이 직접 넣음 (앞머리글 칸의 ⭐ 버튼)
 *
 *  납품: …/납품(일반|현장)/퍼스트/운영팀/유입경로/상호-현장/모델(새기기|리퍼)[, …][, 소모품]/계약서
 *  교체: …/교체(일반)/퍼스트/운영팀/교체사유/상호/기존->새 모델(상태)/계약서
 *  철수: …/철수(일반)/퍼스트/철수사유/상호/품목 n대, …/계약서
 */
import { contractType, type ConfDoc } from './confirm';
import type { SwapDoc } from './swap';
import type { PullDoc } from './pull';
import { shortAddr, type MoveDoc } from './move';
import { saleQty, type SaleDoc } from './sale';
import { svcQty, type SvcDoc } from './svc';
import { furnSummary, type FurnDoc } from './furn';

/** 계약서 표기: 전자 / 수기 / 확인서서명필수 */
export const contractWord = (c: string) => (/전자/.test(c) ? '전자' : /수기/.test(c) ? '수기' : '확인서서명필수');
const state = (s: string) => (/중고|리퍼/.test(s ?? '') ? '리퍼' : s?.trim() ? s.trim() : '새기기');
const join = (consign: string, head: string, parts: (string | false | null | undefined)[]) => {
  const c = consign.trim();
  const h = head.trim();
  return `${c ? '★' : ''}${h ? `${h}-` : ''}${parts.filter((x) => x && String(x).trim()).join('/')}`;
};
const who = (consign: string, withOps = true) => (consign.trim() ? [consign.trim()] : withOps ? ['퍼스트', '운영팀'] : ['퍼스트']);

/** 납품 확인서 제목 */
export function titleConf(d: ConfDoc): string {
  const multi = d.items.length > 1 || d.items.some((i) => i.qty > 1);
  const items = d.items
    .filter((i) => i.model || i.cat)
    .map((i) => {
      const name = i.model?.trim() || i.cat;
      return `${name}(${state(i.state)})${multi ? ` ${i.qty || 1}대` : ''}`;
    });
  if (d.supplies.some((s) => s.name.trim())) items.push('소모품');
  return join(d.consign ?? '', d.head ?? '', [
    d.kind === 'it' && 'IT',
    `${(d.consign ?? '').trim() ? '위탁' : ''}납품(${d.term === '현장/단기' ? '현장' : '일반'})`, // 위탁이면 '위탁납품' (2026-11-26)
    ...who(d.consign ?? ''),
    // 유입경로는 앞 단어만 ('온라인/단순' → '온라인' · '개인영업(○○ 지인)' 은 그대로)
    (d.route ?? '').split('/')[0].trim(),
    d.company,
    items.join(', '),
    contractWord(contractType(d.contractMail)),
  ]);
}

/** 교체 확인서 제목 */
export function titleSwap(d: SwapDoc): string {
  const it = d.kind === 'it';
  const b = d.before;
  const a = d.after;
  // IT: '노트북->15ZB95N 노트북(리퍼)' · 복합기: 'D420->D470(새기기)' · 복합기 아닌 품목: '세단기->OK-2804M 세단기(새기기)'
  const from = it ? b.item || b.model : b.model || b.item;
  const item = a.item || b.item;
  const toName = [a.model, it || !/복합기|프린터/.test(item) ? item : ''].filter(Boolean).join(' ');
  const swap = from || toName ? `${from}->${toName}(${state(a.state)})` : '';
  return join(d.consign ?? '', d.head ?? '', [it && 'IT', '교체(일반)', ...who(d.consign ?? ''), d.reason, d.company, swap, d.contract ? contractWord(d.contract) : '']);
}

/** 철수 사유 짧게 (제목용) */
const PULL_SHORT: Record<string, string> = { 추심: '추심', 계약종료: '계약종료', '현장/단기 종료': '현장종료', 기타: '일부반출' };
/** 철수 품목 요약: '노트북 1대, 24모니터 1대' */
export function pullItems(d: PullDoc): string {
  const n = new Map<string, number>();
  for (const u of d.units) {
    const inch = /^(\d{2})/.exec(u.kindModel ?? '')?.[1];
    // 카톡 철수 양식과 같게: 모니터 = '24모니터' · 복합기·가전 = 모델명 · 그 외 = 품목
    const name = /모니터/.test(u.item) && inch ? `${inch}모니터` : /복합기|프린터|가전|전자/.test(u.item) && u.model ? u.model : u.item || u.model || '기기';
    n.set(name, (n.get(name) ?? 0) + 1);
  }
  return [...n].map(([k, c]) => `${k} ${c}대`).join(', ');
}
/** 철수 확인서 제목 */
export function titlePull(d: PullDoc): string {
  return join(d.consign ?? '', d.head ?? '', ['철수(일반)', ...who(d.consign ?? '', false), PULL_SHORT[d.type] ?? d.type, d.company, pullItems(d), contractWord(d.contract ?? '')]);
}

/**
 * 이전: [★][앞머리글-]이전(일반)/유상|무상/퍼스트/상호/모델[, …]/전 주소->후 주소/계약서
 *  예) 이전(일반)/유상/퍼스트/OO상사-OO현장/X4220RX/서울 송파구->서울 송파구/확인서서명필수 [IT 가림]
 */
export function titleMove(d: MoveDoc): string {
  const models = [...new Set(d.units.map((u) => u.model || u.item).filter(Boolean))].join(', ');
  const route = d.fromAddr || d.toAddr ? `${shortAddr(d.fromAddr)}->${shortAddr(d.toAddr)}` : '';
  return join(d.consign ?? '', d.head ?? '', ['이전(일반)', d.paid, ...who(d.consign ?? '', false), d.company, models, route, contractWord(d.contract)]);
}
/**
 * 판매: [★][앞머리글-]판매납품/퍼스트/운영팀/유입경로/상호/품목 n대[, …]/계약서
 *  예) ★OO상사 직송-판매납품/OO상사/증설/OO상사/레노버 노트북 1대/확인서서명필수 [IT 가림]
 */
export function titleSale(d: SaleDoc): string {
  const items = d.items.filter((i) => i.name.trim()).map((i) => `${i.name.trim()} ${saleQty(i.qty) || 1}대`);
  return join(d.consign ?? '', d.head ?? '', ['판매납품', ...who(d.consign ?? ''), (d.route ?? '').split('/')[0].trim(), d.company, items.join(', '), contractWord(d.contract)]);
}

/**
 * IT 유지보수 · 소프트웨어: [★][앞머리글-]IT/납품(일반)/퍼스트/운영팀/유입경로/상호/품목 n대(개)/계약서
 *  예) CS 자산번호 부착 진행-IT/납품(일반)/퍼스트/증설/OO상사/사무용 노트북 OR 데스크탑 (하드웨어) 유지보수 4대/수기 [IT 가림]
 *  유지보수는 위탁 없이 퍼스트 · 운영팀 없음 (물류 준비 없음 — 2026-11-24) · 소프트웨어는 예전대로
 */
export function titleSvc(d: SvcDoc): string {
  const unit = d.kind === '소프트웨어' ? '개' : '대';
  const items = d.items.filter((i) => i.name.trim()).map((i) => `${i.name.trim()} ${svcQty(i.qty) || 1}${unit}`);
  // IT 유지보수는 위탁 없이 퍼스트가 직접 · 물류 준비가 없어 '운영팀' 안 씀 (사용자 2026-11-24)
  const maint = d.kind !== '소프트웨어';
  const consign = maint ? '' : (d.consign ?? '');
  return join(consign, d.head ?? '', ['IT', `${consign.trim() ? '위탁' : ''}납품(${/현장/.test(d.term) ? '현장' : '일반'})`, ...who(consign, !maint), (d.route ?? '').split('/')[0].trim(), d.company, items.join(', '), contractWord(d.contract)]);
}

/**
 * 가구·가전 (현장): [★][앞머리글-]위탁납품(현장)/위탁사/유입경로/상호/가구|냉난방기 2대/계약서 (2026-11-25 예전 양식)
 *  예) ★위탁납품(현장)/OO상사/증설/OO상사-OO현장/가구/확인서서명필수 [IT 가림]
 *  위탁이 아니면: 납품(현장)/퍼스트/운영팀/…
 */
export function titleFurn(d: FurnDoc): string {
  const c = (d.consign ?? '').trim();
  return join(c, d.head ?? '', [`${c ? '위탁' : ''}납품(현장)`, ...who(c), (d.route ?? '').split('/')[0].trim(), d.company, furnSummary(d), contractWord(d.contract)]);
}
