/**
 * 영업 판 사이 "무엇이 바뀌었나" — IT가 마지막으로 확인한 판(③ seen_ver·seen_hash 의 ② 원문) ↔ 지금(① payload), 둘 다 지금 normalize 로 다시 읽은 것.
 * 설계 §4-2 3번(품목 추가·삭제·수량·모델·사양·날짜·주소·연락처). 순수 함수(import type + slots).
 * 품목은 칸 열쇠(slot_key — 품목구분#순서)로 맞춰 비교 → 칸 계산과 같은 기준.
 * 결과에는 연락처·주소 값이 들어감(D7 — 화면엔 그냥 보임). 서버 로그·오류 문구에는 넣지 말 것.
 */
import type { NormalizedSalesConfirm, SalesConfirmItem, SalesConfirmSupply, SalesSpecKey } from './types';
import { slotItems, slotKeysFor } from './slots';

export interface SalesChangeEntry {
  section: '기본' | '품목' | '연락처' | '소모품' | '교체';
  /** "납품일" · "데스크탑#1 RAM" · "모니터#1 (추가)" */
  label: string;
  /** 바뀌기 전(없었으면 '') */
  before: string;
  /** 지금(빠졌으면 '') */
  after: string;
}

// types.ts 의 SALES_SPEC_KEYS 와 같은 목록·순서(값 import 를 피하려고 여기 따로 — 바꾸면 같이)
const SPEC_ORDER: readonly SalesSpecKey[] = ['CPU', 'RAM', 'SSD', 'HDD', '그래픽', 'OS', '인치'];

const t = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

function itemText(it: SalesConfirmItem): string {
  const spec = SPEC_ORDER.map((k) => t(it.spec?.[k])).filter(Boolean).join('/');
  return [it.cat, [t(it.maker), t(it.model)].filter(Boolean).join(' '), `${Number(it.qty) || 0}대`, spec].filter(Boolean).join(' · ');
}

function supplyText(list: readonly SalesConfirmSupply[]): string {
  return list
    .map((s) => `${t(s.name)}${Number(s.qty) > 0 ? ` ${s.qty}` : ''}${t(s.charge) ? `(${t(s.charge)})` : ''}${t(s.note) ? ` ${t(s.note)}` : ''}`.trim())
    .filter(Boolean)
    .join(' · ');
}

/** 교체 전/후 한 쪽(객체 또는 배열) → 짧은 글자 */
function replaceSideText(v: unknown): string {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
  return list
    .map((x) => {
      if (!x || typeof x !== 'object') return '';
      const o = x as Record<string, unknown>;
      return [t(o.item), t(o.maker), t(o.model), t(o.asset), t(o.sn), typeof o.spec === 'string' ? t(o.spec) : ''].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(' / ');
}

export function salesConfirmChanges(prev: NormalizedSalesConfirm, cur: NormalizedSalesConfirm): SalesChangeEntry[] {
  const out: SalesChangeEntry[] = [];
  const cmp = (section: SalesChangeEntry['section'], label: string, a: unknown, b: unknown) => {
    const before = t(a);
    const after = t(b);
    if (before !== after) out.push({ section, label, before, after });
  };

  // 기본
  cmp('기본', '납품/교체일', prev.deliveryDate ?? '', cur.deliveryDate ?? '');
  cmp('기본', '구분', prev.type, cur.type);
  cmp('기본', '일반/현장', prev.term, cur.term);
  cmp('기본', '상호', prev.company, cur.company);
  cmp('기본', '지역', prev.region, cur.region);
  cmp('기본', '주소', prev.address, cur.address);
  cmp('기본', '영업담당', prev.salesRep, cur.salesRep);
  cmp('기본', '유입담당', prev.inflow, cur.inflow);
  cmp('기본', '임대 번호', prev.leaseNo, cur.leaseNo);
  cmp('기본', '사유', prev.reason, cur.reason);
  cmp('기본', '특이사항', prev.special, cur.special);
  if (prev.print && cur.print) {
    const P: [keyof NonNullable<NormalizedSalesConfirm['print']>, string][] = [
      ['months', '계약기간'],
      ['deposit', '보증금'],
      ['payNote', '결제특이'],
      ['extra', '추가조건'],
      ['orderDate', '발주일'],
      ['industry', '업종'],
      ['statusNo', '현황표 순'],
      ['fax', '팩스'],
      ['taxMail', '계산서 메일'],
      ['contractMail', '계약서 메일'],
    ];
    for (const [k, label] of P) cmp('기본', label, prev.print[k] ?? '', cur.print[k] ?? '');
  }

  // 연락처
  const pc = prev.contacts ?? ({} as NormalizedSalesConfirm['contacts']);
  const cc = cur.contacts ?? ({} as NormalizedSalesConfirm['contacts']);
  cmp('연락처', '대표번호', pc.phone, cc.phone);
  cmp('연락처', 'IT담당', pc.manager, cc.manager);
  cmp('연락처', '계약담당', pc.contractor, cc.contractor);
  cmp('연락처', '현장상주', pc.resident, cc.resident);
  cmp('연락처', '결제담당', pc.payer, cc.payer);

  // 품목 — 칸 열쇠로 맞춤
  const pItems = slotItems(prev);
  const cItems = slotItems(cur);
  const pKeys = slotKeysFor(pItems);
  const cKeys = slotKeysFor(cItems);
  const pMap = new Map(pKeys.map((k, i) => [k, pItems[i]] as const));
  const cMap = new Map(cKeys.map((k, i) => [k, cItems[i]] as const));
  for (const k of cKeys) {
    const a = pMap.get(k);
    const b = cMap.get(k)!;
    if (!a) {
      out.push({ section: '품목', label: `${k} (추가)`, before: '', after: itemText(b) });
      continue;
    }
    cmp('품목', `${k} 수량`, String(Number(a.qty) || 0), String(Number(b.qty) || 0));
    cmp('품목', `${k} 제조사`, a.maker, b.maker);
    cmp('품목', `${k} 모델명`, a.model, b.model);
    cmp('품목', `${k} 기기상태`, a.state, b.state);
    for (const s of SPEC_ORDER) cmp('품목', `${k} ${s}`, a.spec?.[s] ?? '', b.spec?.[s] ?? '');
    const extraKeys = [...new Set([...Object.keys(a.specExtra ?? {}), ...Object.keys(b.specExtra ?? {})])];
    for (const s of extraKeys) cmp('품목', `${k} ${s}`, a.specExtra?.[s] ?? '', b.specExtra?.[s] ?? '');
    cmp('품목', `${k} 설치장소·요청사항`, a.place, b.place);
  }
  for (const k of pKeys) {
    if (!cMap.has(k)) out.push({ section: '품목', label: `${k} (빠짐)`, before: itemText(pMap.get(k)!), after: '' });
  }

  // 소모품
  cmp('소모품', '소모품', supplyText(prev.supplies ?? []), supplyText(cur.supplies ?? []));

  // 교체 전/후
  cmp('교체', '회수할 기존 기기', replaceSideText(prev.replaceInfo?.before), replaceSideText(cur.replaceInfo?.before));
  cmp('교체', '교체 후 기기', replaceSideText(prev.replaceInfo?.after), replaceSideText(cur.replaceInfo?.after));

  return out;
}

/** 값은 안 보이고 "바뀜"만 적는 칸(연락처·주소 — 화면 목록이 짧게, 값은 위 상세 머리에 이미 보임) */
const VALUE_HIDDEN = new Set(['주소']);
const MAX_VALUE = 40;

const ymdShort = (a: string, b: string): [string, string] => {
  const re = /^(\d{4})-(\d{2}-\d{2})$/;
  const ma = re.exec(a);
  const mb = re.exec(b);
  // 둘 다 같은 해면 MM-DD 로
  if (ma && mb && ma[1] === mb[1]) return [ma[2], mb[2]];
  return [a, b];
};
const clip = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s);

/**
 * 화면 "무엇이 바뀌었나" 쉬운 말 목록 — "데스크탑 수량 3 → 4", "납품일 11-27 → 11-28", "연락처 IT담당 바뀜", "모니터 #2 추가: …".
 * 품목구분이 한 줄뿐이면 '#1' 을 뗌. 연락처·주소는 값 없이 "바뀜"만.
 */
export function salesChangeLines(prev: NormalizedSalesConfirm, cur: NormalizedSalesConfirm): string[] {
  const entries = salesConfirmChanges(prev, cur);
  // 품목구분마다 줄이 둘 이상이었는지(어느 판이든) — 하나뿐이면 '데스크탑#1' → '데스크탑'
  const multi = new Set<string>();
  for (const k of [...slotKeysFor(slotItems(prev)), ...slotKeysFor(slotItems(cur))]) {
    const m = /^(.*)#(\d+)$/.exec(k);
    if (m && m[2] !== '1') multi.add(m[1]);
  }
  const prettyLabel = (label: string) =>
    label.replace(/^(.*?)#(\d+)(?=\s|$)/, (_all, cat: string, n: string) => (multi.has(cat) ? `${cat} #${n}` : cat));

  return entries.map((e) => {
    const label = prettyLabel(e.label);
    if (e.section === '연락처') return `연락처 ${label} 바뀜`;
    if (VALUE_HIDDEN.has(e.label)) return `${label} 바뀜`;
    if (e.section === '품목' && / \(추가\)$/.test(e.label)) return `${label.replace(/ \(추가\)$/, '')} 추가: ${clip(e.after)}`;
    if (e.section === '품목' && / \(빠짐\)$/.test(e.label)) return `${label.replace(/ \(빠짐\)$/, '')} 빠짐: ${clip(e.before)}`;
    let [a, b] = [e.before, e.after];
    if (e.label === '납품/교체일') [a, b] = ymdShort(a, b);
    return `${label} ${clip(a) || '(없음)'} → ${clip(b) || '(없음)'}`;
  });
}
