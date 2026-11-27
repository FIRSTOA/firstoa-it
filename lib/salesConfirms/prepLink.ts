import 'server-only';

/**
 * 영업 확인서 ↔ 출고 준비 일정 연결 — 읽기(확인서 하나·목록 줄·출고 준비 일정 배지)와 연결 쓰기 한 곳 (4-1, 설계 §4-A·§4-C, F2·F4·F8).
 *   판정은 전부 prepLinkRules.resolvePrepLinks(순수) — 여기는 DB 에서 "판정할 것들의 ±3일 창"을 모아 넘기기만.
 *   쓰는 것은 ③ it_sales_confirm_work 의 prep_event_id · link_source · updated_by 뿐(③ 줄이 없으면 그 칸들로만 만듦 —
 *   first_opened_at·seen_ver 는 안 채움 → "새로" 유지). **화면 열기만으로는 아무것도 안 씀**(F4) — 읽기 함수는 쓰기 0.
 *   네이버·카톡·시트·it_prep_* 표·캘린더 표는 읽기만. ① payload 는 서버 안에서 제목을 만들 때만(상호가 맞는 건만) 읽고 응답에 안 실음.
 *   동시 수정: 화면이 본 ③ updated_at(DB 문자열 그대로)과 같을 때만 .eq — 0줄이면 conflict.
 *   로그는 code 만(Supabase details 에 행 값이 들어감).
 * 가져오기 코드(importer·normalize·source·라우트)는 이 파일을 import 하지 말 것.
 */
import { CALENDAR_TABLE, SALES_CONFIRMS_TABLE, SALES_CONFIRM_WORK_TABLE, createAdminClient } from '@/lib/supabase/server';
import { isItPrepTarget, isPrepDone, isPrepInProgress, isPrepOverhaul, type PrepChecks } from '@/lib/shipmentPrep';
import { isMissingSalesTable, readDeliveryModes } from './listQuery';
import { regionWithGuess } from './prepMatch';
import {
  PREP_LINK_MAX_DAYS,
  companyMatch,
  resolvePrepLinks,
  salesTitleOf,
  shiftYmd,
  sortCandidates,
  type LinkRuleConfirm,
  type LinkRuleEvent,
} from './prepLinkRules';
import {
  SALES_STATE_DELETED,
  isOtherSalesType,
  isPrepLinkSource,
  isSalesConfirmStatus,
  type PrepConfirmBadge,
  type PrepLinkCandidate,
  type PrepLinkSaveResult,
  type PrepLinkSource,
  type PrepLinkState,
} from './types';

type Supa = ReturnType<typeof createAdminClient>;

const PREP_EVENTS_TABLE = 'it_prep_events'; // 출고 준비 상태(읽기만)
const PREP_REPORTS_TABLE = 'it_prep_reports'; // 완료 보고(읽기만)
const CHUNK = 200;
/** 목록 줄 한 번에 최대 */
export const MAX_CONFIRM_BADGES = 500;
/** 출고 준비 일정 한 번에 최대 */
export const MAX_EVENT_BADGES = 300;
/** 날짜 창을 합칠 때 이 날수 안의 틈은 한 창으로(읽기 횟수 줄이기) */
const MERGE_GAP_DAYS = 14;

const CONFIRM_LIGHT_COLS = 'id,doc_no,company,delivery_date,type,region,address,sales_state';
const WORK_LINK_COLS = 'confirm_id,status,prep_event_id,link_source,updated_at';
const CAL_COLS = 'id,date,time,title,important,naver_important';

export const MSG_LINK_CONFLICT = '다른 사람이 방금 이 확인서를 고쳤어요 — 새로 불러올게요.';
export const MSG_LINK_EVENT_GONE = '그 출고 일정이 방금 지워졌어요 — 새로고침해 주세요.';
export const MSG_LINK_CONFIRM_GONE = '확인서를 못 찾았어요 — 목록을 새로고침해 주세요.';
export const MSG_LINK_FAIL = '연결을 저장하지 못했어요 — 잠시 뒤 다시 해 주세요.';
export const MSG_LINK_NO_TABLE = '영업 확인서 표가 아직 없어요 — SQL 실행이 필요해요.';

// ───────────────────────── 작은 도우미 ─────────────────────────

interface ConfirmLight {
  id: string;
  doc_no: string | null;
  company: string | null;
  delivery_date: string | null;
  type: string | null;
  region: string | null;
  address: string | null;
  sales_state: string | null;
}
interface WorkLink {
  confirm_id: string;
  status: string | null;
  prep_event_id: string | null;
  link_source: string | null;
  updated_at: string;
}
interface CalRow {
  id: string;
  date: string;
  time: string | null;
  title: string | null;
  important: boolean | null;
  naver_important: boolean | null;
}

function logFail(where: string, err: unknown) {
  console.warn(`[sales-confirms] ${where} 실패`, (err as { code?: string } | null)?.code ?? 'unknown');
}

function chunks<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 페이지로 끝까지(1000줄 잘림 방지) */
async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const cleanActor = (a: unknown) => String(a ?? '').trim().slice(0, 40);
const cleanId = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 날짜들 → 각 ±3일 창을 합친 범위들(틈이 MERGE_GAP_DAYS 안이면 한 창) */
function windowsOf(dates: readonly string[]): { from: string; to: string }[] {
  const sorted = [...new Set(dates.filter(isYmd))].sort();
  const out: { from: string; to: string }[] = [];
  for (const d of sorted) {
    const from = shiftYmd(d, -PREP_LINK_MAX_DAYS);
    const to = shiftYmd(d, PREP_LINK_MAX_DAYS);
    const last = out[out.length - 1];
    if (last && from <= shiftYmd(last.to, MERGE_GAP_DAYS)) {
      if (to > last.to) last.to = to;
    } else out.push({ from, to });
  }
  return out;
}

/** 출고 준비 상태 한 줄 — "홍길동 준비완료 · 김철수 준비중" / "준비 전" */
export function prepStateText(checks: PrepChecks | null | undefined): string {
  const parts: string[] = [];
  for (const [person, e] of Object.entries(checks ?? {})) {
    if (isPrepDone(e)) parts.push(`${person} 준비완료`);
    else if (isPrepInProgress(e)) parts.push(`${person} 준비중`);
    else if (isPrepOverhaul(e)) parts.push(`${person} 오버홀`);
  }
  return parts.join(' · ') || '준비 전';
}

// ───────────────────────── 읽기 조각 ─────────────────────────

async function readConfirmsByIds(supabase: Supa, ids: readonly string[]): Promise<ConfirmLight[]> {
  const out: ConfirmLight[] = [];
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase.from(SALES_CONFIRMS_TABLE).select(CONFIRM_LIGHT_COLS).in('id', part);
    if (error) throw error;
    out.push(...((data ?? []) as ConfirmLight[]));
  }
  return out;
}

async function readConfirmsInRange(supabase: Supa, from: string, to: string): Promise<ConfirmLight[]> {
  return readAllPages<ConfirmLight>((a, b) =>
    supabase
      .from(SALES_CONFIRMS_TABLE)
      .select(CONFIRM_LIGHT_COLS)
      .gte('delivery_date', from)
      .lte('delivery_date', to)
      .order('delivery_date')
      .order('id')
      .range(a, b) as unknown as PromiseLike<{ data: ConfirmLight[] | null; error: unknown }>,
  );
}

async function readWorkByConfirm(supabase: Supa, ids: readonly string[]): Promise<WorkLink[]> {
  const out: WorkLink[] = [];
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase.from(SALES_CONFIRM_WORK_TABLE).select(WORK_LINK_COLS).in('confirm_id', part);
    if (error) throw error;
    out.push(...((data ?? []) as WorkLink[]));
  }
  return out;
}

/** 이 일정들에 저장 연결된 ③ 줄(일정 1 → 확인서 여럿) */
async function readWorkByEvent(supabase: Supa, eventIds: readonly string[]): Promise<WorkLink[]> {
  const out: WorkLink[] = [];
  for (const part of chunks(eventIds, CHUNK)) {
    const rows = await readAllPages<WorkLink>((a, b) =>
      supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .select(WORK_LINK_COLS)
        .in('prep_event_id', part)
        .order('confirm_id')
        .range(a, b) as unknown as PromiseLike<{ data: WorkLink[] | null; error: unknown }>,
    );
    out.push(...rows);
  }
  return out;
}

async function readCalendarInRange(supabase: Supa, from: string, to: string): Promise<CalRow[]> {
  return readAllPages<CalRow>((a, b) =>
    supabase
      .from(CALENDAR_TABLE)
      .select(CAL_COLS)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .order('id')
      .range(a, b) as unknown as PromiseLike<{ data: CalRow[] | null; error: unknown }>,
  );
}

async function readCalendarByIds(supabase: Supa, ids: readonly string[]): Promise<CalRow[]> {
  const out: CalRow[] = [];
  for (const part of chunks(ids.filter(isUuid), CHUNK)) {
    const { data, error } = await supabase.from(CALENDAR_TABLE).select(CAL_COLS).in('id', part);
    if (error) throw error;
    out.push(...((data ?? []) as CalRow[]));
  }
  return out;
}

/** 영업 제목 만들 재료(renderer·doc)만 — payload 통째가 아니라 두 칸. 응답으로 안 나감 */
async function readSalesTitles(supabase: Supa, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase.from(SALES_CONFIRMS_TABLE).select('id,renderer:payload->>renderer,doc:payload->doc').in('id', part);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as { id: string; renderer: unknown; doc: unknown }[]) {
      out.set(r.id, salesTitleOf(r.renderer, r.doc));
    }
  }
  return out;
}

const toRuleEvent = (r: CalRow): LinkRuleEvent => ({
  id: r.id,
  date: r.date,
  time: r.time ?? '',
  title: r.title ?? '',
  listed: !!(r.naver_important || r.important),
});

// ───────────────────────── 창 모으기 ─────────────────────────

interface GatherInput {
  /** 짝을 찾을 날짜 창들(없으면 저장된 연결만 — 직송·따로 보기·납품일 없는 건) */
  windows: { from: string; to: string }[];
  /** 꼭 넣을 확인서(판정할 것) */
  seedConfirms: ConfirmLight[];
  /** 꼭 짝 계산에 넣을 일정(판정할 일정 — IT 표시와 상관없이) */
  seedEvents?: CalRow[];
  /** 직송 판정을 이미 읽었으면(같은 칸 두 번 안 읽게) */
  knownModes?: Map<string, { directShip: boolean; consignName: string }>;
}

interface Gathered {
  confirms: LinkRuleConfirm[];
  events: LinkRuleEvent[];
  extraEvents: LinkRuleEvent[];
}

async function gather(supabase: Supa, input: GatherInput): Promise<Gathered> {
  // 1) 일정: 창 안 IT 출고 일정 + 판정할 일정
  const evRows = new Map<string, CalRow>();
  const ranged = await Promise.all(input.windows.map((w) => readCalendarInRange(supabase, w.from, w.to)));
  for (const r of ranged.flat()) if (isItPrepTarget(r.title ?? '', '')) evRows.set(r.id, r);
  for (const r of input.seedEvents ?? []) evRows.set(r.id, r);

  // 2) 확인서: 창 안 납품일 + 판정할 것
  const cRows = new Map<string, ConfirmLight>();
  const cRanged = await Promise.all(input.windows.map((w) => readConfirmsInRange(supabase, w.from, w.to)));
  for (const r of cRanged.flat()) cRows.set(r.id, r);
  for (const r of input.seedConfirms) cRows.set(r.id, r);

  // 3) ③ 연결 칸: 이 확인서들 + 이 일정들에 저장 연결된 줄(창 밖 확인서도 — "다른 확인서가 이미 연결" 판정에 필요)
  const eventIds = [...evRows.keys()];
  const [workA, workB] = await Promise.all([readWorkByConfirm(supabase, [...cRows.keys()]), readWorkByEvent(supabase, eventIds)]);
  const work = new Map<string, WorkLink>();
  for (const w of [...workA, ...workB]) work.set(w.confirm_id, w);
  const missingConfirmIds = workB.map((w) => w.confirm_id).filter((id) => !cRows.has(id));
  if (missingConfirmIds.length) for (const r of await readConfirmsByIds(supabase, [...new Set(missingConfirmIds)])) cRows.set(r.id, r);

  const confirmRows = [...cRows.values()];
  const otherIds = new Set(confirmRows.filter((c) => isOtherSalesType(c.type)).map((c) => c.id));

  // 4) 직송(payload 세 칸만 — listQuery 와 같은 읽기). 못 읽으면 직송 아님으로(목록과 같음, 로그 code)
  const known = input.knownModes ?? new Map<string, { directShip: boolean; consignName: string }>();
  const needModes = confirmRows.map((c) => c.id).filter((id) => !otherIds.has(id) && !known.has(id));
  const modes = new Map(known);
  if (needModes.length) for (const [id, m] of (await readDeliveryModes(supabase, needModes)).map) modes.set(id, m);

  // 5) 영업 제목: 같은 날짜 일정 중 상호가 맞는 게 있는 확인서만 payload 두 칸을 읽음(§4-C — 속도)
  const evByDate = new Map<string, CalRow[]>();
  for (const e of evRows.values()) {
    const list = evByDate.get(e.date) ?? [];
    list.push(e);
    evByDate.set(e.date, list);
  }
  const titleIds = confirmRows
    .filter((c) => !otherIds.has(c.id) && isYmd(c.delivery_date))
    .filter((c) => (evByDate.get(c.delivery_date!) ?? []).some((e) => companyMatch(c.company, e.title) !== null))
    .map((c) => c.id);
  const titles = titleIds.length ? await readSalesTitles(supabase, titleIds) : new Map<string, string>();

  // 6) 저장 연결 일정 중 위에서 안 읽은 것(창 밖·IT 표시 빠짐) — 보여 주기만
  const extraIds = [...new Set([...work.values()].map((w) => w.prep_event_id).filter((id): id is string => !!id && !evRows.has(id)))];
  const extraRows = extraIds.length ? await readCalendarByIds(supabase, extraIds) : [];

  const confirms: LinkRuleConfirm[] = confirmRows.map((c) => {
    const w = work.get(c.id);
    const other = otherIds.has(c.id);
    return {
      id: c.id,
      docNo: c.doc_no ?? '',
      company: c.company ?? '',
      deliveryDate: isYmd(c.delivery_date) ? c.delivery_date : null,
      type: c.type ?? '',
      region: regionWithGuess(c.region, c.address).region,
      salesTitle: titles.get(c.id) ?? '',
      salesDeleted: c.sales_state === SALES_STATE_DELETED,
      status: w && isSalesConfirmStatus(w.status) ? w.status : '접수',
      directShip: !other && !!modes.get(c.id)?.directShip,
      other,
      savedEventId: w?.prep_event_id ?? null,
      savedSource: w?.link_source ?? '',
      workUpdatedAt: w?.updated_at ?? null,
    };
  });
  return { confirms, events: [...evRows.values()].map(toRuleEvent), extraEvents: extraRows.map(toRuleEvent) };
}

/** 상세용: 연결·후보 일정의 준비 기록·완료 보고를 채우고 후보를 다시 정렬(복사본이면 기록 있는 쪽이 위로) */
async function fillRecords(supabase: Supa, state: PrepLinkState): Promise<PrepLinkState> {
  const ids = [state.event?.eventId, ...state.candidates.map((c) => c.eventId)].filter((x): x is string => !!x);
  if (!ids.length) return state;
  const [ev, rep] = await Promise.all([
    supabase.from(PREP_EVENTS_TABLE).select('event_id,prep_checks').in('event_id', ids),
    supabase.from(PREP_REPORTS_TABLE).select('event_id,sent_at').in('event_id', ids),
  ]);
  if (ev.error) throw ev.error;
  if (rep.error) throw rep.error;
  const checks = new Map(((ev.data ?? []) as { event_id: string; prep_checks: PrepChecks | null }[]).map((r) => [r.event_id, r.prep_checks]));
  const sent = new Map(((rep.data ?? []) as { event_id: string; sent_at: string | null }[]).map((r) => [r.event_id, !!r.sent_at]));
  const fill = (c: PrepLinkCandidate): PrepLinkCandidate => {
    const ch = checks.get(c.eventId);
    const text = prepStateText(ch);
    return { ...c, prepState: text, reportSent: sent.get(c.eventId) ?? false, hasPrepRecord: text !== '준비 전' || sent.has(c.eventId) };
  };
  return { ...state, event: state.event ? fill(state.event) : null, candidates: sortCandidates(state.candidates.map(fill)) };
}

// ───────────────────────── 내보내는 읽기 ─────────────────────────

/**
 * 확인서 하나의 연결 상태(상세 — §4-C). 확인서가 없으면 null, DB 오류는 던짐(부르는 쪽이 isMissingSalesTable 로 나눔).
 * 따로 보는 종류·직송·납품일 없음 → 캘린더 창을 안 읽음(F29 — 저장된 연결만). withRecords = 후보의 준비 기록·완료 보고까지(상세).
 */
export async function readPrepLinkForConfirm(
  confirmId: string,
  opts: { withRecords?: boolean; supabase?: Supa } = {},
): Promise<PrepLinkState | null> {
  const id = cleanId(confirmId);
  if (!id) return null;
  const supabase = opts.supabase ?? createAdminClient();
  const [row] = await readConfirmsByIds(supabase, [id]);
  if (!row) return null;
  const other = isOtherSalesType(row.type);
  const knownModes = new Map<string, { directShip: boolean; consignName: string }>();
  if (!other) {
    const m = (await readDeliveryModes(supabase, [id])).map.get(id);
    knownModes.set(id, m ?? { directShip: false, consignName: '' });
  }
  const skip = other || !!knownModes.get(id)?.directShip || !isYmd(row.delivery_date);
  const windows = skip ? [] : windowsOf([row.delivery_date!]);
  const g = await gather(supabase, { windows, seedConfirms: [row], knownModes });
  const state = resolvePrepLinks(g).byConfirm.get(id) ?? null;
  if (!state || !opts.withRecords) return state;
  return fillRecords(supabase, state);
}

/** 목록 보이는 줄의 출고 준비 칸(확인서 id → 상태). 없는 id 는 빠짐. 최대 MAX_CONFIRM_BADGES */
export async function readConfirmPrepBadges(confirmIds: readonly string[]): Promise<Record<string, PrepLinkState>> {
  const ids = [...new Set(confirmIds.map(cleanId).filter(Boolean))].slice(0, MAX_CONFIRM_BADGES);
  if (!ids.length) return {};
  const supabase = createAdminClient();
  const rows = await readConfirmsByIds(supabase, ids);
  // 따로 보는 종류는 창이 필요 없음(직송은 아직 모름 — 같이 넣어도 판정은 notTarget)
  const windows = windowsOf(rows.filter((r) => !isOtherSalesType(r.type)).map((r) => r.delivery_date ?? ''));
  const g = await gather(supabase, { windows, seedConfirms: rows });
  const { byConfirm } = resolvePrepLinks({ ...g, maxCandidates: 5 });
  const out: Record<string, PrepLinkState> = {};
  for (const r of rows) {
    const st = byConfirm.get(r.id);
    if (st) out[r.id] = st;
  }
  return out;
}

/** 출고 준비 리스트 보이는 일정의 확인서 배지(일정 id → 배지). 없는 일정 id 는 빠짐. 최대 MAX_EVENT_BADGES */
export async function readEventConfirmBadges(eventIds: readonly string[]): Promise<Record<string, PrepConfirmBadge>> {
  const ids = [...new Set(eventIds.map(cleanId).filter(isUuid))].slice(0, MAX_EVENT_BADGES);
  if (!ids.length) return {};
  const supabase = createAdminClient();
  const rows = await readCalendarByIds(supabase, ids);
  if (!rows.length) return {};
  const g = await gather(supabase, { windows: windowsOf(rows.map((r) => r.date)), seedConfirms: [], seedEvents: rows });
  const { byEvent } = resolvePrepLinks(g);
  const out: Record<string, PrepConfirmBadge> = {};
  for (const r of rows) {
    const b = byEvent.get(r.id);
    if (b) out[r.id] = b;
  }
  return out;
}

// ───────────────────────── 쓰기(③ prep_event_id · link_source 만) ─────────────────────────

export interface WriteConfirmLinkInput {
  confirmId: string;
  /** source 'manual' 이면 일정 id(uuid), 'none'·'' 이면 null */
  eventId: string | null;
  /** 'manual' 연결·바꾸기 · 'none' 풀기·출고 일정 없음으로 두기 · '' 'none' 되돌리기(다시 자동으로 찾기) */
  source: 'manual' | 'none' | '';
  /** 화면이 본 ③ updated_at(DB 문자열 그대로) — ③ 줄이 없었으면 null(그때만 새로 만듦) */
  expectedUpdatedAt: string | null;
  actor: string;
}

/**
 * 연결 쓰기(§4-A). 확인서 1 → 일정 1(바꾸면 덮음), 일정 1 → 확인서 여럿 허용(검사 안 함).
 * DB 오류도 던지지 않고 쉬운 말로 돌려줌(로그 code 만). 성공하면 새 workUpdatedAt — 화면이 갱신해야 다음 저장에서 가짜 충돌이 안 남(H16).
 */
export async function writeConfirmLink(input: WriteConfirmLinkInput): Promise<PrepLinkSaveResult> {
  const confirmId = cleanId(input.confirmId);
  const source = input.source;
  if (!confirmId || (source !== 'manual' && source !== 'none' && source !== '')) return { ok: false, error: MSG_LINK_FAIL };
  const eventId = source === 'manual' ? input.eventId : null;
  if (source === 'manual' && !isUuid(eventId)) return { ok: false, error: MSG_LINK_EVENT_GONE };
  const expected = typeof input.expectedUpdatedAt === 'string' && input.expectedUpdatedAt ? input.expectedUpdatedAt : null;
  const supabase = createAdminClient();
  try {
    if (eventId) {
      const { data, error } = await supabase.from(CALENDAR_TABLE).select('id').eq('id', eventId).maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, error: MSG_LINK_EVENT_GONE };
    }
    const patch = { prep_event_id: eventId, link_source: source, updated_by: cleanActor(input.actor) };
    const back = 'updated_at,prep_event_id,link_source';
    type SavedRow = { updated_at: string; prep_event_id: string | null; link_source: string | null };
    let saved: SavedRow | null = null;
    if (expected === null) {
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .insert({ confirm_id: confirmId, ...patch })
        .select(back)
        .single();
      if (error) {
        if (error.code === '23505') return { ok: false, conflict: true, error: MSG_LINK_CONFLICT };
        if (error.code === '23503') return { ok: false, error: /prep_event_id/.test(error.message ?? '') ? MSG_LINK_EVENT_GONE : MSG_LINK_CONFIRM_GONE };
        throw error;
      }
      saved = data as unknown as SavedRow;
    } else {
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .update(patch)
        .eq('confirm_id', confirmId)
        .eq('updated_at', expected)
        .select(back);
      if (error) {
        if (error.code === '23503') return { ok: false, error: MSG_LINK_EVENT_GONE };
        throw error;
      }
      const rows = (data ?? []) as unknown as SavedRow[];
      if (!rows.length) return { ok: false, conflict: true, error: MSG_LINK_CONFLICT };
      saved = rows[0];
    }
    if (!saved) return { ok: false, error: MSG_LINK_FAIL };
    const linkSource: PrepLinkSource = isPrepLinkSource(saved.link_source) ? saved.link_source : '';
    return { ok: true, workUpdatedAt: saved.updated_at, prepEventId: saved.prep_event_id ?? null, linkSource };
  } catch (err) {
    logFail('출고 준비 연결 쓰기', err);
    return { ok: false, error: isMissingSalesTable(err) ? MSG_LINK_NO_TABLE : MSG_LINK_FAIL };
  }
}

/**
 * 자동 짝 저장('auto' — F4, 4-2·4-3 에서 부름: 완료 보고 저장·발송, 준비 단추).
 * 지금도 그 일정이 이 확인서의 화면 계산 자동 짝(kind 'auto')이고, ③ 이 prep_event_id null + link_source '' 일 때만 씀
 * (사람이 정한 것·풀어 둔 것 안 덮음). 조건이 안 맞으면 saved false(오류 아님). DB 오류는 던짐 — 부르는 쪽이 잡아 로그 code 만
 * (보고 발송·준비 단추를 막지 말 것).
 */
export async function saveComputedAutoLink(
  confirmId: string,
  eventId: string,
  actor: string,
): Promise<{ saved: boolean; workUpdatedAt: string | null }> {
  const id = cleanId(confirmId);
  if (!id || !isUuid(eventId)) return { saved: false, workUpdatedAt: null };
  const supabase = createAdminClient();
  const state = await readPrepLinkForConfirm(id, { supabase });
  if (!state || state.kind !== 'auto' || state.event?.eventId !== eventId) return { saved: false, workUpdatedAt: state?.workUpdatedAt ?? null };
  const patch = { prep_event_id: eventId, link_source: 'auto', updated_by: cleanActor(actor) };
  const updateIfUnset = async () => {
    const { data, error } = await supabase
      .from(SALES_CONFIRM_WORK_TABLE)
      .update(patch)
      .eq('confirm_id', id)
      .is('prep_event_id', null)
      .eq('link_source', '')
      .select('updated_at');
    if (error) throw error;
    const rows = (data ?? []) as { updated_at: string }[];
    return rows.length ? rows[0].updated_at : null;
  };
  const first = await updateIfUnset();
  if (first) return { saved: true, workUpdatedAt: first };
  if (state.workUpdatedAt !== null) return { saved: false, workUpdatedAt: state.workUpdatedAt }; // ③ 줄이 있는데 그 사이 누가 정함
  // ③ 줄이 없었음 → 만듦(그 사이 누가 만들었으면 조건부로 한 번 더)
  const { data, error } = await supabase.from(SALES_CONFIRM_WORK_TABLE).insert({ confirm_id: id, ...patch }).select('updated_at').single();
  if (!error) return { saved: true, workUpdatedAt: (data as { updated_at: string }).updated_at };
  if (error.code !== '23505') throw error;
  const again = await updateIfUnset();
  return { saved: !!again, workUpdatedAt: again };
}
