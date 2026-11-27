import 'server-only';

/**
 * 영업 확인서 상세 — ③ it_sales_confirm_work · ④ it_sales_confirm_units 읽기·쓰기 (server-only, 화면 액션만 부름).
 * 설계 docs/tasks/2026-11-26-sales-confirm-import.md §3-2 ③④ · §3-4 · §3-10 · §4-2.
 *   ①② 는 읽기만(가져오기 코드만 씀). 출고 준비 표(it_prep_*)·캘린더는 읽기만. 시트·네이버·카톡 쓰기 없음.
 *   ③④ 문자열 칸은 not null default '' — null 을 보내지 않음. 동시 수정은 DB 가 준 updated_at 문자열 그대로 .eq.
 *   SQL 블록 A(④ extra·diff_ack, ③ printed_ver·printed_by) 전 판정은 좁게 — listQuery.isMissingSalesColumn
 *   (42703/PGRST204 + 그 칸 이름). select('*') 는 칸이 없어도 오류가 안 나므로 칸 이름을 적어서 읽음.
 *   오류 로그는 code 만(message·details 에 행 값·원문이 섞일 수 있음).
 *
 * developer E(lib/contracts/salesConfirmLink.ts)가 import: ensureUnitRow · readUnit · updateUnitExtra (types.ts 주석 그대로).
 */
import {
  CALENDAR_TABLE,
  SALES_CONFIRMS_TABLE,
  SALES_CONFIRM_UNITS_TABLE,
  SALES_CONFIRM_VERSIONS_TABLE,
  SALES_CONFIRM_WORK_TABLE,
  createAdminClient,
} from '@/lib/supabase/server';
import { guessCompany, isItPrepTarget, isPrepDone, isPrepInProgress, isPrepOverhaul, parseEventTitle, type PrepChecks } from '@/lib/shipmentPrep';
import { deliveryModeFromPayload } from './deliveryMode';
import { salesChangeLines } from './diff';
import type { ItemKind } from './itemKind';
import { isMissingSalesColumn } from './listQuery';
import { normalizeSalesConfirm } from './normalize';
import { matchPrepEvents, regionWithGuess, type PrepEventCandidate } from './prepMatch';
import {
  buildSlotLines,
  findSlotLine,
  itemSnapshot,
  kindOfSlotKey,
  parseChecks,
  parseExtra,
  slotItems,
  slotProgress,
  toSalesItems,
  unitRowFromDb,
} from './slots';
import {
  isOtherSalesType,
  isSalesConfirmStatus,
  safeDocUrl,
  salesChangedSince,
  type NormalizedSalesConfirm,
  type SalesConfirmDetailData,
  type SalesConfirmItem,
  type SalesConfirmStatus,
  type SalesConfirmSupply,
  type SalesUnitExtra,
  type SalesUnitRow,
} from './types';

export type Supa = ReturnType<typeof createAdminClient>;
type Json = Record<string, unknown>;

const PREP_PEOPLE_TABLE = 'it_prep_people'; // app/shipment-prep/actions.ts 와 같은 표(읽기만)
const PHOTO_ITEMS_TABLE = 'it_prep_photo_items'; // 출고 체크리스트(읽기만 — D11)
const PREP_EVENTS_TABLE = 'it_prep_events'; // 출고 준비 상태(읽기만)
const PREP_REPORTS_TABLE = 'it_prep_reports'; // 완료 보고(읽기만)
const CHUNK = 200;

// ───────────────────────── 칸 이름 ─────────────────────────

const UNIT_COLS_BASE =
  'id,confirm_id,slot_key,unit_no,item_snapshot,asset_id,serial,actual_maker,actual_model,spec_override,checks,note,updated_at,updated_by';
/** 블록 A 뒤 */
const UNIT_COLS_FULL: string = `${UNIT_COLS_BASE},extra,diff_ack`;
export const unitCols = (full: boolean): string => (full ? UNIT_COLS_FULL : UNIT_COLS_BASE);

const WORK_COLS_BASE =
  'confirm_id,status,processors,started_at,finished_at,shipped_at,note,seen_ver,seen_hash,first_opened_at,first_opened_by,checks,printed_at,updated_at,updated_by';
const WORK_COLS_FULL: string = `${WORK_COLS_BASE},printed_ver,printed_by`;
export const workCols = (full: boolean): string => (full ? WORK_COLS_FULL : WORK_COLS_BASE);

const CONFIRM_COLS =
  'id,doc_no,ver,type,term,saved_at,saved_by,sales_rep,company,address,region,delivery_date,contacts,items,supplies,replace_info,special,doc_url,payload,payload_hash,first_seen_at,changed_at,fetched_at';

// ───────────────────────── 오류 ─────────────────────────

export type SalesWorkErrorCode = 'not_found' | 'slot_not_found' | 'need_sql' | 'conflict' | 'bad_input';

/** 쉬운 말 문구를 가진 오류(값·원문 없음) — 부르는 쪽이 code 로 나눠 화면에 message 를 그대로 보여도 됨 */
export class SalesWorkError extends Error {
  readonly code: SalesWorkErrorCode;
  constructor(code: SalesWorkErrorCode, message: string) {
    super(message);
    this.name = 'SalesWorkError';
    this.code = code;
  }
}

export const MSG_NEED_SQL = 'SQL 실행이 필요해요 — supabase/sales_confirms_schema.sql 맨 끝 블록(2+3단계)을 실행한 뒤 다시 해 주세요.';
export const MSG_CONFLICT = '다른 사람이 방금 고쳤어요 — 새로 불러올게요.';
export const MSG_NOT_FOUND = '확인서를 못 찾았어요. 목록을 새로고침해 주세요.';
export const MSG_SLOT_GONE = '이 칸을 찾지 못했어요 — 영업이 품목을 바꿨을 수 있어요. 새로고침해 주세요.';

/** 로그는 code 만(message·details 에 행 값·원문이 섞일 수 있음) */
export function logSalesFail(where: string, err: unknown) {
  const code = err instanceof SalesWorkError ? err.code : ((err as { code?: string } | null)?.code ?? 'unknown');
  console.warn(`[sales-confirms] ${where} 실패`, code);
}

// ───────────────────────── 작은 도우미 ─────────────────────────

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const cleanActor = (a: unknown) => String(a ?? '').trim().slice(0, 40);

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

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ───────────────────────── ① 읽기 ─────────────────────────

export interface ConfirmRecord {
  row: Json;
  /** 저장된 payload 를 지금 normalize 로 다시 읽은 것(이상하면 ① 칸에서) */
  confirm: NormalizedSalesConfirm;
  ver: number;
  payloadHash: string;
}

/** ① 칸(목록용 사본)에서 만든 확인서 — payload 가 지금 정규화로 안 읽힐 때만 */
function confirmFromStored(r: Json): NormalizedSalesConfirm {
  const contacts = asObj(r.contacts);
  const supplies: SalesConfirmSupply[] = asArr(r.supplies).map((x) => {
    const s = asObj(x);
    const qty = Math.floor(Number(s.qty));
    return { name: asStr(s.name), qty: Number.isFinite(qty) && qty > 0 ? qty : 0, charge: asStr(s.charge), note: asStr(s.note) };
  });
  const rep = r.replace_info && typeof r.replace_info === 'object' ? asObj(r.replace_info) : null;
  return {
    id: asStr(r.id),
    docNo: asStr(r.doc_no),
    ver: Number(r.ver) || 0,
    type: asStr(r.type),
    term: asStr(r.term),
    savedAt: asStr(r.saved_at) || null,
    savedBy: asStr(r.saved_by),
    salesRep: asStr(r.sales_rep),
    company: asStr(r.company),
    address: asStr(r.address),
    region: asStr(r.region),
    deliveryDate: asStr(r.delivery_date) || null,
    contacts: {
      manager: asStr(contacts.manager),
      resident: asStr(contacts.resident),
      payer: asStr(contacts.payer),
      contractor: asStr(contacts.contractor),
      phone: asStr(contacts.phone),
    },
    special: asStr(r.special),
    items: toSalesItems(r.items),
    supplies,
    replaceInfo: rep ? { before: rep.before ?? null, after: rep.after ?? null } : null,
    docUrl: asStr(r.doc_url),
    inflow: '',
    leaseNo: '',
    reason: '',
  };
}

export async function readConfirmRecord(supabase: Supa, id: string): Promise<ConfirmRecord | null> {
  const { data, error } = await supabase.from(SALES_CONFIRMS_TABLE).select(CONFIRM_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Json;
  const fromPayload = normalizeSalesConfirm(row.payload);
  const confirm = fromPayload.ok ? fromPayload.value : confirmFromStored(row);
  return { row, confirm, ver: Number(row.ver) || 0, payloadHash: asStr(row.payload_hash) };
}

// ───────────────────────── ④ 읽기 ─────────────────────────

/** 이 확인서의 ④ 전부. 블록 A 전이면 extra·diff_ack 없이 읽고 schemaReady false */
export async function readUnitsFor(supabase: Supa, confirmId: string): Promise<{ units: SalesUnitRow[]; schemaReady: boolean }> {
  const read = (full: boolean) =>
    readAllPages<Json>((from, to) =>
      supabase
        .from(SALES_CONFIRM_UNITS_TABLE)
        .select(unitCols(full))
        .eq('confirm_id', confirmId)
        .order('slot_key')
        .order('unit_no')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: Json[] | null; error: unknown }>,
    );
  try {
    return { units: (await read(true)).map(unitRowFromDb), schemaReady: true };
  } catch (err) {
    if (!isMissingSalesColumn(err)) throw err;
    return { units: (await read(false)).map(unitRowFromDb), schemaReady: false };
  }
}

/** ④ 한 줄(id + 확인서 id 가 맞을 때만). 블록 A 전이면 schemaReady false */
export async function readUnitRow(
  supabase: Supa,
  confirmId: string,
  where: { id: string } | { slotKey: string; unitNo: number },
): Promise<{ unit: SalesUnitRow | null; schemaReady: boolean }> {
  const read = async (full: boolean) => {
    let q = supabase.from(SALES_CONFIRM_UNITS_TABLE).select(unitCols(full)).eq('confirm_id', confirmId);
    q = 'id' in where ? q.eq('id', where.id) : q.eq('slot_key', where.slotKey).eq('unit_no', where.unitNo);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? unitRowFromDb(data as unknown as Json) : null;
  };
  try {
    return { unit: await read(true), schemaReady: true };
  } catch (err) {
    if (!isMissingSalesColumn(err)) throw err;
    return { unit: await read(false), schemaReady: false };
  }
}

/** uuid 모양만 받음(잘못된 값으로 DB 오류 22P02 가 나지 않게) */
export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * ④ 조건부 update — 읽은 updated_at(DB 문자열 그대로)과 같을 때만. 0줄이면 null(그 사이 누가 고침).
 * full = 블록 A 뒤(extra·diff_ack 칸을 쓰고 돌려받음).
 */
export async function updateUnitIf(supabase: Supa, unit: SalesUnitRow, patch: Json, full: boolean): Promise<SalesUnitRow | null> {
  const { data, error } = await supabase
    .from(SALES_CONFIRM_UNITS_TABLE)
    .update(patch)
    .eq('id', unit.id)
    .eq('updated_at', unit.updatedAt)
    .select(unitCols(full));
  if (error) {
    if (isMissingSalesColumn(error)) throw new SalesWorkError('need_sql', MSG_NEED_SQL);
    throw error;
  }
  const rows = (data ?? []) as unknown as Json[];
  return rows.length ? unitRowFromDb(rows[0]) : null;
}

/** ④ 새 줄. 같은 칸이 이미 있으면(23505) null */
export async function insertUnit(supabase: Supa, row: Json, full: boolean): Promise<SalesUnitRow | null> {
  const { data, error } = await supabase.from(SALES_CONFIRM_UNITS_TABLE).insert(row).select(unitCols(full)).single();
  if (error) {
    if (error.code === '23505') return null;
    if (error.code === '23503') throw new SalesWorkError('not_found', MSG_NOT_FOUND);
    if (isMissingSalesColumn(error)) throw new SalesWorkError('need_sql', MSG_NEED_SQL);
    throw error;
  }
  return unitRowFromDb(data as unknown as Json);
}

// ───────────────────────── ③ 읽기 ─────────────────────────

export interface WorkRow {
  confirm_id: string;
  status: string | null;
  processors: string[] | null;
  started_at: string | null;
  finished_at: string | null;
  shipped_at: string | null;
  note: string | null;
  seen_ver: number | null;
  seen_hash: string | null;
  first_opened_at: string | null;
  first_opened_by: string | null;
  checks: unknown;
  printed_at: string | null;
  /** 블록 A 전이면 없음 */
  printed_ver?: number | null;
  printed_by?: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** ③ 한 줄. printedReady = 블록 A 의 printed_ver·printed_by 칸이 있음 */
export async function readWorkRow(supabase: Supa, confirmId: string): Promise<{ row: WorkRow | null; printedReady: boolean }> {
  const read = async (full: boolean) => {
    const { data, error } = await supabase.from(SALES_CONFIRM_WORK_TABLE).select(workCols(full)).eq('confirm_id', confirmId).maybeSingle();
    if (error) throw error;
    return (data as WorkRow | null) ?? null;
  };
  try {
    return { row: await read(true), printedReady: true };
  } catch (err) {
    if (!isMissingSalesColumn(err)) throw err;
    return { row: await read(false), printedReady: false };
  }
}

// ───────────────────────── developer E 가 쓰는 함수(types.ts 주석 그대로) ─────────────────────────

/**
 * ④ 행이 없으면 만듦(item_snapshot = 지금 영업 품목). 있으면 그대로 돌려줌.
 * 칸이 지금 품목에 없으면 SalesWorkError('slot_not_found'), 확인서가 없으면 'not_found'. DB 오류는 그대로 던짐.
 * (블록 A 전에도 만들 수는 있음 — extra 를 쓰는 updateUnitExtra 가 'need_sql' 로 막음)
 */
export async function ensureUnitRow(confirmId: string, slotKey: string, unitNo: number, actor: string): Promise<SalesUnitRow> {
  if (!confirmId || !slotKey || !Number.isInteger(unitNo) || unitNo < 1) throw new SalesWorkError('bad_input', MSG_SLOT_GONE);
  const supabase = createAdminClient();
  const first = await readUnitRow(supabase, confirmId, { slotKey, unitNo });
  if (first.unit) return first.unit;
  const rec = await readConfirmRecord(supabase, confirmId);
  if (!rec) throw new SalesWorkError('not_found', MSG_NOT_FOUND);
  const { lines } = buildSlotLines(slotItems(rec.confirm), []);
  const hit = findSlotLine(lines, slotKey, unitNo);
  if (!hit) throw new SalesWorkError('slot_not_found', MSG_SLOT_GONE);
  const created = await insertUnit(
    supabase,
    {
      confirm_id: confirmId,
      slot_key: slotKey,
      unit_no: unitNo,
      item_snapshot: itemSnapshot(hit.line.item),
      updated_by: cleanActor(actor),
    },
    first.schemaReady,
  );
  if (created) return created;
  // 그 사이 누가 만듦 — 다시 읽음
  const again = await readUnitRow(supabase, confirmId, { slotKey, unitNo });
  if (again.unit) return again.unit;
  throw new SalesWorkError('conflict', MSG_CONFLICT);
}

/**
 * ④ 한 줄 + 지금 품목에서의 종류·영업 품목. 칸이 "영업에서 빠진 칸"이면 kind 는 slot_key 의 품목구분으로, item 은 item_snapshot(없으면 null).
 * 확인서·행이 없으면 null.
 */
export async function readUnit(
  confirmId: string,
  unitId: string,
): Promise<{ unit: SalesUnitRow; kind: ItemKind; item: SalesConfirmItem | null } | null> {
  if (!confirmId || !isUuid(unitId)) return null;
  const supabase = createAdminClient();
  const [{ unit }, rec] = await Promise.all([readUnitRow(supabase, confirmId, { id: unitId }), readConfirmRecord(supabase, confirmId)]);
  if (!unit || !rec) return null;
  const { lines } = buildSlotLines(slotItems(rec.confirm), [unit]);
  const hit = findSlotLine(lines, unit.slotKey, unit.unitNo);
  if (hit) return { unit, kind: hit.line.kind, item: hit.line.item };
  return { unit, kind: kindOfSlotKey(unit.slotKey), item: unit.itemSnapshot };
}

/**
 * ④ extra 에 소프트웨어 대장 기록(ledgerPushed)·설치 PC·사용자를 **합쳐** 씀 — 넘긴 칸(undefined 아닌 것)만 바꾸고 나머지는 그대로.
 * 키 같은 다른 칸은 버림(parseExtra — pc·user·ledgerPushed 만). 그 사이 다른 저장이 있으면 다시 읽어 2번까지.
 * 블록 A 전이면 SalesWorkError('need_sql'), 행이 없으면 'not_found'.
 * ④ updated_at 이 바뀜 → 돌려주는 새 줄로 화면의 unit.updatedAt 을 갱신해야 다음 칸 저장에서 가짜 충돌이 안 남
 * (types.ts 주석은 Promise<void> — 돌려주는 값을 안 써도 됨).
 */
export async function updateUnitExtra(unitId: string, extra: SalesUnitExtra, actor: string): Promise<SalesUnitRow> {
  if (!isUuid(unitId)) throw new SalesWorkError('not_found', MSG_SLOT_GONE);
  const supabase = createAdminClient();
  const incoming = parseExtra(extra);
  const has = (k: keyof SalesUnitExtra) => extra != null && Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.from(SALES_CONFIRM_UNITS_TABLE).select(unitCols(true)).eq('id', unitId).maybeSingle();
    if (error) {
      if (isMissingSalesColumn(error)) throw new SalesWorkError('need_sql', MSG_NEED_SQL);
      throw error;
    }
    if (!data) throw new SalesWorkError('not_found', MSG_SLOT_GONE);
    const cur = unitRowFromDb(data as unknown as Json);
    const next: SalesUnitExtra = { ...cur.extra };
    for (const k of ['pc', 'user', 'ledgerPushed'] as const) {
      if (!has(k)) continue;
      if (incoming[k] === undefined) delete next[k];
      else (next as Record<string, unknown>)[k] = incoming[k];
    }
    const updated = await updateUnitIf(supabase, cur, { extra: next, updated_by: cleanActor(actor) }, true);
    if (updated) return updated;
  }
  throw new SalesWorkError('conflict', MSG_CONFLICT);
}

// ───────────────────────── 상세 읽기 ─────────────────────────

export interface SalesAssetUse {
  confirmId: string;
  docNo: string;
  company: string;
  deliveryDate: string | null;
  status: SalesConfirmStatus;
}

/**
 * types.ts SalesConfirmDetailData 에 아직 없는 칸(팀장에게 types.ts 로 옮길지 보고함 — 화면이 안 써도 됨).
 * openSalesConfirm 은 SalesConfirmDetailData & SalesDetailExtras 를 돌려줌(구조상 SalesConfirmDetailData 로도 읽힘).
 */
export interface SalesDetailExtras {
  /** 진행 "자산 n/m"(m = 장비·모니터·유지보수 칸) */
  progress: { filled: number; total: number };
  /** 이 확인서 칸의 자산번호가 다른 확인서 칸에도 있음(취소 건 뺌) — 자산번호 → 그 확인서들 */
  assetElsewhere: Record<string, SalesAssetUse[]>;
  /** 곁가지 읽기 실패(처리자 명단·체크리스트·출고 준비 후보·같은 자산번호) — 쉬운 말, 화면에 주황 한 줄로 */
  notices: string[];
}

export type SalesDetailLoadResult =
  | { ok: true; data: SalesConfirmDetailData & SalesDetailExtras }
  | { ok: false; notFound?: true; error: string };

/** 다른 확인서에 같은 자산번호(취소 건 뺌, 자산번호마다 최대 5건) */
export async function findAssetElsewhere(supabase: Supa, confirmId: string, assetIds: string[]): Promise<Record<string, SalesAssetUse[]>> {
  const ids = [...new Set(assetIds.map((a) => a.trim().toUpperCase()).filter(Boolean))];
  if (!ids.length) return {};
  const uses: { confirm_id: string; asset_id: string }[] = [];
  for (const part of chunks(ids, CHUNK)) {
    const rows = await readAllPages<{ confirm_id: string; asset_id: string }>((from, to) =>
      supabase
        .from(SALES_CONFIRM_UNITS_TABLE)
        .select('confirm_id,asset_id')
        .in('asset_id', part)
        .neq('confirm_id', confirmId)
        .order('id')
        .range(from, to),
    );
    uses.push(...rows);
  }
  if (!uses.length) return {};
  const otherIds = [...new Set(uses.map((u) => u.confirm_id))];
  const info = new Map<string, { docNo: string; company: string; deliveryDate: string | null }>();
  const status = new Map<string, string>();
  for (const part of chunks(otherIds, CHUNK)) {
    const [c, w] = await Promise.all([
      supabase.from(SALES_CONFIRMS_TABLE).select('id,doc_no,company,delivery_date').in('id', part),
      supabase.from(SALES_CONFIRM_WORK_TABLE).select('confirm_id,status').in('confirm_id', part),
    ]);
    if (c.error) throw c.error;
    if (w.error) throw w.error;
    for (const r of (c.data ?? []) as { id: string; doc_no: string | null; company: string | null; delivery_date: string | null }[]) {
      info.set(r.id, { docNo: r.doc_no ?? '', company: r.company ?? '', deliveryDate: r.delivery_date });
    }
    for (const r of (w.data ?? []) as { confirm_id: string; status: string | null }[]) status.set(r.confirm_id, r.status ?? '');
  }
  const out: Record<string, SalesAssetUse[]> = {};
  for (const u of uses) {
    const st = status.get(u.confirm_id);
    const s: SalesConfirmStatus = isSalesConfirmStatus(st) ? st : '접수';
    if (s === '취소') continue;
    const i = info.get(u.confirm_id);
    if (!i) continue;
    const key = u.asset_id.trim().toUpperCase();
    const list = (out[key] ??= []);
    if (list.length >= 5 || list.some((x) => x.confirmId === u.confirm_id)) continue;
    list.push({ confirmId: u.confirm_id, docNo: i.docNo, company: i.company, deliveryDate: i.deliveryDate, status: s });
  }
  return out;
}

/** 출고 준비 상태 한 줄 — "홍길동 준비완료 · 김철수 준비중" / "준비 전" */
function prepStateText(checks: PrepChecks | null | undefined): string {
  const parts: string[] = [];
  for (const [person, e] of Object.entries(checks ?? {})) {
    if (isPrepDone(e)) parts.push(`${person} 준비완료`);
    else if (isPrepInProgress(e)) parts.push(`${person} 준비중`);
    else if (isPrepOverhaul(e)) parts.push(`${person} 오버홀`);
  }
  return parts.join(' · ') || '준비 전';
}

/** 같은 건으로 보이는 출고 준비 일정(읽기만) — 납품일 ±3일 IT 일정 중 prepMatch 규칙(상호·구분·지역), 최대 5건 */
async function loadPrepHints(supabase: Supa, confirm: NormalizedSalesConfirm, region: string): Promise<SalesConfirmDetailData['prepHints']> {
  const d = confirm.deliveryDate;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return [];
  const { data, error } = await supabase
    .from(CALENDAR_TABLE)
    .select('id,date,time,title')
    .gte('date', shiftYmd(d, -3))
    .lte('date', shiftYmd(d, 3))
    .order('date')
    .limit(1000);
  if (error) throw error;
  const candidates: PrepEventCandidate[] = ((data ?? []) as { id: string; date: string; time: string | null; title: string | null }[])
    .filter((e) => isItPrepTarget(e.title ?? '', ''))
    .map((e) => {
      const title = e.title ?? '';
      return { id: e.id, date: e.date, time: e.time ?? '', title, company: parseEventTitle(title).company || guessCompany(title) };
    });
  const matches = matchPrepEvents(
    { company: confirm.company, deliveryDate: d, type: confirm.type, region: region || null },
    candidates,
  ).slice(0, 5);
  if (!matches.length) return [];
  const ids = matches.map((m) => m.event.id);
  const [ev, rep] = await Promise.all([
    supabase.from(PREP_EVENTS_TABLE).select('event_id,prep_checks').in('event_id', ids),
    supabase.from(PREP_REPORTS_TABLE).select('event_id,sent_at').in('event_id', ids),
  ]);
  if (ev.error) throw ev.error;
  if (rep.error) throw rep.error;
  const checks = new Map(((ev.data ?? []) as { event_id: string; prep_checks: PrepChecks | null }[]).map((r) => [r.event_id, r.prep_checks]));
  const sent = new Map(((rep.data ?? []) as { event_id: string; sent_at: string | null }[]).map((r) => [r.event_id, !!r.sent_at]));
  return matches.map((m) => ({
    eventId: m.event.id,
    date: m.event.date,
    title: m.event.title,
    prepState: prepStateText(checks.get(m.event.id)),
    reportSent: sent.get(m.event.id) ?? false,
  }));
}

/** 마지막 확인 판(② seen_ver·seen_hash) ↔ 지금 — 쉬운 말 목록(diff.ts). 판을 못 찾으면 [] */
async function loadSalesChanges(
  supabase: Supa,
  confirmId: string,
  seenVer: number,
  seenHash: string,
  current: NormalizedSalesConfirm,
): Promise<string[]> {
  const { data, error } = await supabase
    .from(SALES_CONFIRM_VERSIONS_TABLE)
    .select('ver,payload_hash,payload,fetched_at')
    .eq('confirm_id', confirmId)
    .eq('ver', seenVer)
    .order('fetched_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const rows = (data ?? []) as { ver: number; payload_hash: string | null; payload: unknown }[];
  const base = rows.find((r) => seenHash && r.payload_hash === seenHash) ?? rows[0];
  if (!base) return [];
  const prev = normalizeSalesConfirm(base.payload);
  return prev.ok ? salesChangeLines(prev.value, current) : [];
}

async function readPeople(supabase: Supa): Promise<string[]> {
  const { data, error } = await supabase.from(PREP_PEOPLE_TABLE).select('name').eq('is_active', true).order('sort_order').order('name');
  if (error) throw error;
  return ((data ?? []) as { name: string }[]).map((p) => p.name).filter(Boolean);
}

async function readChecklist(supabase: Supa): Promise<{ label: string; grp: string }[]> {
  const withGrp = await supabase.from(PHOTO_ITEMS_TABLE).select('label,grp').order('sort_order').order('created_at');
  if (!withGrp.error) {
    return ((withGrp.data ?? []) as { label: string; grp: string | null }[]).map((i) => ({ label: i.label, grp: i.grp || '기타' }));
  }
  // shipment_prep_checklist.sql 전이면 grp 칸이 없음 — 묶음 없이(전부 '기타')
  const plain = await supabase.from(PHOTO_ITEMS_TABLE).select('label').order('sort_order').order('created_at');
  if (plain.error) throw plain.error;
  return ((plain.data ?? []) as { label: string }[]).map((i) => ({ label: i.label, grp: '기타' }));
}

/**
 * 상세 읽기(openSalesConfirm). seen_ver 가 비었으면 지금 판으로(1단계 미리보기와 같은 규칙).
 * ③ first_opened_at 은 actor(이름)가 있을 때만 지금·actor 로 채움 — 서버 화면은 이름을 몰라 '' 로 먼저 열고,
 * 화면이 이름을 안 뒤(first_opened_at 이 비어 있으면) 한 번 더 부름. first_opened_at 은 있는데 이름이 비었으면 이름만 채움.
 * 곁가지(명단·체크리스트·출고 준비 후보·같은 자산번호) 실패는 notices 로 — 화면 전체는 열림.
 * 표가 없는 오류 등은 던짐(부르는 쪽이 isMissingSalesTable 로 나눔).
 */
export async function loadSalesConfirmDetail(id: string, actorRaw: string): Promise<SalesDetailLoadResult> {
  const actor = cleanActor(actorRaw);
  const supabase = createAdminClient();
  const rec = await readConfirmRecord(supabase, id);
  if (!rec) return { ok: false, notFound: true, error: '확인서를 못 찾았어요 — 영업에서 지웠거나 주소가 틀렸을 수 있어요.' };
  const { row: c, confirm, ver, payloadHash: hash } = rec;

  // 따로 보는 종류(판매·철수·이전): 기기 칸·출고 준비 후보·체크리스트·처리자 명단을 안 만듦(영업 값 보기만)
  const other = isOtherSalesType(confirm.type);
  const notices: string[] = [];
  const soft = async <T,>(p: Promise<T>, fallback: T, where: string, notice: string): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      logSalesFail(where, err);
      notices.push(notice);
      return fallback;
    }
  };

  const [unitsRes, workRes, versionsRes, people, checklist] = await Promise.all([
    other ? Promise.resolve({ units: [] as SalesUnitRow[], schemaReady: true }) : readUnitsFor(supabase, id),
    readWorkRow(supabase, id),
    supabase.from(SALES_CONFIRM_VERSIONS_TABLE).select('id', { count: 'exact', head: true }).eq('confirm_id', id),
    other ? Promise.resolve([] as string[]) : soft(readPeople(supabase), [] as string[], '처리자 명단 읽기', '처리자 명단을 못 읽었어요 — 이름은 직접 적어 주세요.'),
    other ? Promise.resolve([] as { label: string; grp: string }[]) : soft(readChecklist(supabase), [] as { label: string; grp: string }[], '체크리스트 읽기', '출고 체크리스트 항목을 못 읽었어요 — 잠시 뒤 새로고침해 주세요.'),
  ]);
  // count head 는 오류 본문이 비어 판정에 안 씀 — 못 세면 0
  const versionCount = versionsRes.error ? 0 : (versionsRes.count ?? 0);

  // ③ 처음 열람·확인한 판 채우기 — 실패해도 상세는 보여 줌(서버 로그에 code).
  // 이름(actor)이 없으면(서버 화면이 먼저 열 때) "처음 열람"은 안 찍고 확인한 판(seen_ver)만 — 화면이 이름을 안 뒤 다시 불러 이름과 같이 찍음.
  let work = workRes.row;
  const now = new Date().toISOString();
  const cols = workCols(workRes.printedReady);
  try {
    if (!work) {
      const ins: Json = { confirm_id: id, seen_ver: ver, seen_hash: hash, updated_by: actor };
      if (actor) {
        ins.first_opened_at = now;
        ins.first_opened_by = actor;
      }
      const { data, error } = await supabase.from(SALES_CONFIRM_WORK_TABLE).insert(ins).select(cols).single();
      if (error && error.code !== '23505') throw error;
      work = error ? (await readWorkRow(supabase, id)).row : (data as unknown as WorkRow);
    } else if ((actor && (!work.first_opened_at || !work.first_opened_by)) || work.seen_ver === null) {
      const patch: Json = { updated_by: actor || work.updated_by || '' };
      if (actor && !work.first_opened_at) {
        patch.first_opened_at = now;
        patch.first_opened_by = actor;
      } else if (actor && !work.first_opened_by) {
        patch.first_opened_by = actor;
      }
      if (work.seen_ver === null) {
        patch.seen_ver = ver;
        patch.seen_hash = hash;
      }
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .update(patch)
        .eq('confirm_id', id)
        .eq('updated_at', work.updated_at)
        .select(cols);
      if (error) throw error;
      if (data && data.length) work = data[0] as unknown as WorkRow; // 0줄 = 그 사이 누가 고침 — 다음에 다시
    }
  } catch (err) {
    logSalesFail('③ 열람 표시', err);
  }

  const items = other ? [] : slotItems(confirm);
  const { lines, orphans } = buildSlotLines(items, unitsRes.units);
  const { region: effRegion, guessed } = regionWithGuess(confirm.region, confirm.address);

  const seenVer = work?.seen_ver ?? null;
  const seenHash = work?.seen_hash ?? '';
  const salesChanged = salesChangedSince(seenVer, ver);

  const assetIds = unitsRes.units.map((u) => u.assetId).filter(Boolean);
  const [prepHints, changes, assetElsewhere] = await Promise.all([
    other ? Promise.resolve([] as SalesConfirmDetailData['prepHints']) : soft(loadPrepHints(supabase, confirm, effRegion), [], '출고 준비 후보 읽기', '같은 건으로 보이는 출고 준비 일정을 못 읽었어요 — 잠시 뒤 새로고침해 주세요.'),
    salesChanged && seenVer !== null
      ? soft(loadSalesChanges(supabase, id, seenVer, seenHash, confirm), [] as string[], '판 비교 읽기', '영업에서 무엇이 바뀌었는지 못 읽었어요 — 영업 원본을 열어 확인해 주세요.')
      : Promise.resolve([] as string[]),
    other
      ? Promise.resolve({} as Record<string, SalesAssetUse[]>)
      : soft(findAssetElsewhere(supabase, id, assetIds), {} as Record<string, SalesAssetUse[]>, '같은 자산번호 읽기', '다른 확인서에 같은 자산번호가 있는지 못 읽었어요.'),
  ]);

  const status: SalesConfirmStatus = work && isSalesConfirmStatus(work.status) ? work.status : '접수';
  return {
    ok: true,
    data: {
      confirm,
      regionGuess: guessed ? effRegion : null,
      lines,
      orphans,
      work: {
        status,
        processors: work?.processors ?? [],
        startedAt: work?.started_at ?? null,
        finishedAt: work?.finished_at ?? null,
        shippedAt: work?.shipped_at ?? null,
        note: work?.note ?? '',
        checks: parseChecks(work?.checks),
        firstOpenedAt: work?.first_opened_at ?? null,
        printedAt: work?.printed_at ?? null,
        printedVer: workRes.printedReady ? (work?.printed_ver ?? null) : null,
        printedBy: workRes.printedReady ? (work?.printed_by ?? '') : '',
        updatedAt: work?.updated_at ?? null,
      },
      salesChanged,
      changes,
      payloadHash: hash,
      versionCount,
      docUrl: safeDocUrl(confirm.docUrl),
      firstSeenAt: asStr(c.first_seen_at),
      changedAt: asStr(c.changed_at) || null,
      fetchedAt: asStr(c.fetched_at),
      people,
      checklist,
      prepHints,
      schemaReady: unitsRes.schemaReady && workRes.printedReady,
      progress: slotProgress(lines),
      assetElsewhere,
      notices,
      ...detailDeliveryMode(confirm, c.payload, other),
    },
  };
}

/** 4-0: 직송 판정 — formDoc(정규화된 doc)으로, 없으면(옛 원문) payload 맨 위 칸으로. 따로 보는 종류는 직송 아님 */
function detailDeliveryMode(confirm: NormalizedSalesConfirm, payload: unknown, other: boolean): { directShip: boolean; consignName: string } {
  if (other) return { directShip: false, consignName: '' };
  const fromDoc = deliveryModeFromPayload({ doc: confirm.formDoc });
  if (fromDoc.consignName) return fromDoc;
  return deliveryModeFromPayload(payload);
}
