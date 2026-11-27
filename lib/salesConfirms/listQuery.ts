import 'server-only';

/**
 * 영업 확인서 목록 읽기(①③④⑤) — payload 칸은 읽지 않음(목록엔 contacts·items·supplies 로 충분).
 * 범위: ① 최근 120일(처음 받은 날 또는 납품일 기준) + ③ 상태가 출고·취소가 아닌 더 옛날 건.
 * Supabase 는 한 번에 1000줄까지 → 페이지로 끝까지, ③④ 는 id 200개씩 .in (④ 는 그 안에서도 페이지).
 * 칸 계산(칸 수·진행 n/m·다시 확인 필요)은 slots.ts 한 곳(2+3단계 — 진행 m = 장비·모니터·유지보수 칸만).
 * SQL 블록 A 전이면 ③ printed_ver·④ diff_ack 없이 읽음(출력 판·다시 확인 필요는 "모름"으로).
 * 쓰기 없음.
 */
import {
  SALES_CONFIRMS_TABLE,
  SALES_CONFIRM_UNITS_TABLE,
  SALES_CONFIRM_WORK_TABLE,
  SALES_IMPORT_STATE_TABLE,
  createAdminClient,
} from '@/lib/supabase/server';
import { deliveryModeFromPayload } from './deliveryMode';
import { regionWithGuess } from './prepMatch';
import { buildSlotLines, recheckSlotCount, slotItems, slotProgress, toSalesItems, unitRowFromDb } from './slots';
import {
  SALES_CONFIRM_DONE_STATUSES,
  SALES_STATE_DELETED,
  contactLine,
  importStateFromRow,
  isOtherSalesType,
  isSalesConfirmStatus,
  safeDocUrl,
  salesChangedSince,
  salesTimeToIso,
  type SalesConfirmContacts,
  type SalesConfirmListResult,
  type SalesConfirmListRow,
  type SalesImportStateRow,
  type SalesUnitRow,
} from './types';

const PREP_PEOPLE_TABLE = 'it_prep_people'; // app/shipment-prep/actions.ts 와 같은 표(그 파일은 상수를 안 내보냄)
const WINDOW_DAYS = 120;
const CHUNK = 200;
const MAX_QTY = 50;

type Supa = ReturnType<typeof createAdminClient>;
type Json = Record<string, unknown>;

/** 표 없음 판정 — 42P01/PGRST205 또는 "does not exist" 류 문구만(권한 오류를 "없음"으로 보지 않음) */
export function isMissingSalesTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /does not exist|could not find the table|schema cache/i.test(e.message ?? '');
}

/**
 * SQL 블록 A 칸(④ extra·diff_ack, ③ printed_ver·printed_by)이 아직 없는지 — 좁게만:
 * code 42703(칸 없음)·PGRST204(스키마에 칸 없음) **이면서** 문구에 그 칸 이름이 있을 때만. 권한 오류 등은 그대로 오류.
 * (count head 요청은 오류 본문이 비어 이 판정에 쓰지 말 것)
 */
export function isMissingSalesColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code !== '42703' && e.code !== 'PGRST204') return false;
  return /\b(extra|diff_ack|printed_ver|printed_by)\b/.test(e.message ?? '');
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

export function kstTodayYmd(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function chunks<T>(arr: T[], n: number): T[][] {
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

// ───────────── 원본 줄 모양 ─────────────

interface ConfirmDbRow {
  id: string;
  doc_no: string | null;
  ver: number | null;
  type: string | null;
  term: string | null;
  first_saved_at: string | null;
  saved_by: string | null;
  sales_rep: string | null;
  company: string | null;
  address: string | null;
  region: string | null;
  delivery_date: string | null;
  contacts: unknown;
  items: unknown;
  supplies: unknown;
  replace_info: unknown;
  special: string | null;
  doc_url: string | null;
  payload_hash: string | null;
  sales_state: string | null;
  first_seen_at: string;
  changed_at: string | null;
}
const CONFIRM_COLS =
  'id,doc_no,ver,type,term,first_saved_at,saved_by,sales_rep,company,address,region,delivery_date,contacts,items,supplies,replace_info,special,doc_url,payload_hash,sales_state,first_seen_at,changed_at';

interface WorkDbRow {
  confirm_id: string;
  status: string | null;
  processors: string[] | null;
  note: string | null;
  seen_ver: number | null;
  seen_hash: string | null;
  first_opened_at: string | null;
  printed_at: string | null;
  /** SQL 블록 A 전이면 없음 */
  printed_ver?: number | null;
  updated_at: string | null;
}
const WORK_COLS_BASE = 'confirm_id,status,processors,note,seen_ver,seen_hash,first_opened_at,printed_at,updated_at';
const WORK_COLS_FULL: string = `${WORK_COLS_BASE},printed_ver`;

interface UnitDbRow extends Json {
  confirm_id: string;
}
const UNIT_COLS_BASE = 'id,confirm_id,slot_key,unit_no,asset_id,serial,actual_maker,actual_model,spec_override,updated_at';
/** 블록 A 뒤 — 다시 확인 필요(diff_ack) 계산용 */
const UNIT_COLS_FULL: string = `${UNIT_COLS_BASE},diff_ack`;

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clampQty = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_QTY, n)) : 0;
};

// ───────────── 요약 계산 ─────────────

/** CPU 문구를 짧게: i5-12400 → i5, Ryzen 5 → R5, 그 밖엔 앞 10자 */
export function shortCpu(raw: string): string {
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

function specLine(cat: string, spec: Json): string {
  const g = (k: string) => asStr(spec[k]).replace(/\s+/g, '');
  const inch = g('인치');
  if (!g('CPU') && !g('RAM') && !g('SSD') && !g('HDD')) {
    return inch ? (/\D/.test(inch) ? inch : `${inch}인치`) : '';
  }
  const parts = [shortCpu(asStr(spec.CPU)), g('RAM'), g('SSD') || g('HDD')].filter(Boolean);
  if (inch && /모니터/.test(cat)) parts.push(/\D/.test(inch) ? inch : `${inch}인치`);
  return parts.join('/');
}

interface ReadFlags {
  /** ④ diff_ack 칸이 있음(SQL 블록 A 뒤) — 없으면 "다시 확인 필요"를 모름(0) */
  unitsReady: boolean;
  /** ③ printed_ver 칸이 있음(SQL 블록 A 뒤) — 없으면 출력 판을 모름(printed_at 과 ① changed_at 으로만) */
  printedReady: boolean;
}

/** 영업에서 지운 건의 지운 시각·사람(① payload 의 그 두 칸만 — 목록은 payload 통째로 안 읽음) */
interface DeletedInfo {
  at: string | null;
  by: string;
}

function buildRow(
  c: ConfirmDbRow,
  work: WorkDbRow | undefined,
  units: SalesUnitRow[],
  flags: ReadFlags,
  deleted?: DeletedInfo,
): SalesConfirmListRow {
  const other = isOtherSalesType(c.type);
  const isDeleted = c.sales_state === SALES_STATE_DELETED;
  // 따로 보는 종류(판매·철수·이전)는 기기 칸·진행·출력 값을 안 만듦
  // 칸 계산은 slots.ts 한 곳(교체 건에 items 가 비면 after 를 1칸으로)
  const items = other
    ? []
    : slotItems({
        items: toSalesItems(c.items),
        replaceInfo: c.replace_info && typeof c.replace_info === 'object' ? (asObj(c.replace_info) as { before: unknown; after: unknown }) : null,
      });
  if (other) units = [];
  const { lines, orphans } = buildSlotLines(items, units);

  // 품목 요약: 같은 품목구분끼리 합침(영업 수량 그대로)
  const byCat = new Map<string, number>();
  for (const it of items) {
    const q = clampQty(it.qty);
    if (q > 0) byCat.set(asStr(it.cat) || '기타', (byCat.get(asStr(it.cat) || '기타') ?? 0) + q);
  }
  const itemSummary = [...byCat].map(([cat, q]) => `${cat} ${q}`).join(' · ');

  // 사양 요약: ④ spec_override(IT가 고친 칸)가 있으면 그 값 우선
  let specEdited = false;
  const specParts: string[] = [];
  for (const line of lines) {
    const spec: Json = { ...line.item.spec };
    for (const s of line.slots) {
      for (const [k, v] of Object.entries(s.unit?.specOverride ?? {})) {
        const val = asStr(v);
        if (val) {
          spec[k] = val;
          specEdited = true;
        }
      }
    }
    const text = specLine(line.item.cat, spec);
    if (text && !specParts.includes(text)) specParts.push(text);
  }

  // 자산번호·시리얼: 칸 순서 → 영업에서 빠진 칸(검색에 걸리게)
  const ordered = [...lines.flatMap((l) => l.slots.map((s) => s.unit).filter((u): u is SalesUnitRow => !!u)), ...orphans];
  // 진행 n/m — m = 장비·모니터·유지보수 칸만(소프트웨어·기타는 안 셈)
  const progress = slotProgress(lines);

  const supplies = asArr(c.supplies)
    .map(asObj)
    .map((s) => {
      const q = clampQty(s.qty);
      const ch = asStr(s.charge);
      return `${asStr(s.name)}${q > 0 ? ` ${q}` : ''}${ch ? `(${ch})` : ''}`.trim();
    })
    .filter(Boolean);

  const ver = c.ver ?? 0;
  const salesChanged = salesChangedSince(work?.seen_ver, ver);

  // 지역: 영업 값, 비었으면 주소로 추정(영업 웹앱과 같은 regionOf)
  const reg = regionWithGuess(c.region, c.address);

  // 출력 뒤 바뀜: 영업 판이 올랐거나(블록 A 전엔 ① changed_at > printed_at) IT 칸이 출력 뒤에 저장됨
  const printedAt = work?.printed_at ?? null;
  const printedVer = flags.printedReady ? (work?.printed_ver ?? null) : null;
  let printStale = false;
  if (printedAt) {
    const pAt = ms(printedAt);
    printStale =
      (printedVer !== null ? ver > printedVer : ms(c.changed_at) > pAt) || units.some((u) => ms(u.updatedAt) > pAt);
  }

  return {
    id: c.id,
    docNo: c.doc_no ?? '',
    ver,
    deliveryDate: c.delivery_date,
    receivedAt: c.first_saved_at ?? c.first_seen_at,
    status: work && isSalesConfirmStatus(work.status) ? work.status : '접수',
    savedBy: c.saved_by ?? '',
    processors: work?.processors ?? [],
    salesRep: c.sales_rep ?? '',
    type: c.type ?? '',
    term: c.term ?? '',
    company: c.company ?? '',
    region: reg.region,
    // 대표번호가 없으면 IT담당 → 계약담당 → 현장상주(실측 — types.ts contactLine)
    phone: contactLine(asObj(c.contacts) as Partial<SalesConfirmContacts>),
    itemSummary,
    specSummary: specParts.join(' · '),
    specEdited,
    assetIds: ordered.map((u) => u.assetId).filter(Boolean),
    serials: ordered.map((u) => u.serial).filter(Boolean),
    unitsFilled: progress.filled,
    unitsTotal: progress.total,
    suppliesSummary: supplies.join(' · '),
    special: c.special ?? '',
    note: work?.note ?? '',
    isNew: !isDeleted && (!work || !work.first_opened_at),
    salesChanged,
    salesState: c.sales_state ?? '',
    docUrl: safeDocUrl(c.doc_url),
    workUpdatedAt: work?.updated_at ?? null,
    firstSeenAt: c.first_seen_at,
    regionGuessed: reg.guessed,
    // 블록 A 전엔 확인 기록이 없어 모름 → 0
    recheckCount: flags.unitsReady ? recheckSlotCount(lines) : 0,
    printedVer,
    printStale,
    salesDeletedAt: isDeleted ? (deleted?.at ?? null) : null,
    salesDeletedBy: isDeleted ? (deleted?.by ?? '') : '',
    other,
  };
}

/** 정렬: 오늘 이후 납품일 가까운 순 → 지난 건(가까운 과거부터) → 납품일 없음(접수 늦은 순) */
export function sortListRows(rows: SalesConfirmListRow[], today: string): SalesConfirmListRow[] {
  const grp = (r: SalesConfirmListRow) => (!r.deliveryDate ? 2 : r.deliveryDate >= today ? 0 : 1);
  return [...rows].sort((a, b) => {
    const ga = grp(a);
    const gb = grp(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return (a.deliveryDate ?? '').localeCompare(b.deliveryDate ?? '') || a.docNo.localeCompare(b.docNo);
    if (ga === 1) return (b.deliveryDate ?? '').localeCompare(a.deliveryDate ?? '') || a.docNo.localeCompare(b.docNo);
    return (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '') || a.docNo.localeCompare(b.docNo);
  });
}

// ───────────── 읽기 ─────────────

async function readWork(supabase: Supa, ids: string[]): Promise<{ map: Map<string, WorkDbRow>; printedReady: boolean }> {
  const run = async (full: boolean) => {
    const out = new Map<string, WorkDbRow>();
    for (const part of chunks(ids, CHUNK)) {
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .select(full ? WORK_COLS_FULL : WORK_COLS_BASE)
        .in('confirm_id', part);
      if (error) throw error;
      for (const w of (data ?? []) as unknown as WorkDbRow[]) out.set(w.confirm_id, w);
    }
    return out;
  };
  try {
    return { map: await run(true), printedReady: true };
  } catch (err) {
    if (!isMissingSalesColumn(err)) throw err;
    return { map: await run(false), printedReady: false };
  }
}

async function readUnits(supabase: Supa, ids: string[]): Promise<{ map: Map<string, SalesUnitRow[]>; unitsReady: boolean }> {
  const run = async (full: boolean) => {
    const out = new Map<string, SalesUnitRow[]>();
    for (const part of chunks(ids, CHUNK)) {
      const rows = await readAllPages<UnitDbRow>((from, to) =>
        supabase
          .from(SALES_CONFIRM_UNITS_TABLE)
          .select(full ? UNIT_COLS_FULL : UNIT_COLS_BASE)
          .in('confirm_id', part)
          .order('confirm_id')
          .order('slot_key')
          .order('unit_no')
          .range(from, to) as unknown as PromiseLike<{ data: UnitDbRow[] | null; error: unknown }>,
      );
      for (const r of rows) {
        const u = unitRowFromDb(r);
        const list = out.get(r.confirm_id);
        if (list) list.push(u);
        else out.set(r.confirm_id, [u]);
      }
    }
    return out;
  };
  try {
    return { map: await run(true), unitsReady: true };
  } catch (err) {
    if (!isMissingSalesColumn(err)) throw err;
    return { map: await run(false), unitsReady: false };
  }
}

/** 지운 건의 지운 시각·사람 — payload 통째로 안 읽고 PostgREST 로 그 두 칸만. 못 읽어도 목록은 보여 줌(시각·사람만 빈 값) */
async function readDeletedInfo(supabase: Supa, ids: string[]): Promise<Map<string, DeletedInfo>> {
  const out = new Map<string, DeletedInfo>();
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase
      .from(SALES_CONFIRMS_TABLE)
      .select('id,deleted_at:payload->>deletedAt,deleted_by:payload->>deletedBy')
      .in('id', part);
    if (error) {
      console.warn('[sales-confirms] 지운 정보 읽기 실패', (error as { code?: string }).code ?? 'unknown');
      return out;
    }
    for (const r of (data ?? []) as unknown as { id: string; deleted_at: unknown; deleted_by: unknown }[]) {
      out.set(r.id, { at: salesTimeToIso(r.deleted_at), by: asStr(r.deleted_by) });
    }
  }
  return out;
}

/**
 * 직송 판정용 세 칸(consign·shipType·head)만 — payload 통째로 안 읽음(F28). 납품은 맨 위, 교체·유지보수·소프트웨어는 doc 안이라 둘 다.
 * 못 읽으면 빈 맵(= 직송 아님으로 보임) — 목록은 뜨고 로그엔 code 만. `failed` 로 알려 줘 화면이 필요하면 안내할 수 있음.
 * 홈 숫자도 같이 씀(export).
 */
export async function readDeliveryModes(
  supabase: Supa,
  ids: string[],
): Promise<{ map: Map<string, { directShip: boolean; consignName: string }>; failed: boolean }> {
  const map = new Map<string, { directShip: boolean; consignName: string }>();
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase
      .from(SALES_CONFIRMS_TABLE)
      .select(
        'id,t_consign:payload->>consign,t_ship:payload->>shipType,t_head:payload->>head,d_consign:payload->doc->>consign,d_ship:payload->doc->>shipType,d_head:payload->doc->>head',
      )
      .in('id', part);
    if (error) {
      console.warn('[sales-confirms] 직송 칸 읽기 실패', (error as { code?: string }).code ?? 'unknown');
      return { map, failed: true };
    }
    type R = { id: string; t_consign: unknown; t_ship: unknown; t_head: unknown; d_consign: unknown; d_ship: unknown; d_head: unknown };
    for (const r of (data ?? []) as unknown as R[]) {
      // doc 에 위탁사가 있으면 doc 쪽, 아니면 맨 위(deliveryModeFromPayload 와 같은 고르기)
      const useDoc = asStr(r.d_consign) !== '';
      map.set(
        r.id,
        deliveryModeFromPayload(
          useDoc
            ? { doc: { consign: r.d_consign, shipType: r.d_ship, head: r.d_head } }
            : { consign: r.t_consign, shipType: r.t_ship, head: r.t_head },
        ),
      );
    }
  }
  return { map, failed: false };
}

async function rowsFor(supabase: Supa, confirms: ConfirmDbRow[]): Promise<SalesConfirmListRow[]> {
  const ids = confirms.map((c) => c.id);
  const deletedIds = confirms.filter((c) => c.sales_state === SALES_STATE_DELETED).map((c) => c.id);
  // 따로 보는 종류(판매·철수·이전)는 직송 판정 대상이 아님
  const modeIds = confirms.filter((c) => !isOtherSalesType(c.type)).map((c) => c.id);
  const [work, units, deleted, modes] = await Promise.all([
    readWork(supabase, ids),
    readUnits(supabase, ids),
    readDeletedInfo(supabase, deletedIds),
    readDeliveryModes(supabase, modeIds),
  ]);
  const flags: ReadFlags = { unitsReady: units.unitsReady, printedReady: work.printedReady };
  return confirms.map((c) => {
    const row = buildRow(c, work.map.get(c.id), units.map.get(c.id) ?? [], flags, deleted.get(c.id));
    const mode = modes.map.get(c.id);
    row.directShip = !row.other && !!mode?.directShip;
    row.consignName = mode?.consignName ?? '';
    return row;
  });
}

/** 시트 비교용: 고른 id 의 목록 줄(payload 없음) */
export async function loadListRowsByIds(ids: string[]): Promise<SalesConfirmListRow[]> {
  const supabase = createAdminClient();
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 2000);
  const confirms: ConfirmDbRow[] = [];
  for (const part of chunks(unique, CHUNK)) {
    const { data, error } = await supabase.from(SALES_CONFIRMS_TABLE).select(CONFIRM_COLS).in('id', part);
    if (error) throw error;
    confirms.push(...((data ?? []) as ConfirmDbRow[]));
  }
  return rowsFor(supabase, confirms);
}

export async function readImportStateRow(supabase: Supa) {
  const { data, error } = await supabase.from(SALES_IMPORT_STATE_TABLE).select('*').eq('id', 'main').maybeSingle();
  if (error) return null; // 상태 줄을 못 읽어도 목록은 보여 줌
  return importStateFromRow(data as SalesImportStateRow | null);
}

async function readPeople(supabase: Supa): Promise<string[]> {
  const { data, error } = await supabase.from(PREP_PEOPLE_TABLE).select('name').eq('is_active', true).order('sort_order').order('name');
  if (error) return [];
  return ((data ?? []) as { name: string }[]).map((p) => p.name).filter(Boolean);
}

export async function loadSalesConfirmList(): Promise<SalesConfirmListResult> {
  try {
    const supabase = createAdminClient();
    const today = kstTodayYmd();
    const cutoff = shiftYmd(today, -WINDOW_DAYS);
    const cutoffIso = new Date(`${cutoff}T00:00:00+09:00`).toISOString();

    // ① 최근 120일(처음 받은 날 또는 납품일)
    const recent = await readAllPages<ConfirmDbRow>((from, to) =>
      supabase
        .from(SALES_CONFIRMS_TABLE)
        .select(CONFIRM_COLS)
        .or(`first_seen_at.gte.${cutoffIso},delivery_date.gte.${cutoff}`)
        .order('id')
        .range(from, to),
    );
    const have = new Set(recent.map((r) => r.id));

    // 더 옛날 건 중 ③ 상태가 출고·취소가 아닌 것(처리 중이던 건이 사라지지 않게)
    const doneList = SALES_CONFIRM_DONE_STATUSES.map((s) => `"${s}"`).join(',');
    const openWork = await readAllPages<{ confirm_id: string }>((from, to) =>
      supabase.from(SALES_CONFIRM_WORK_TABLE).select('confirm_id').not('status', 'in', `(${doneList})`).order('confirm_id').range(from, to),
    );
    const olderIds = openWork.map((w) => w.confirm_id).filter((id) => !have.has(id));
    const older: ConfirmDbRow[] = [];
    for (const part of chunks(olderIds, CHUNK)) {
      const { data, error } = await supabase.from(SALES_CONFIRMS_TABLE).select(CONFIRM_COLS).in('id', part);
      if (error) throw error;
      older.push(...((data ?? []) as ConfirmDbRow[]));
    }

    const [rows, importState, people] = await Promise.all([
      rowsFor(supabase, [...recent, ...older]),
      readImportStateRow(supabase),
      readPeople(supabase),
    ]);
    return {
      ok: true,
      data: {
        rows: sortListRows(rows, today),
        importState,
        people,
        rangeLabel: `최근 ${WINDOW_DAYS}일 + 아직 안 끝난 옛 건`,
        hasKey: Boolean(process.env.SALES_EXPORT_KEY),
      },
    };
  } catch (err) {
    if (isMissingSalesTable(err)) return { ok: false, missingTable: true };
    // 원문·연락처가 섞일 수 있어 코드만 로그에 남김
    console.warn('[sales-confirms] 목록 읽기 실패', (err as { code?: string } | null)?.code ?? 'unknown');
    return { ok: false, error: '영업 확인서 목록을 못 읽었어요. 잠시 뒤 다시 열어 주세요.' };
  }
}
