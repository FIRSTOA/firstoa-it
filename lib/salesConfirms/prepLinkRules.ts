/**
 * 영업 확인서 ↔ 출고 준비 일정 — 짝 찾기·연결 상태 판정 한 곳 (4-1, 설계 docs/tasks/2026-11-27-sales-confirm-prep-merge.md §4-B·§4-C, F3·F4·F8).
 * 순수 함수 — import 는 prepMatch(상호 정규화)·regionSlot·salesForm/confTitle(영업 제목 사본) + types·itemKind·shipmentPrep 의 **타입만**(실행 때 지워짐).
 * 4-2(맨 아래 절): 확인서 기기 칸 → 완료 보고 기기(prepUnitsFromLines) · 보고에만 있는 기기 → 확인서 빈 칸 계획(planReportUnitMove).
 * Node 로 바로 돌려 봄. 서버 읽기·쓰기는 prepLink.ts(server-only) — 이 파일은 DB·네이버·시트를 모름.
 *
 * 예전 prepMatch.matchPrepEvents 의 틈(H9)을 고침:
 *   ⓐ 상호를 제목 구분 칸 +4 자리로 뽑던 것 → 제목 '/' 칸 **어디든** 상호가 같으면(유입경로 빈 제목·위탁·유지보수 제목도 맞음)
 *   ⓑ 유지보수·소프트웨어 확인서(영업 제목은 '납품(일반)')가 일정과 영영 안 맞던 것 → 일정 납품·유지보수와 맞음
 *   ⓒ 철수는 구분을 안 보던 것 → 철수·회수 일정만
 */
import { companyBase, normCompanyName } from './prepMatch';
import { regionFromEventTime } from './regionSlot';
import { titleConf, titleSvc, titleSwap } from './salesForm/confTitle';
import type {
  PrepConfirmBadge,
  PrepConfirmBadgeItem,
  PrepLinkCandidate,
  PrepLinkGrade,
  PrepLinkSource,
  PrepLinkState,
  PrepUnitRef,
  SalesConfirmStatus,
  SalesSlotLine,
  SalesSpec,
  SalesUnitRow,
} from './types';
import type { ItemKind } from './itemKind';
import type { PrepUnit } from '@/lib/shipmentPrep';

// ───────────────────────── 제목 열쇠(sure 비교) ─────────────────────────

/**
 * 일정 제목·영업 제목 → 비교 열쇠. NFKC → `IT/` 부터(없으면 구분 칸 `(위탁)납품(…)`·`교체(…)`·`철수(…)` 부터)
 * → 공백·★☆⭐ 뗌 → 소문자. 앞에 붙는 준비 태그("홍길동준비중 ")·앞머리글("전일연락필수-")·위탁 ★ 는 `IT/` 앞이라 저절로 빠짐.
 * 둘 다 못 찾으면 '' (= sure 비교 안 함).
 */
export function titleKey(title: string | null | undefined): string {
  const s = String(title ?? '')
    .normalize('NFKC')
    .replace(/\\([,;\\])/g, '$1'); // 혹시 ICS 이스케이프가 남아 있으면
  let start = -1;
  const it = /(^|[^A-Za-z])IT\s*\//i.exec(s);
  if (it) start = it.index + it[1].length;
  else {
    const k = /(?:위탁)?(?:납품|교체|철수)\([^)]*\)/.exec(s);
    if (k) start = k.index;
  }
  if (start < 0) return '';
  return s
    .slice(start)
    .replace(/[\s★☆⭐️]/g, '')
    .toLowerCase();
}

/**
 * 영업 확인서 제목(카톡 선행방에 올리는 한 줄 — 영업 사본 confTitle) — renderer 별 titleConf·titleSwap·titleSvc(formDoc).
 * 따로 보는 종류·옛 원문(renderer·doc 없음)이나 모양이 달라 못 만들면 ''.
 */
export function salesTitleOf(renderer: unknown, doc: unknown): string {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return '';
  try {
    if (renderer === 'confirm') return titleConf(doc as Parameters<typeof titleConf>[0]);
    if (renderer === 'swap') return titleSwap(doc as Parameters<typeof titleSwap>[0]);
    if (renderer === 'svc') return titleSvc(doc as Parameters<typeof titleSvc>[0]);
  } catch {
    // 영업 doc 모양이 달라(칸 빠짐 등) 제목을 못 만듦 → sure 없이 상호·날짜로만
  }
  return '';
}

// ───────────────────────── 상호(H9 ⓐ) ─────────────────────────

/** 상호로 볼 수 없는 제목 칸 */
const NOISE_SEG = /^(it|퍼스트|운영팀)$/i;

/**
 * 확인서 상호가 일정 제목에 있는지 — 제목을 '/' 로 나눈 칸 중 **어느 칸이든**(칸 위치를 가정하지 않음).
 * exact = 정규화한 상호가 칸과 통째로 같음 · false = '상호-현장'의 '-' 앞(2글자 이상)만 같음. 안 맞으면 null.
 * 상호 안에 '/' 가 있으면 그만큼 이어 붙인 칸과 비교.
 */
export function companyMatch(company: string | null | undefined, title: string | null | undefined): { exact: boolean } | null {
  const raw = String(company ?? '').normalize('NFKC').trim();
  const full = normCompanyName(raw);
  if (!full) return null;
  const short = companyBase(raw);
  const width = Math.max(1, raw.split('/').length);
  const segs = String(title ?? '')
    .normalize('NFKC')
    .split('/')
    .map((p) => p.trim());
  let loose = false;
  for (let i = 0; i + width <= segs.length; i++) {
    const seg = segs.slice(i, i + width).join('/');
    if (!seg || NOISE_SEG.test(seg)) continue;
    if (normCompanyName(seg) === full) return { exact: true };
    if (short.length >= 2 && companyBase(seg) === short) loose = true;
  }
  return loose ? { exact: false } : null;
}

// ───────────────────────── 구분(H9 ⓑⓒ) ─────────────────────────

export type PrepEventKind = '납품' | '교체' | '철수' | '이전' | '판매' | '유지보수';

/** 구분 칸: 칸 끝이 (위탁)납품(…)·교체(…)·철수(…)·회수·이전(…)·판매납품·유지보수 — 앞에 앞머리글('전일연락필수-')·태그가 붙어도 됨 */
const KIND_SEG = /(?:^|[^가-힣A-Za-z])(?:위탁)?(판매납품|납품|교체|철수|회수|이전|유지보수)(?:\([^)]*\))?$/;

/**
 * 일정 제목의 구분 — '/' 칸 중 구분 칸을 먼저(위탁납품 → 납품, 회수 → 철수, 판매납품 → 판매),
 * 없으면 제목 글자(철수·회수 → 철수, 교체 → 교체, 유지보수 → 유지보수, 그 밖 → 납품 — shipmentPrep eventKindOf 와 같은 기본값).
 */
export function eventKindOfTitle(title: string | null | undefined): PrepEventKind {
  const t = String(title ?? '').normalize('NFKC');
  for (const part of t.split('/').map((p) => p.trim())) {
    const m = KIND_SEG.exec(part);
    if (!m) continue;
    const k = m[1];
    if (k === '회수') return '철수';
    if (k === '판매납품') return '판매';
    return k as PrepEventKind;
  }
  if (t.includes('철수') || t.includes('회수')) return '철수';
  if (t.includes('교체')) return '교체';
  if (t.includes('유지보수')) return '유지보수';
  return '납품';
}

/**
 * 확인서 구분 ↔ 일정 구분이 맞는지:
 *   납품(빈 값 = 옛 원문) ↔ 납품(위탁납품 포함) · 교체 ↔ 교체 · 유지보수·소프트웨어 ↔ 납품·유지보수(영업 제목이 '납품(일반)')
 *   철수 ↔ 철수·회수 · 이전·판매·모르는 종류 ↔ 구분 안 봄
 */
export function kindMatches(confirmType: string | null | undefined, eventKind: PrepEventKind): boolean {
  const t = String(confirmType ?? '').trim();
  if (/이전|판매/.test(t)) return true;
  if (/교체/.test(t)) return eventKind === '교체';
  if (/유지보수|소프트웨어/.test(t)) return eventKind === '납품' || eventKind === '유지보수';
  if (/철수|회수/.test(t)) return eventKind === '철수';
  if (t === '' || /납품/.test(t)) return eventKind === '납품';
  return true;
}

// ───────────────────────── 날짜 ─────────────────────────

const ymdMs = (ymd: string | null | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? '').slice(0, 10));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};

/** 두 날짜 차(일, 절댓값). 하나라도 날짜가 아니면 null */
export function dayDiffOf(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = ymdMs(a);
  const y = ymdMs(b);
  if (x === null || y === null) return null;
  return Math.abs(Math.round((x - y) / 86_400_000));
}

/** 'YYYY-MM-DD' 에 days 더함(UTC 계산 — 시간대 영향 없음) */
export function shiftYmd(ymd: string, days: number): string {
  const ms = ymdMs(ymd);
  if (ms === null) return ymd;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** 후보로 보는 최대 날짜 차(weak) */
export const PREP_LINK_MAX_DAYS = 3;

// ───────────────────────── 한 쌍 등급 ─────────────────────────

/** 짝 판정에 쓰는 확인서 한 건(서버가 ①③ 가벼운 칸 + 제목으로 만듦 — payload·연락처 없음) */
export interface LinkRuleConfirm {
  id: string;
  docNo: string;
  company: string;
  /** 'YYYY-MM-DD' | null */
  deliveryDate: string | null;
  type: string;
  /** 영업 지역, 비면 주소 추정값(regionWithGuess) — 모르면 '' */
  region: string;
  /** salesTitleOf(renderer, doc) — 못 만들면 ''(sure 없음) */
  salesTitle: string;
  salesDeleted: boolean;
  /** ③ status(줄 없으면 '접수') */
  status: SalesConfirmStatus | string;
  directShip: boolean;
  /** 따로 보는 종류(판매·철수·이전 — isOtherSalesType) */
  other: boolean;
  /** ③ prep_event_id · link_source(원문 — 모르는 값은 '' 로 봄) · updated_at(DB 문자열 그대로) */
  savedEventId: string | null;
  savedSource: string;
  workUpdatedAt: string | null;
}

/** 짝 판정에 쓰는 일정 한 건 */
export interface LinkRuleEvent {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM' | '' */
  time: string;
  title: string;
  /** ★(네이버) 또는 ⭐(앱) — 출고 준비 리스트에 보임 */
  listed: boolean;
  /** 아래 셋은 상세에서만(없으면 false·'') */
  hasPrepRecord?: boolean;
  prepState?: string;
  reportSent?: boolean;
}

export interface PairGrade {
  grade: PrepLinkGrade;
  dayDiff: number;
  exactCompany: boolean;
  regionOfEvent: string | null;
}

interface ConfirmInfo {
  c: LinkRuleConfirm;
  key: string;
}
interface EventInfo {
  e: LinkRuleEvent;
  key: string;
  kind: PrepEventKind;
  region: string | null;
}

const confirmInfo = (c: LinkRuleConfirm): ConfirmInfo => ({ c, key: c.salesTitle ? titleKey(c.salesTitle) : '' });
const eventInfo = (e: LinkRuleEvent): EventInfo => ({
  e,
  key: titleKey(e.title),
  kind: eventKindOfTitle(e.title),
  region: regionFromEventTime(e.time || null),
});

function gradeWith(ci: ConfirmInfo, ei: EventInfo): PairGrade | null {
  const dayDiff = dayDiffOf(ci.c.deliveryDate, ei.e.date);
  if (dayDiff === null || dayDiff > PREP_LINK_MAX_DAYS) return null;
  const company = companyMatch(ci.c.company, ei.e.title);
  const exactCompany = !!company?.exact;
  // ① 확실: 영업 제목 IT/ 뒤 == 일정 제목 IT/ 뒤 + 날짜 같음(상호·구분·지역은 제목에 들어 있으니 따로 안 봄)
  if (dayDiff === 0 && ci.key && ci.key === ei.key) return { grade: 'sure', dayDiff, exactCompany, regionOfEvent: ei.region };
  if (!company) return null;
  if (!kindMatches(ci.c.type, ei.kind)) return null;
  // 지역: 둘 다 알 때 다르면 후보·약한 후보 모두 아님
  const region = String(ci.c.region ?? '').trim();
  if (region && ei.region && region !== ei.region) return null;
  return { grade: dayDiff <= 1 ? 'strong' : 'weak', dayDiff, exactCompany, regionOfEvent: ei.region };
}

/** 확인서 하나 ↔ 일정 하나의 등급(안 맞으면 null) — 시험·한 건 판정용. 여러 건은 resolvePrepLinks 가 한 번에 */
export function gradePair(c: LinkRuleConfirm, e: LinkRuleEvent): PairGrade | null {
  return gradeWith(confirmInfo(c), eventInfo(e));
}

// ───────────────────────── 정렬 ─────────────────────────

const GRADE_RANK: Record<PrepLinkGrade, number> = { sure: 0, strong: 1, weak: 2 };
const rank = (g: PrepLinkGrade | null | undefined) => (g ? GRADE_RANK[g] : 9);

/** 확인서 쪽 후보 정렬 — sure → strong → weak, 그 안에서 준비 기록 있음(복사본) → 상호 통째 → 날짜 가까움 → 시각 → id */
export function sortCandidates(list: readonly PrepLinkCandidate[]): PrepLinkCandidate[] {
  return [...list].sort(
    (a, b) =>
      rank(a.grade) - rank(b.grade) ||
      Number(b.hasPrepRecord) - Number(a.hasPrepRecord) ||
      Number(b.exactCompany) - Number(a.exactCompany) ||
      (a.dayDiff ?? 99) - (b.dayDiff ?? 99) ||
      String(a.time).localeCompare(String(b.time)) ||
      a.eventId.localeCompare(b.eventId),
  );
}

// ───────────────────────── 상태 판정(§4-C) ─────────────────────────

/** types.ts PREP_LINK_SOURCES 와 같게(이 파일은 types 를 실행 때 안 불러서 따로 적음) */
const SOURCES: readonly string[] = ['', 'auto', 'manual', 'none'];

/** ③ 저장값 → { 일정 id, 저장값(모르는 값은 '') } — 일정 id 가 있으면 링크는 'auto'·'manual'(쓰기 코드는 늘 둘 중 하나와 같이 씀) */
function savedOf(c: LinkRuleConfirm): { eventId: string | null; source: PrepLinkSource; linkAs: 'auto' | 'manual' | null } {
  const source = (SOURCES.includes(c.savedSource) ? c.savedSource : '') as PrepLinkSource;
  const eventId = c.savedEventId ? String(c.savedEventId) : null;
  return { eventId, source, linkAs: eventId ? (source === 'auto' ? 'auto' : 'manual') : null };
}

/** 지운 확인서·취소는 자동 연결 안 함(후보로만 — §4-B) */
const isExcluded = (c: LinkRuleConfirm) => c.salesDeleted || c.status === '취소';
const notTargetOf = (c: LinkRuleConfirm): 'direct' | 'other' | null => (c.directShip ? 'direct' : c.other ? 'other' : null);

export interface ResolvePrepLinksInput {
  /** 판정할 확인서들 + (일정 쪽이면) 그 날짜 ±3일 안 확인서 전부 + 창 밖이라도 창 안 일정에 저장 연결된 확인서 */
  confirms: readonly LinkRuleConfirm[];
  /** 짝을 찾는 일정(창 안 IT 출고 일정 — isItPrepTarget 을 거친 것) */
  events: readonly LinkRuleEvent[];
  /** 저장 연결된 일정 중 events 에 없는 것(창 밖·IT 표시가 빠짐 등) — 보여 주기만, 짝 계산 안 함 */
  extraEvents?: readonly LinkRuleEvent[];
  /** 확인서 쪽 후보 최대 개수(기본 8) */
  maxCandidates?: number;
  /** 일정 쪽 후보 최대 개수(기본 5) */
  maxEventCandidates?: number;
}

export interface ResolvePrepLinksResult {
  byConfirm: Map<string, PrepLinkState>;
  byEvent: Map<string, PrepConfirmBadge>;
}

/**
 * 확인서 쪽·일정 쪽 상태를 한 번에(같은 판정 — 두 화면이 어긋나지 않게).
 * 자동(④)은 전체를 보고 정함: 확인서의 sure 일정이 딱 하나 · 그 일정의 sure 확인서(지움·취소 뺌)도 딱 하나 ·
 * 그 일정에 저장 연결된 확인서 없음 · 이 확인서 link_source '' · 지움·취소·직송·따로 보기 아님.
 * 정확하려면 confirms·events 가 "판정할 것들의 ±3일 창" 전부를 담아야 함(prepLink.ts 가 그렇게 읽음).
 */
export function resolvePrepLinks(input: ResolvePrepLinksInput): ResolvePrepLinksResult {
  const maxC = input.maxCandidates ?? 8;
  const maxE = input.maxEventCandidates ?? 5;
  const cInfos = input.confirms.map(confirmInfo);
  const eInfos = input.events.map(eventInfo);
  const eventsById = new Map<string, LinkRuleEvent>();
  for (const e of input.extraEvents ?? []) eventsById.set(e.id, e);
  for (const e of input.events) eventsById.set(e.id, e);
  const confirmsById = new Map(input.confirms.map((c) => [c.id, c] as const));

  // 날짜별 일정(쌍 계산을 ±3일로만)
  const eventsByDate = new Map<string, EventInfo[]>();
  for (const ei of eInfos) {
    const list = eventsByDate.get(ei.e.date) ?? [];
    list.push(ei);
    eventsByDate.set(ei.e.date, list);
  }

  type Pair = { c: LinkRuleConfirm; e: LinkRuleEvent; pg: PairGrade };
  const pairsByConfirm = new Map<string, Pair[]>();
  const pairsByEvent = new Map<string, Pair[]>();
  for (const ci of cInfos) {
    const d = ci.c.deliveryDate;
    if (!d || ymdMs(d) === null) continue;
    for (let off = -PREP_LINK_MAX_DAYS; off <= PREP_LINK_MAX_DAYS; off++) {
      for (const ei of eventsByDate.get(shiftYmd(d, off)) ?? []) {
        const pg = gradeWith(ci, ei);
        if (!pg) continue;
        const p: Pair = { c: ci.c, e: ei.e, pg };
        (pairsByConfirm.get(ci.c.id) ?? pairsByConfirm.set(ci.c.id, []).get(ci.c.id)!).push(p);
        (pairsByEvent.get(ei.e.id) ?? pairsByEvent.set(ei.e.id, []).get(ei.e.id)!).push(p);
      }
    }
  }

  // 일정마다 저장 연결된 확인서(일정 1 → 확인서 여럿)
  const savedByEvent = new Map<string, { c: LinkRuleConfirm; linkAs: 'auto' | 'manual' }[]>();
  for (const c of input.confirms) {
    const s = savedOf(c);
    if (!s.eventId || !s.linkAs) continue;
    (savedByEvent.get(s.eventId) ?? savedByEvent.set(s.eventId, []).get(s.eventId)!).push({ c, linkAs: s.linkAs });
  }

  // 일정마다 sure 확인서(지움·취소 뺌 — 영업이 지우고 다시 만든 옛 건 때문에 자동이 막히지 않게)
  const activeSure = (eventId: string) => (pairsByEvent.get(eventId) ?? []).filter((p) => p.pg.grade === 'sure' && !isExcluded(p.c));

  // ④ 자동 + 막힌 이유
  const autoOf = new Map<string, LinkRuleEvent>();
  const blockedOf = new Map<string, PrepLinkState['autoBlocked']>();
  for (const c of input.confirms) {
    const sure = (pairsByConfirm.get(c.id) ?? []).filter((p) => p.pg.grade === 'sure');
    if (!sure.length) continue;
    const s = savedOf(c);
    if (s.eventId || s.source !== '' || notTargetOf(c)) continue;
    if (isExcluded(c)) {
      blockedOf.set(c.id, 'excluded');
      continue;
    }
    if (sure.length > 1) {
      blockedOf.set(c.id, 'copies');
      continue;
    }
    const e = sure[0].e;
    const others = activeSure(e.id);
    if (others.length !== 1 || others[0].c.id !== c.id) {
      blockedOf.set(c.id, 'shared');
      continue;
    }
    // (팀장 2026-11-27) 예전 "그 일정에 다른 확인서가 저장 연결돼 있으면 자동 아님(taken)"은 뺌 — 일정 하나에 확인서 여럿 허용(F2:
    // 같은 출장의 납품 + 소프트웨어). 사람이 소프트웨어 확인서를 그 일정에 [연결]해도 자동이던 납품 확인서가 후보로 내려가지 않게.
    // 'taken' 값은 타입에 남겨 두지만 지금은 안 씀.
    autoOf.set(c.id, e);
  }

  const candidateOf = (c: LinkRuleConfirm, e: LinkRuleEvent, pg: PairGrade | null): PrepLinkCandidate => ({
    eventId: e.id,
    date: e.date,
    time: e.time ?? '',
    title: e.title ?? '',
    regionOfEvent: pg ? pg.regionOfEvent : regionFromEventTime(e.time || null),
    notPrepTarget: !e.listed,
    grade: pg?.grade ?? null,
    dayDiff: pg ? pg.dayDiff : dayDiffOf(c.deliveryDate, e.date),
    exactCompany: !!pg?.exactCompany,
    hasPrepRecord: !!e.hasPrepRecord,
    prepState: e.prepState ?? '',
    reportSent: !!e.reportSent,
    linkedConfirms: (savedByEvent.get(e.id) ?? [])
      .filter((x) => x.c.id !== c.id)
      .map((x) => ({ confirmId: x.c.id, docNo: x.c.docNo }))
      .sort((a, b) => a.docNo.localeCompare(b.docNo)),
  });

  // ── 확인서 쪽 ──
  const byConfirm = new Map<string, PrepLinkState>();
  for (const c of input.confirms) {
    const s = savedOf(c);
    const reason = notTargetOf(c);
    // 직송·따로 보기는 후보 계산 생략(F29 — 저장된 연결만 보임)
    const pairs = reason ? [] : (pairsByConfirm.get(c.id) ?? []);
    const all = sortCandidates(pairs.map((p) => candidateOf(c, p.e, p.pg)));
    const without = (eventId: string) => all.filter((x) => x.eventId !== eventId).slice(0, maxC);
    const sureCount = all.filter((x) => x.grade === 'sure').length;
    const base: Omit<PrepLinkState, 'kind' | 'event' | 'candidates'> = {
      savedSource: s.source,
      savedEventId: s.eventId,
      sureCount,
      autoBlocked: null,
      notTargetReason: null,
      alertNoEvent: false,
      workUpdatedAt: c.workUpdatedAt ?? null,
    };
    let st: PrepLinkState;
    if (s.eventId) {
      const ev = eventsById.get(s.eventId);
      if (ev) {
        const pg = (pairsByConfirm.get(c.id) ?? []).find((p) => p.e.id === ev.id)?.pg ?? null;
        st = { ...base, kind: 'linked', event: candidateOf(c, ev, pg), candidates: without(ev.id) };
      } else {
        // 저장된 id 인데 일정 줄이 없음(읽는 사이 지워짐) — 풀림과 같게
        st = { ...base, kind: 'broken', event: null, candidates: all.slice(0, maxC) };
      }
    } else if (s.source === 'none') {
      st = { ...base, kind: 'off', event: null, candidates: all.slice(0, maxC) };
    } else if (s.source === 'auto' || s.source === 'manual') {
      st = { ...base, kind: 'broken', event: null, candidates: all.slice(0, maxC) };
    } else if (reason) {
      st = { ...base, kind: 'notTarget', notTargetReason: reason, event: null, candidates: [] };
    } else if (autoOf.has(c.id)) {
      const ev = autoOf.get(c.id)!;
      const pg = (pairsByConfirm.get(c.id) ?? []).find((p) => p.e.id === ev.id)?.pg ?? null;
      st = { ...base, kind: 'auto', event: candidateOf(c, ev, pg), candidates: without(ev.id) };
    } else if (all.length) {
      st = { ...base, kind: 'candidates', autoBlocked: blockedOf.get(c.id) ?? null, event: null, candidates: all.slice(0, maxC) };
    } else if (c.deliveryDate && ymdMs(c.deliveryDate) !== null) {
      st = { ...base, kind: 'noEvent', alertNoEvent: !isExcluded(c), event: null, candidates: [] };
    } else {
      st = { ...base, kind: 'unknown', event: null, candidates: [] };
    }
    byConfirm.set(c.id, st);
  }

  // ── 일정 쪽 ──
  const itemOf = (c: LinkRuleConfirm, e: LinkRuleEvent, link: PrepConfirmBadgeItem['link']): PrepConfirmBadgeItem => {
    const pg = (pairsByEvent.get(e.id) ?? []).find((p) => p.c.id === c.id)?.pg ?? null;
    const s = savedOf(c);
    return {
      confirmId: c.id,
      docNo: c.docNo,
      company: c.company,
      type: c.type,
      deliveryDate: c.deliveryDate,
      status: (c.status || '접수') as SalesConfirmStatus,
      link,
      grade: pg?.grade ?? null,
      dayDiff: pg ? pg.dayDiff : dayDiffOf(c.deliveryDate, e.date),
      exactCompany: !!pg?.exactCompany,
      region: c.region ?? '',
      directShip: c.directShip,
      salesDeleted: c.salesDeleted,
      other: c.other,
      linkedElsewhere: link === null && s.eventId && s.eventId !== e.id ? s.eventId : null,
      workUpdatedAt: c.workUpdatedAt ?? null,
    };
  };
  const byDoc = (a: PrepConfirmBadgeItem, b: PrepConfirmBadgeItem) => a.docNo.localeCompare(b.docNo) || a.confirmId.localeCompare(b.confirmId);

  const byEvent = new Map<string, PrepConfirmBadge>();
  for (const e of input.events) {
    const linked: PrepConfirmBadgeItem[] = [];
    const seen = new Set<string>();
    for (const x of savedByEvent.get(e.id) ?? []) {
      linked.push(itemOf(x.c, e, x.linkAs));
      seen.add(x.c.id);
    }
    for (const [cid, ev] of autoOf) {
      if (ev.id !== e.id || seen.has(cid)) continue;
      const c = confirmsById.get(cid);
      if (!c) continue;
      linked.push(itemOf(c, e, 'computed'));
      seen.add(cid);
    }
    linked.sort((a, b) => Number(a.link === 'computed') - Number(b.link === 'computed') || byDoc(a, b));
    const candidates = (pairsByEvent.get(e.id) ?? [])
      .filter((p) => !seen.has(p.c.id))
      .map((p) => itemOf(p.c, e, null))
      .sort(
        (a, b) =>
          rank(a.grade) - rank(b.grade) ||
          Number(b.exactCompany) - Number(a.exactCompany) ||
          (a.dayDiff ?? 99) - (b.dayDiff ?? 99) ||
          byDoc(a, b),
      )
      .slice(0, maxE);
    byEvent.set(e.id, { eventId: e.id, kind: linked.length ? 'linked' : candidates.length ? 'candidates' : 'none', linked, candidates });
  }

  return { byConfirm, byEvent };
}

// ───────────────────────── 4-2 확인서 기기 → 완료 보고 기기(§4-D · F10~F13) ─────────────────────────
// 서버(prepLink.linkedReportSource)가 ①④ 와 IT재고 색인을 한 번씩 읽어 넘기고, 여기는 계산만(DB·시트 모름).

const clean = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';

/** 보고로 가는 칸 종류 — 장비·모니터·기타. 유지보수(고객 PC)·소프트웨어는 IT재고 '임대중' 대상이 아니라 안 감(F10) */
const REPORT_KINDS: readonly ItemKind[] = ['device', 'monitor', 'other'];
export function isReportSlotKind(kind: ItemKind): boolean {
  return REPORT_KINDS.includes(kind);
}

const hasIdOrSerial = (u: { assetId?: string | null; serial?: string | null } | null | undefined): boolean =>
  !!(clean(u?.assetId) || clean(u?.serial));

/** 보고 기기 열쇠 — 자산번호(대문자)가 있으면 'A:자산번호', 없으면 'S:시리얼(대문자)', 둘 다 없으면 '' */
export function reportUnitKey(u: { assetId?: string | null; serial?: string | null } | null | undefined): string {
  const a = clean(u?.assetId).toUpperCase();
  if (a) return `A:${a}`;
  const s = clean(u?.serial).toUpperCase();
  return s ? `S:${s}` : '';
}

/** CPU 짧게: i5-12400 → i5, Ryzen 5 → R5 — listQuery.shortCpu 와 같은 규칙(그쪽은 server-only 라 import 못 함 — 바꾸면 같이) */
function shortCpuOf(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const i = /\bi([3579])\b|\bi([3579])[-\s]?\d{3,5}/i.exec(s);
  if (i) return `i${i[1] ?? i[2]}`;
  const r = /ryzen\s*([3579])/i.exec(s);
  if (r) return `R${r[1]}`;
  const w = /(celeron|pentium|xeon|core\s*ultra)/i.exec(s);
  if (w) return w[1].replace(/\s+/g, '');
  return s.replace(/\s+/g, '').slice(0, 10);
}

/**
 * 출고 사양 한 줄 — 목록 사양 요약(listQuery specLine)과 같은 꼴: 장비 "i5/16GB/512GB", CPU·RAM·저장장치가 없으면 인치(모니터). 바꾸면 같이.
 */
export function reportSpecLine(cat: string, spec: SalesSpec | null | undefined): string {
  const s = spec ?? {};
  const g = (k: keyof SalesSpec) => clean(s[k]).replace(/\s+/g, '');
  const inch = g('인치');
  if (!g('CPU') && !g('RAM') && !g('SSD') && !g('HDD')) return inch ? (/\D/.test(inch) ? inch : `${inch}인치`) : '';
  const parts = [shortCpuOf(clean(s.CPU)), g('RAM'), g('SSD') || g('HDD')].filter(Boolean);
  if (inch && /모니터/.test(cat)) parts.push(/\D/.test(inch) ? inch : `${inch}인치`);
  return parts.join('/');
}

/** IT재고 한 줄(prepLink.readAssetBriefs 가 자산번호마다 고른 것) */
export interface ReportUnitBrief {
  category: string;
  gubun: string;
  specLabel: string;
}

export interface PrepUnitsConfirmInput {
  confirmId: string;
  docNo: string;
  /** buildSlotLines(slotItems(확인서), ④) 의 lines — 교체 건은 칸이 곧 교체 후 기기(slots.ts: 교체 전 기기 칸은 없음) */
  lines: readonly SalesSlotLine[];
  /** buildSlotLines 의 orphans(영업에서 빠진 칸) — 보고에 안 넣고 개수만 셈 */
  orphans?: readonly SalesUnitRow[];
}

export interface PrepUnitsFromLinesInput {
  confirms: readonly PrepUnitsConfirmInput[];
  /** 자산번호(대문자) → IT재고 한 줄. 없으면 IT재고에 없음(또는 못 읽음) */
  briefs?: Readonly<Record<string, ReportUnitBrief>>;
  /** 지금 보고(DB)의 기기 — 외관 등급 유지, IT재고에 없을 때 구분·사양 */
  prevUnits?: readonly PrepUnit[] | null;
}

export interface PrepUnitsFromLinesResult {
  units: PrepUnit[];
  /** 장비·모니터·기타 칸 수(채웠든 안 채웠든) — 1 이상이면 확인서 모드 */
  deviceSlots: number;
  /** 확인서마다 장비·모니터·기타 칸 수 · 보고로 간 기기 수 */
  perConfirm: Record<string, { deviceSlots: number; unitCount: number }>;
  skipped: { svc: number; orphan: number; empty: number; dupe: number };
}

/**
 * 확인서 기기 칸 → 완료 보고 기기(F10·F11). 확인서는 문서번호 순, 그 안은 품목 줄·칸 순.
 *   넣는 칸: 장비·모니터·기타 중 자산번호나 시리얼이 있는 칸. 유지보수·소프트웨어·영업에서 빠진 칸·빈 칸은 개수만(skipped).
 *   같은 자산번호(없으면 시리얼)는 한 번만 — 확인서 둘 사이에서도.
 *   assetId 대문자·앞뒤 공백 뗌, serial 앞뒤 공백 뗌(대소문자 그대로 — 저장 규칙과 같음).
 *   model = [출고 제조사 || 영업 제조사, 출고 모델 || 영업 모델] · gubun = IT재고 || 지금 보고 ·
 *   spec = IT가 고친 출고사양(spec_override)이 있으면 영업 사양에 덮은 요약, 없으면 IT재고 사양 || 지금 보고 ·
 *   category = IT재고 품목 || 영업 품목구분 · grade = 지금 보고의 같은 기기(자산번호, 자산번호 없는 기기는 시리얼로 찾음).
 */
export function prepUnitsFromLines(input: PrepUnitsFromLinesInput): PrepUnitsFromLinesResult {
  const prevByKey = new Map<string, PrepUnit>();
  const prevBySerial = new Map<string, PrepUnit>(); // 자산번호 없이 적힌 보고 기기만(다른 자산번호 기기의 값을 가져오지 않게)
  for (const p of input.prevUnits ?? []) {
    const k = reportUnitKey(p);
    if (k && !prevByKey.has(k)) prevByKey.set(k, p);
    const s = clean(p?.serial).toUpperCase();
    if (s && !clean(p?.assetId) && !prevBySerial.has(s)) prevBySerial.set(s, p);
  }
  const briefs = input.briefs ?? {};
  const confirms = [...input.confirms].sort(
    (a, b) => String(a.docNo ?? '').localeCompare(String(b.docNo ?? '')) || String(a.confirmId).localeCompare(String(b.confirmId)),
  );
  const units: PrepUnit[] = [];
  const seen = new Set<string>();
  const skipped = { svc: 0, orphan: 0, empty: 0, dupe: 0 };
  const perConfirm: Record<string, { deviceSlots: number; unitCount: number }> = {};
  let deviceSlots = 0;

  for (const c of confirms) {
    const pc = { deviceSlots: 0, unitCount: 0 };
    for (const line of c.lines) {
      if (!isReportSlotKind(line.kind)) {
        skipped.svc += line.slots.filter((s) => hasIdOrSerial(s.unit)).length;
        continue;
      }
      for (const slot of line.slots) {
        pc.deviceSlots++;
        const u = slot.unit;
        const assetId = clean(u?.assetId).toUpperCase();
        const serial = clean(u?.serial);
        if (!u || (!assetId && !serial)) {
          skipped.empty++;
          continue;
        }
        const key = reportUnitKey({ assetId, serial });
        if (seen.has(key)) {
          skipped.dupe++;
          continue;
        }
        seen.add(key);
        const prev = prevByKey.get(key) ?? (!assetId && serial ? prevBySerial.get(serial.toUpperCase()) : undefined);
        const brief = assetId ? briefs[assetId] : undefined;
        const item = line.item;
        const override = u.specOverride ?? {};
        const overridden = Object.values(override).some((v) => clean(v) !== '');
        const shipped = overridden ? reportSpecLine(item.cat, { ...(item.spec ?? {}), ...override }) : '';
        units.push({
          serial,
          assetId,
          grade: clean(prev?.grade),
          model: [clean(u.actualMaker) || clean(item.maker), clean(u.actualModel) || clean(item.model)].filter(Boolean).join(' '),
          gubun: clean(brief?.gubun) || clean(prev?.gubun),
          spec: shipped || clean(brief?.specLabel) || clean(prev?.spec),
          category: clean(brief?.category) || clean(item.cat) || '기타',
        });
        pc.unitCount++;
      }
    }
    for (const o of c.orphans ?? []) if (hasIdOrSerial(o)) skipped.orphan++;
    perConfirm[c.confirmId] = pc;
    deviceSlots += pc.deviceSlots;
  }
  return { units, deviceSlots, perConfirm, skipped };
}

/**
 * prev 중 next 에 없는 기기(자산번호가 같거나 시리얼이 같으면 "있음") — 저장 때 "빠지는 기기" 확인(dropUnits)·"보고에만 있는 기기"(F12).
 * 자산번호 대문자, 같은 기기는 한 번.
 */
export function droppedReportUnits(
  prev: readonly PrepUnit[] | null | undefined,
  next: readonly PrepUnit[] | null | undefined,
): PrepUnitRef[] {
  const assets = new Set<string>();
  const serials = new Set<string>();
  for (const u of next ?? []) {
    const a = clean(u?.assetId).toUpperCase();
    if (a) assets.add(a);
    const s = clean(u?.serial).toUpperCase();
    if (s) serials.add(s);
  }
  const out: PrepUnitRef[] = [];
  const seen = new Set<string>();
  for (const u of prev ?? []) {
    const assetId = clean(u?.assetId).toUpperCase();
    const serial = clean(u?.serial);
    if (!assetId && !serial) continue;
    if ((assetId && assets.has(assetId)) || (serial && serials.has(serial.toUpperCase()))) continue;
    const k = reportUnitKey({ assetId, serial });
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ assetId, serial });
  }
  return out;
}

/** 두 기기 목록의 (자산번호, 시리얼) 묶음이 같은지(순서 무관, 대소문자 무시) — "보고 뒤 바뀜"(F13) */
export function sameReportUnitSet(a: readonly PrepUnit[] | null | undefined, b: readonly PrepUnit[] | null | undefined): boolean {
  const sig = (list: readonly PrepUnit[] | null | undefined) =>
    (list ?? [])
      .filter((u) => hasIdOrSerial(u))
      .map((u) => `${clean(u.assetId).toUpperCase()}|${clean(u.serial).toUpperCase()}`)
      .sort()
      .join('\n');
  return sig(a) === sig(b);
}

// ── 보고에만 있는 기기 → 확인서 빈 칸(F12) ──

export type ReportMoveKind = 'device' | 'monitor' | 'other';

/** IT재고 품목 → 옮길 칸 종류: 노트북·데스크탑 → 장비, 모니터 → 모니터, 나머지 → 기타. 품목을 모르면 null(안 옮김) */
export function moveKindOfCategory(category: string | null | undefined): ReportMoveKind | null {
  const c = clean(category);
  if (!c) return null;
  if (/노트북|데스크/.test(c)) return 'device';
  if (/모니터/.test(c)) return 'monitor';
  return 'other';
}

export interface ReportUnitMove extends PrepUnitRef {
  /** 그 칸의 품목 줄(lines[].itemIndex — ④ 를 새로 만들 때 item_snapshot) */
  itemIndex: number;
  slotKey: string;
  unitNo: number;
  /** ④ 줄이 있으면 그 id(조건부 update), 없으면 null(새로 만듦) */
  unitId: string | null;
  kind: ReportMoveKind;
}

export interface ReportUnitMovePlan {
  moves: ReportUnitMove[];
  /** noCategory IT재고에서 품목을 못 찾음(시리얼만 적힌 기기 포함) · noSlot 같은 종류 빈 칸이 모자람 */
  left: (PrepUnitRef & { reason: 'noCategory' | 'noSlot' })[];
  /** 이미 확인서에 있는 보고 기기 수(자산번호나 시리얼이 같음 — 안 옮김) */
  present: number;
}

/**
 * 보고 기기 중 확인서(칸 + 영업에서 빠진 칸)에 없는 것을 같은 종류 빈 칸(자산번호·시리얼 둘 다 빔)에 차례로 —
 * 같은 품목 이름 줄 먼저(노트북은 노트북 줄 → 그 밖 장비 줄). 자산번호·시리얼만 옮기는 계획(쓰기는 부르는 쪽 — 칸마다 조건부).
 */
export function planReportUnitMove(input: {
  lines: readonly SalesSlotLine[];
  orphans?: readonly SalesUnitRow[];
  reportUnits: readonly PrepUnit[] | null | undefined;
  /** 자산번호(대문자) → IT재고 품목 */
  categories: Readonly<Record<string, string>>;
}): ReportUnitMovePlan {
  const assets = new Set<string>();
  const serials = new Set<string>();
  const mark = (assetId: string, serial: string) => {
    if (assetId) assets.add(assetId.toUpperCase());
    if (serial) serials.add(serial.toUpperCase());
  };
  for (const line of input.lines) for (const s of line.slots) if (s.unit) mark(clean(s.unit.assetId), clean(s.unit.serial));
  for (const o of input.orphans ?? []) mark(clean(o.assetId), clean(o.serial));

  type Free = { itemIndex: number; slotKey: string; unitNo: number; unitId: string | null; cat: string };
  const free: Record<ReportMoveKind, Free[]> = { device: [], monitor: [], other: [] };
  for (const line of input.lines) {
    if (!isReportSlotKind(line.kind)) continue;
    const kind = line.kind as ReportMoveKind;
    for (const s of line.slots) {
      if (hasIdOrSerial(s.unit)) continue;
      free[kind].push({ itemIndex: line.itemIndex, slotKey: s.slotKey, unitNo: s.unitNo, unitId: s.unit?.id || null, cat: clean(line.item.cat) });
    }
  }

  const used = new Set<string>();
  const seenKeys = new Set<string>();
  const moves: ReportUnitMove[] = [];
  const left: ReportUnitMovePlan['left'] = [];
  let present = 0;
  for (const u of input.reportUnits ?? []) {
    const assetId = clean(u?.assetId).toUpperCase();
    const serial = clean(u?.serial);
    if (!assetId && !serial) continue;
    if ((assetId && assets.has(assetId)) || (serial && serials.has(serial.toUpperCase()))) {
      present++;
      continue;
    }
    const key = reportUnitKey({ assetId, serial });
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const category = (assetId && clean(input.categories[assetId])) || clean(u?.category);
    const kind = moveKindOfCategory(category);
    if (!kind) {
      left.push({ assetId, serial, reason: 'noCategory' });
      continue;
    }
    const pool = free[kind].filter((f) => !used.has(`${f.slotKey}\u0000${f.unitNo}`));
    const word = /노트북/.test(category) ? '노트북' : /데스크/.test(category) ? '데스크' : category;
    const pick = pool.find((f) => !!word && f.cat.includes(word)) ?? pool[0];
    if (!pick) {
      left.push({ assetId, serial, reason: 'noSlot' });
      continue;
    }
    used.add(`${pick.slotKey}\u0000${pick.unitNo}`);
    moves.push({ assetId, serial, itemIndex: pick.itemIndex, slotKey: pick.slotKey, unitNo: pick.unitNo, unitId: pick.unitId, kind });
    mark(assetId, serial); // 보고에 같은 기기가 두 번 있어도 한 칸만
  }
  return { moves, left, present };
}
