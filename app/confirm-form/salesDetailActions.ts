'use server';

/**
 * 영업 확인서 상세 화면 액션(2+3단계 — developer C). 설계 docs/tasks/2026-11-26-sales-confirm-import.md §3-4 · §3-10 · §4-2.
 * 쓰는 곳: ③ it_sales_confirm_work · ④ it_sales_confirm_units 뿐. ①② 영업 원본·출고 준비 표·캘린더·IT재고는 읽기만.
 * 시트·네이버·카톡·영업 쪽 쓰기 없음. 라이선스 키는 여기서 절대 다루지 않음(salesLicenseActions — developer E).
 *
 * 차이 확인(D27 → 2026-11-27 사용자 결정으로 바뀜): **저장은 막지 않음** — 영업 요청과 다른 칸은 그대로 저장하고 화면·목록에 노랗게
 *   ("요청과 다름" = slots.unackedDiffs). 확인은 출력 창 [인쇄](IT 기재) 때 한 번에(ackDiffsForPrint) 또는 칸의 [확인](ackUnitDiffs).
 *   확인 기록 diff_ack 는 그대로: {field, sales, actual} 이 지금 계산과(앞뒤 공백 빼고) 같은 확인만 인정, at·by 는 서버가 채움,
 *   차이가 없어진 칸의 기록은 지움, (영업, 출고) 쌍이 바뀌면 다시 "요청과 다름". 확인 액션은 서버가 다시 읽어 계산한 차이가
 *   acks 에 다 있어야만 씀(아니면 needAck — 그 사이 값이 바뀜).
 * `＋ 줄 추가`(addSalesUnit)·`✕ 줄 빼기`(removeAddedSalesUnit): 납품 확인서의 장비·모니터·기타 줄만(slots.addLineAllowed),
 *   ④ extra.added 표시 행. 칸 계산은 ④ 를 붙여서 해야 추가 줄이 보임(currentLines).
 * 동시 수정: updated_at(DB 문자열 그대로) 비교. 체크(checks)만 바꾸는 저장은 서버가 그 항목만 합쳐 충돌 없이 다시 시도.
 * 'use server' 파일이라 async 함수만 export — 상수·타입은 lib/salesConfirms/ 에.
 */
import { lookupUnitByAsset } from '@/app/shipment-prep/reportActions';
import { ITEM_KIND_RULES, checkGroupFor, type ItemKind } from '@/lib/salesConfirms/itemKind';
import { isMissingSalesColumn, isMissingSalesTable } from '@/lib/salesConfirms/listQuery';
import { hasSpec, specKeys } from '@/lib/salesConfirms/salesForm/confirm';
import { SPEC_TEXT_MAX, specTextAllowed } from '@/lib/salesConfirms/specLine';
import {
  ADDED_LINE_MAX,
  addLineAllowed,
  addedSlotCount,
  buildSlotLines,
  findSlotLine,
  isAcked,
  isDiffField,
  itemSnapshot,
  kindOfSlotKey,
  nextAddedUnitNo,
  parseSpec,
  slotItems,
  unitDiffs,
  unitHasContent,
} from '@/lib/salesConfirms/slots';
import {
  isSalesConfirmStatus,
  type DiffAckMap,
  type DiffItem,
  type SalesSpec,
  type SalesSpecKey,
  type SalesUnitExtra,
  type SalesUnitRow,
  type SalesUnitSaveResult,
  type SalesWorkSaveResult,
} from '@/lib/salesConfirms/types';
import {
  MSG_CONFLICT,
  MSG_NEED_SQL,
  MSG_NOT_FOUND,
  SalesWorkError,
  cleanActor,
  findAssetElsewhere,
  insertUnit,
  isUuid,
  loadSalesConfirmDetail,
  logSalesFail,
  readConfirmRecord,
  readUnitRow,
  readUnitsFor,
  readWorkRow,
  updateUnitIf,
  type SalesAssetUse,
  type SalesDetailLoadResult,
  type Supa,
  type WorkRow,
} from '@/lib/salesConfirms/work';
import { SALES_CONFIRMS_TABLE, SALES_CONFIRM_UNITS_TABLE, SALES_CONFIRM_WORK_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';

type Json = Record<string, unknown>;

const NOT_CONFIGURED = 'Supabase 설정이 필요해요.';
const GENERIC = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.';
const NO_TABLE = '영업 확인서 표가 아직 없어요 — supabase/sales_confirms_schema.sql 을 실행해 주세요.';
const MSG_NEED_ACK = '영업 요청과 다른 칸이 있어요 — 한 번 더 확인해 주세요.';
const MSG_NEED_ACK_PRINT = '그 사이 영업 요청과 다른 칸이 바뀌었어요 — 새로 읽은 뒤 다시 확인해 주세요.';
const MSG_NEED_NAME = '이름을 먼저 적어 주세요 — 누가 확인했는지 남겨요.';
const MSG_ORPHAN = '이 칸은 영업에서 빠졌어요 — 아래 "영업에서 빠진 칸"에서 다른 칸으로 옮긴 뒤 고쳐 주세요.';

// ───────────────────────── 입력 정리 ─────────────────────────

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const isConfirmId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
/** 자산번호·설치 PC: 대문자, 공백 없음(대장 규칙과 같음) */
const assetText = (v: unknown) => String(v ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 60);
const own = (o: object | null | undefined, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k) && (o as Json)[k] !== undefined;

function cleanAcks(v: unknown): DiffItem[] {
  const out: DiffItem[] = [];
  for (const a of Array.isArray(v) ? v.slice(0, 60) : []) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Json;
    if (!isDiffField(o.field)) continue;
    const sales = text(o.sales, 500);
    const actual = text(o.actual, 500);
    if (sales && actual) out.push({ field: o.field, sales, actual });
  }
  return out;
}

function cleanCheckOps(v: unknown): { label: string; on: boolean }[] {
  const out: { label: string; on: boolean }[] = [];
  for (const c of Array.isArray(v) ? v.slice(0, 100) : []) {
    if (!c || typeof c !== 'object') continue;
    const label = text((c as Json).label, 200);
    if (label) out.push({ label, on: (c as Json).on === true });
  }
  return out;
}

function mergeChecks(
  cur: Record<string, { at: string; by: string }>,
  ops: { label: string; on: boolean }[],
  actor: string,
  now: string,
): Record<string, { at: string; by: string }> {
  const next = { ...cur };
  for (const op of ops) {
    if (op.on) {
      if (!next[op.label]) next[op.label] = { at: now, by: actor };
    } else delete next[op.label];
  }
  return next;
}

/** 화면이 보낸 확인이 지금 계산한 차이와 같은지(앞뒤 공백만 빼고 글자 그대로) */
const ackMatches = (a: DiffItem, d: DiffItem) => a.field === d.field && a.sales === d.sales && a.actual === d.actual;

/** 새 diff_ack — 지금 차이인 칸만 남김(없어진 칸은 지움). 이번에 확인한 칸은 새 기록, 아니면 기존 기록 그대로 */
function nextDiffAck(stored: DiffAckMap, diffs: DiffItem[], acks: DiffItem[], actor: string, now: string): DiffAckMap {
  const out: DiffAckMap = {};
  for (const d of diffs) {
    if (acks.some((a) => ackMatches(a, d))) out[d.field] = { sales: d.sales, actual: d.actual, at: now, by: actor };
    else if (stored[d.field]) out[d.field] = stored[d.field];
  }
  return out;
}

function dedupeDiffs(list: DiffItem[]): DiffItem[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const k = `${d.field}\u0000${d.sales}\u0000${d.actual}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 이 종류·품목에서 받는 칸(itemKind 규칙 + 사양은 hasSpec 품목의 specKeys 만) */
function allowedFields(kind: ItemKind, cat: string) {
  const f = ITEM_KIND_RULES[kind].fields;
  const specOk = f.includes('spec') && hasSpec(cat);
  return {
    maker: f.includes('maker'),
    model: f.includes('model'),
    asset: f.includes('asset'),
    serial: f.includes('serial'),
    specKeys: specOk ? (specKeys(cat) as readonly string[]) : ([] as readonly string[]),
    pc: f.includes('pc'),
    user: f.includes('user'),
    /** 표의 '사양' 칸 글자(extra.specText — specLine.ts) — 장비·모니터·기타 */
    specText: specTextAllowed(kind),
    checks: checkGroupFor(kind, cat) !== null,
  };
}

// ───────────────────────── 결과 도우미 ─────────────────────────

function unitFail(where: string, err: unknown): SalesUnitSaveResult {
  logSalesFail(where, err);
  if (err instanceof SalesWorkError) {
    if (err.code === 'need_sql') return { ok: false, needSql: true, error: err.message };
    if (err.code === 'conflict') return { ok: false, conflict: true, error: err.message };
    return { ok: false, error: err.message };
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === '23505') return { ok: false, conflict: true, error: MSG_CONFLICT };
  if (isMissingSalesColumn(err)) return { ok: false, needSql: true, error: MSG_NEED_SQL };
  if (isMissingSalesTable(err)) return { ok: false, error: NO_TABLE };
  return { ok: false, error: GENERIC };
}

function workFail(where: string, err: unknown): SalesWorkSaveResult {
  logSalesFail(where, err);
  if (err instanceof SalesWorkError) {
    return err.code === 'conflict' ? { ok: false, conflict: true, error: err.message } : { ok: false, error: err.message };
  }
  if (isMissingSalesTable(err)) return { ok: false, error: NO_TABLE };
  return { ok: false, error: GENERIC };
}

const needSql = (): SalesUnitSaveResult => ({ ok: false, needSql: true, error: MSG_NEED_SQL });
const conflict = (): SalesUnitSaveResult => ({ ok: false, conflict: true, error: MSG_CONFLICT });

/**
 * 지금 영업 품목으로 칸 계산 — 칸이 있는지·종류·품목(+ 지금 ④ 를 붙인 값). ④ 를 같이 읽어야 `＋ 줄 추가`한 칸(extra.added)도 칸으로 잡힘
 * (예전엔 ④ 없이 계산해 영업 수량 칸만 있었음). ① 과 ④ 는 동시에 읽음.
 */
async function currentLines(supabase: Supa, confirmId: string) {
  const [rec, read] = await Promise.all([readConfirmRecord(supabase, confirmId), readUnitsFor(supabase, confirmId)]);
  if (!rec) throw new SalesWorkError('not_found', MSG_NOT_FOUND);
  return buildSlotLines(slotItems(rec.confirm), read.units).lines;
}

// ───────────────────────── 상세 열기 ─────────────────────────

/**
 * 상세 읽기 — 저장된 payload 를 지금 normalize 로 다시 읽고 칸 계산·③④·체크리스트·처리자·출고 준비 후보.
 * 처음 열람·seen_ver 채우기는 1단계 미리보기와 같은 규칙(actor 가 비면 이름 없이 열람 표시, 나중에 이름이 오면 채움).
 * 결과 data 는 SalesConfirmDetailData + 더 있는 칸(work.ts SalesDetailExtras — progress·salesChanges·assetElsewhere·notices).
 */
export async function openSalesConfirm(input: { id: string; actor: string }): Promise<SalesDetailLoadResult> {
  if (!isConfirmId(input?.id)) return { ok: false, notFound: true, error: '확인서를 못 찾았어요 — 주소를 확인해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    return await loadSalesConfirmDetail(input.id, input.actor);
  } catch (err) {
    logSalesFail('상세 읽기', err);
    if (isMissingSalesTable(err)) return { ok: false, error: NO_TABLE };
    return { ok: false, error: '확인서를 열지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

// ───────────────────────── 기기 칸 저장 ─────────────────────────

type UnitValues = {
  asset_id: string;
  serial: string;
  actual_maker: string;
  actual_model: string;
  spec_override: SalesSpec;
  note: string;
  extra: SalesUnitExtra;
  checks: Record<string, { at: string; by: string }>;
};

type UnitPatchInput = {
  assetId?: string;
  serial?: string;
  actualMaker?: string;
  actualModel?: string;
  specOverride?: SalesSpec;
  note?: string;
  extra?: SalesUnitExtra;
  checks?: { label: string; on: boolean }[];
};

/** 지금 값(없으면 빈 칸)에 patch 를 얹음 — 이 종류에서 안 받는 칸은 버림, specOverride 는 칸 전체 교체 */
function applyUnitPatch(cur: SalesUnitRow | null, patch: UnitPatchInput, kind: ItemKind, cat: string, actor: string, now: string): UnitValues {
  const allow = allowedFields(kind, cat);
  const v: UnitValues = {
    asset_id: cur?.assetId ?? '',
    serial: cur?.serial ?? '',
    actual_maker: cur?.actualMaker ?? '',
    actual_model: cur?.actualModel ?? '',
    spec_override: { ...(cur?.specOverride ?? {}) },
    note: cur?.note ?? '',
    extra: { ...(cur?.extra ?? {}) },
    checks: { ...(cur?.checks ?? {}) },
  };
  if (allow.asset && own(patch, 'assetId')) v.asset_id = assetText(patch.assetId);
  if (allow.serial && own(patch, 'serial')) v.serial = text(patch.serial, 100);
  if (allow.maker && own(patch, 'actualMaker')) v.actual_maker = text(patch.actualMaker, 100);
  if (allow.model && own(patch, 'actualModel')) v.actual_model = text(patch.actualModel, 200);
  if (own(patch, 'specOverride')) {
    const spec = parseSpec(patch.specOverride);
    const next: SalesSpec = {};
    for (const k of allow.specKeys) if (spec[k as SalesSpecKey]) next[k as SalesSpecKey] = spec[k as SalesSpecKey];
    v.spec_override = next;
    // 칸별 값이 생기면 '사양' 칸 글자(specText)는 지움 — 글자는 칸별 값이 없을 때만 씀(specLine.ts)
    if (Object.keys(next).length) delete v.extra.specText;
  }
  if (own(patch, 'note')) v.note = text(patch.note, 2000);
  // extra: 설치 PC·사용자·'사양' 칸 글자만(ledgerPushed 는 대장 쪽이 씀 — 지금 값 유지, 키 같은 다른 칸은 버림)
  const ex = patch.extra && typeof patch.extra === 'object' ? patch.extra : null;
  if (allow.specText && own(ex, 'specText')) {
    // 표의 '사양' 칸을 칸별로 못 읽은 글(또는 모니터·기타의 사양 글) — 글이 있으면 칸별 값은 비움(출력은 칸별 값이 없을 때 이 글)
    const st = text(ex!.specText, SPEC_TEXT_MAX);
    if (st) {
      v.extra.specText = st;
      v.spec_override = {};
    } else delete v.extra.specText;
  }
  if (allow.pc && own(ex, 'pc')) {
    const pc = assetText(ex!.pc);
    if (pc) v.extra.pc = pc;
    else delete v.extra.pc;
  }
  if (allow.user && own(ex, 'user')) {
    const user = text(ex!.user, 60);
    if (user) v.extra.user = user;
    else delete v.extra.user;
  }
  if (allow.checks && own(patch, 'checks')) v.checks = mergeChecks(v.checks, cleanCheckOps(patch.checks), actor, now);
  return v;
}

/**
 * 기기 칸 하나 저장. unitId 가 null 이면 새 칸(이미 있으면 conflict), 있으면 expectedUpdatedAt 이 같을 때만(체크만 바꾸면 항목만 합침).
 * 영업 요청과 달라도 **막지 않고 저장**(2026-11-27 사용자 결정 — 확인은 인쇄 때 한 번에). acks 를 같이 보내면(지금 화면은 안 보냄) 그 확인도 기록.
 * `＋ 줄 추가`한 칸도 같은 길(currentLines 가 ④ 를 붙여 계산). SQL 블록 A 전 → needSql.
 */
export async function saveSalesUnit(input: {
  confirmId: string;
  slotKey: string;
  unitNo: number;
  unitId: string | null;
  expectedUpdatedAt: string | null;
  patch: UnitPatchInput;
  acks: DiffItem[];
  actor: string;
}): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: '확인서를 정해 주세요.' };
  const slotKey = typeof input.slotKey === 'string' ? input.slotKey : '';
  const unitNo = Math.floor(Number(input.unitNo));
  if (!slotKey || !Number.isFinite(unitNo) || unitNo < 1) return { ok: false, error: '칸을 정해 주세요.' };
  if (input.unitId !== null && input.unitId !== undefined && !isUuid(input.unitId)) return { ok: false, error: '칸을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const patch: UnitPatchInput = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const acks = cleanAcks(input.acks);
  const actor = cleanActor(input.actor);
  if (acks.length && !actor) return { ok: false, error: MSG_NEED_NAME };
  const expected = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt : null;
  const keys = Object.keys(patch).filter((k) => own(patch, k));
  const checksOnly = keys.length > 0 && keys.every((k) => k === 'checks');

  try {
    const supabase = createAdminClient();
    const hit = findSlotLine(await currentLines(supabase, input.confirmId), slotKey, unitNo);
    if (!hit) return { ok: false, error: MSG_ORPHAN };
    const { kind, item } = hit.line;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { unit: cur, schemaReady } = await readUnitRow(
        supabase,
        input.confirmId,
        input.unitId ? { id: input.unitId } : { slotKey, unitNo },
      );
      if (!schemaReady) return needSql();
      if (input.unitId && !cur) return conflict(); // 그 사이 지워짐
      if (cur && (cur.slotKey !== slotKey || cur.unitNo !== unitNo)) return conflict(); // 그 사이 옮겨짐
      if (!checksOnly) {
        if (cur && (expected === null || ms(cur.updatedAt) !== ms(expected))) return conflict();
        if (!cur && expected !== null) return conflict();
      }
      const now = new Date().toISOString();
      const v = applyUnitPatch(cur, patch, kind, item.cat, actor, now);

      // 차이는 막지 않음 — 확인 기록만 지금 차이에 맞춰 정리(없어진 칸 기록은 지움, 확인 안 된 차이는 화면에 노랗게)
      const diffs = unitDiffs(kind, item, { actualMaker: v.actual_maker, actualModel: v.actual_model, specOverride: v.spec_override });
      const stored = cur?.diffAck ?? {};
      const row: Json = { ...v, diff_ack: nextDiffAck(stored, diffs, acks, actor, now), updated_by: actor };

      if (cur) {
        if (!cur.itemSnapshot) row.item_snapshot = itemSnapshot(item);
        const updated = await updateUnitIf(supabase, cur, row, true);
        if (updated) return { ok: true, units: [updated] };
      } else {
        const created = await insertUnit(
          supabase,
          { confirm_id: input.confirmId, slot_key: slotKey, unit_no: unitNo, item_snapshot: itemSnapshot(item), ...row },
          true,
        );
        if (created) return { ok: true, units: [created] };
      }
      if (!checksOnly) return conflict(); // 체크만이면 다시 읽어 항목만 합침
    }
    return conflict();
  } catch (err) {
    return unitFail('기기 칸 저장', err);
  }
}

/**
 * 품목 줄의 모든 칸에 같은 값 — [이 품목 사양 한꺼번에]·[제품명 한꺼번에]. 칸 행이 없으면 만듦.
 * specOverride 는 **합침**(넘긴 칸만 바꿈, 빈 값이면 그 칸을 지움, 안 넘긴 칸은 칸마다 그대로). actualModel·actualMaker 는 넘기면 그 값('' = 지움).
 * `＋ 줄 추가`한 칸도 그 줄 칸이라 같이 바뀜. 영업 요청과 달라도 막지 않음(2026-11-27 — 확인은 인쇄 때 한 번에, acks 가 오면 기록).
 */
export async function applyLineValues(input: {
  confirmId: string;
  itemIndex: number;
  values: { specOverride?: SalesSpec; actualModel?: string; actualMaker?: string };
  acks: DiffItem[];
  actor: string;
}): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: '확인서를 정해 주세요.' };
  const itemIndex = Math.floor(Number(input.itemIndex));
  if (!Number.isFinite(itemIndex) || itemIndex < 0) return { ok: false, error: '품목을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const values = input.values && typeof input.values === 'object' ? input.values : {};
  const acks = cleanAcks(input.acks);
  const actor = cleanActor(input.actor);
  if (acks.length && !actor) return { ok: false, error: MSG_NEED_NAME };

  try {
    const supabase = createAdminClient();
    const line = (await currentLines(supabase, input.confirmId))[itemIndex];
    if (!line) return { ok: false, error: '품목을 찾지 못했어요 — 영업이 품목을 바꿨을 수 있어요. 새로고침해 주세요.' };
    if (!line.slots.length) return { ok: false, error: '이 품목은 수량이 0이라 칸이 없어요.' };
    const allow = allowedFields(line.kind, line.item.cat);
    const specIn = own(values, 'specOverride') && values.specOverride && typeof values.specOverride === 'object' ? (values.specOverride as Json) : null;
    const specOps: [SalesSpecKey, string][] = [];
    if (specIn) for (const k of allow.specKeys) if (own(specIn, k)) specOps.push([k as SalesSpecKey, text(specIn[k], 200)]);
    const setMaker = allow.maker && own(values, 'actualMaker');
    const setModel = allow.model && own(values, 'actualModel');
    if (!specOps.length && !setMaker && !setModel) return { ok: false, error: '바꿀 값이 없어요.' };

    const build = (cur: SalesUnitRow | null) => {
      const spec: SalesSpec = { ...(cur?.specOverride ?? {}) };
      for (const [k, val] of specOps) {
        if (val) spec[k] = val;
        else delete spec[k];
      }
      const out: { actual_maker: string; actual_model: string; spec_override: SalesSpec; extra?: SalesUnitExtra } = {
        actual_maker: setMaker ? text(values.actualMaker, 100) : (cur?.actualMaker ?? ''),
        actual_model: setModel ? text(values.actualModel, 200) : (cur?.actualModel ?? ''),
        spec_override: spec,
      };
      // 칸별 사양을 한꺼번에 넣으면 그 칸의 '사양' 칸 글자(specText)는 지움 — 글자는 칸별 값이 없을 때만 씀(specLine.ts)
      if (specOps.length && cur?.extra?.specText && Object.keys(spec).length) {
        const extra: SalesUnitExtra = { ...cur.extra };
        delete extra.specText;
        out.extra = extra;
      }
      return out;
    };
    const diffsOf = (b: ReturnType<typeof build>) =>
      unitDiffs(line.kind, line.item, { actualMaker: b.actual_maker, actualModel: b.actual_model, specOverride: b.spec_override });

    const read = await readUnitsFor(supabase, input.confirmId);
    if (!read.schemaReady) return needSql();
    const unitAt = (units: SalesUnitRow[], unitNo: number) => units.find((u) => u.slotKey === line.slotKey && u.unitNo === unitNo) ?? null;

    // 칸마다 저장(그 사이 바뀐 칸은 다시 읽어 한 번 더). 차이는 막지 않음 — 확인 기록만 지금 차이에 맞춰 정리
    const saved: SalesUnitRow[] = [];
    for (const s of line.slots) {
      let cur = unitAt(read.units, s.unitNo);
      let done: SalesUnitRow | null = null;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        if (attempt > 0) {
          const again = await readUnitRow(supabase, input.confirmId, { slotKey: line.slotKey, unitNo: s.unitNo });
          cur = again.unit;
        }
        const now = new Date().toISOString();
        const b = build(cur);
        const row: Json = { ...b, diff_ack: nextDiffAck(cur?.diffAck ?? {}, diffsOf(b), acks, actor, now), updated_by: actor };
        if (cur) {
          if (!cur.itemSnapshot) row.item_snapshot = itemSnapshot(line.item);
          done = await updateUnitIf(supabase, cur, row, true);
        } else if (s.added) {
          // 추가한 줄이 그 사이 빠짐 — 표시 없이 다시 만들면 "영업에서 빠진 칸"이 되므로 만들지 않고 건너뜀
          break;
        } else {
          done = await insertUnit(
            supabase,
            { confirm_id: input.confirmId, slot_key: line.slotKey, unit_no: s.unitNo, item_snapshot: itemSnapshot(line.item), ...row },
            true,
          );
        }
      }
      if (!done && s.added && !cur) continue;
      if (!done) return conflict();
      saved.push(done);
    }
    return { ok: true, units: saved };
  } catch (err) {
    return unitFail('줄 한꺼번에 저장', err);
  }
}

/**
 * 칸의 "요청과 다름" [확인] — 값은 안 바꾸고 확인 기록만 새로 + item_snapshot 을 지금 영업 품목으로.
 * acks 는 지금 확인 안 된 차이를 전부 담아야 함(빠진 게 있으면 needAck). 차이가 없으면 acks 빈 배열로 스냅숏만 갱신.
 */
export async function ackUnitDiffs(input: { confirmId: string; unitId: string; acks: DiffItem[]; actor: string }): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId) || !isUuid(input?.unitId)) return { ok: false, error: '칸을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const acks = cleanAcks(input.acks);
  const actor = cleanActor(input.actor);
  if (!actor) return { ok: false, error: MSG_NEED_NAME };
  try {
    const supabase = createAdminClient();
    const lines = await currentLines(supabase, input.confirmId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { unit, schemaReady } = await readUnitRow(supabase, input.confirmId, { id: input.unitId });
      if (!schemaReady) return needSql();
      if (!unit) return { ok: false, error: '칸을 찾지 못했어요 — 새로고침해 주세요.' };
      const hit = findSlotLine(lines, unit.slotKey, unit.unitNo);
      if (!hit) return { ok: false, error: MSG_ORPHAN };
      const now = new Date().toISOString();
      const diffs = unitDiffs(hit.line.kind, hit.line.item, unit);
      const need = diffs.filter((d) => !isAcked(unit.diffAck, d));
      if (need.some((d) => !acks.some((a) => ackMatches(a, d)))) return { ok: false, needAck: need, error: MSG_NEED_ACK };
      const updated = await updateUnitIf(
        supabase,
        unit,
        { diff_ack: nextDiffAck(unit.diffAck, diffs, acks, actor, now), item_snapshot: itemSnapshot(hit.line.item), updated_by: actor },
        true,
      );
      if (updated) return { ok: true, units: [updated] };
    }
    return conflict();
  } catch (err) {
    return unitFail('차이 확인 기록', err);
  }
}

/** 인쇄 확인 한 번에 받는 칸 수(서버 액션 입력 크기) */
const PRINT_ACK_MAX_UNITS = 500;

/**
 * 출력 창 [인쇄](IT 기재 넣음) 전 "영업 요청과 다른 칸 n개" → [맞아요, 인쇄] (2026-11-27 사용자 결정 — 예전 D27 "저장 때 확인 창"을 대신함).
 * 종이에 나가는 칸(영업 수량 칸 + `＋ 줄 추가`한 칸 — 영업에서 빠진 칸은 종이에 안 나가 제외)의 확인 안 된 차이를 한 번에 diff_ack 에 기록.
 *   ① ①④ 를 지금 다시 읽어 칸마다 확인 안 된 차이를 계산 → 화면이 보낸 acks(칸 id 별)에 **전부** 있어야 씀. 하나라도 없으면 아무것도 안 쓰고 needAck
 *      (그 사이 누가 값을 바꿈 → 화면이 새로 읽고 다시 물음).
 *   ② 칸마다 조건부 update(읽은 updated_at 그대로 — 동시 수정 검사). 그 사이 바뀐 칸이 있으면 처음부터 다시(3번까지, 이미 쓴 칸은 차이가 없어져 건너뜀).
 *   item_snapshot 은 안 바꿈("영업 품목이 바뀌었어요"는 따로 [확인함]). 쓴 칸을 돌려줌 — 화면은 이 줄로 updated_at·확인 표시를 맞춤.
 * 차이가 하나도 없으면 아무것도 안 쓰고 ok(units []).
 */
export async function ackDiffsForPrint(input: {
  confirmId: string;
  acks: { unitId: string; diffs: DiffItem[] }[];
  actor: string;
}): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: '확인서를 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const actor = cleanActor(input.actor);
  if (!actor) return { ok: false, error: MSG_NEED_NAME };
  const ackBy = new Map<string, DiffItem[]>();
  for (const g of Array.isArray(input.acks) ? input.acks.slice(0, PRINT_ACK_MAX_UNITS) : []) {
    if (!g || typeof g !== 'object' || !isUuid((g as { unitId?: unknown }).unitId)) continue;
    const id = (g as { unitId: string }).unitId.toLowerCase();
    ackBy.set(id, [...(ackBy.get(id) ?? []), ...cleanAcks((g as { diffs?: unknown }).diffs)]);
  }

  try {
    const supabase = createAdminClient();
    const written = new Map<string, SalesUnitRow>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const [rec, read] = await Promise.all([readConfirmRecord(supabase, input.confirmId), readUnitsFor(supabase, input.confirmId)]);
      if (!rec) return { ok: false, error: MSG_NOT_FOUND };
      if (!read.schemaReady) return needSql();
      const { lines } = buildSlotLines(slotItems(rec.confirm), read.units);

      // ① 지금 확인 안 된 차이가 화면 확인에 다 있는지
      const todo: { line: (typeof lines)[number]; unit: SalesUnitRow; acks: DiffItem[] }[] = [];
      const missing: DiffItem[] = [];
      for (const line of lines) {
        for (const s of line.slots) {
          if (!s.unit || !s.unackedDiffs.length) continue;
          const acks = ackBy.get(s.unit.id.toLowerCase()) ?? [];
          const notCovered = s.unackedDiffs.filter((d) => !acks.some((a) => ackMatches(a, d)));
          if (notCovered.length) missing.push(...notCovered);
          else todo.push({ line, unit: s.unit, acks });
        }
      }
      if (missing.length) return { ok: false, needAck: dedupeDiffs(missing), error: MSG_NEED_ACK_PRINT };

      // ② 칸마다 조건부 기록
      let raced = false;
      for (const t of todo) {
        const now = new Date().toISOString();
        const diffs = unitDiffs(t.line.kind, t.line.item, t.unit);
        const updated = await updateUnitIf(supabase, t.unit, { diff_ack: nextDiffAck(t.unit.diffAck, diffs, t.acks, actor, now), updated_by: actor }, true);
        if (!updated) {
          raced = true;
          break;
        }
        written.set(updated.id, updated);
      }
      if (!raced) return { ok: true, units: [...written.values()] };
    }
    return conflict();
  } catch (err) {
    return unitFail('인쇄 전 차이 확인 기록', err);
  }
}

/**
 * "영업 품목이 바뀌었어요" [확인함] — 그 품목 줄의 칸(행이 있는 것)마다 item_snapshot 을 지금 영업 품목으로. 값·확인 기록은 그대로
 * (출고 값과 새 영업 요청이 다르면 그 칸은 계속 "다시 확인 필요" — ackUnitDiffs 로 따로 확인). 바뀐 칸들을 돌려줌.
 */
export async function ackSnapshot(input: { confirmId: string; itemIndex: number; actor: string }): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: '확인서를 정해 주세요.' };
  const itemIndex = Math.floor(Number(input.itemIndex));
  if (!Number.isFinite(itemIndex) || itemIndex < 0) return { ok: false, error: '품목을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const actor = cleanActor(input.actor);
  try {
    const supabase = createAdminClient();
    const line = (await currentLines(supabase, input.confirmId))[itemIndex];
    if (!line) return { ok: false, error: '품목을 찾지 못했어요 — 영업이 품목을 바꿨을 수 있어요. 새로고침해 주세요.' };
    const snap = itemSnapshot(line.item);
    const read = await readUnitsFor(supabase, input.confirmId);
    const saved: SalesUnitRow[] = [];
    for (const s of line.slots) {
      let cur = read.units.find((u) => u.slotKey === line.slotKey && u.unitNo === s.unitNo) ?? null;
      let done: SalesUnitRow | null = null;
      for (let attempt = 0; attempt < 3 && cur && !done; attempt++) {
        if (attempt > 0) cur = (await readUnitRow(supabase, input.confirmId, { slotKey: line.slotKey, unitNo: s.unitNo })).unit;
        if (!cur) break; // 그 사이 지워짐 — 건너뜀
        done = await updateUnitIf(supabase, cur, { item_snapshot: snap, updated_by: actor }, read.schemaReady);
      }
      if (cur && !done) return conflict();
      if (done) saved.push(done);
    }
    return { ok: true, units: saved };
  } catch (err) {
    return unitFail('영업 품목 확인함', err);
  }
}

/**
 * 영업에서 빠진 칸 → 지금 품목의 빈 칸으로 옮김(④ id 그대로 — 소프트웨어 칸이면 대장 좌석 연결도 그대로).
 * 받는 칸에 IT가 적은 값이 있으면 거절, 아무것도 안 적은 빈 행이면 그 행을 지우고 옮김.
 * 소프트웨어 칸은 소프트웨어 품목으로만(대장 좌석 연결 때문), 다른 종류는 서로 옮길 수 있음.
 * 옮긴 뒤 영업 품목이 스냅숏과 다르면 화면에 "영업 품목이 바뀌었어요"·"다시 확인 필요"로 드러남.
 */
export async function moveOrphanUnit(input: {
  confirmId: string;
  unitId: string;
  toSlotKey: string;
  toUnitNo: number;
  actor: string;
}): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId) || !isUuid(input?.unitId)) return { ok: false, error: '칸을 정해 주세요.' };
  const toSlotKey = typeof input.toSlotKey === 'string' ? input.toSlotKey : '';
  const toUnitNo = Math.floor(Number(input.toUnitNo));
  if (!toSlotKey || !Number.isFinite(toUnitNo) || toUnitNo < 1) return { ok: false, error: '옮길 칸을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const actor = cleanActor(input.actor);
  try {
    const supabase = createAdminClient();
    const lines = await currentLines(supabase, input.confirmId);
    const target = findSlotLine(lines, toSlotKey, toUnitNo);
    if (!target) return { ok: false, error: '옮길 칸을 찾지 못했어요 — 새로고침해 주세요.' };
    const { unit, schemaReady } = await readUnitRow(supabase, input.confirmId, { id: input.unitId });
    if (!unit) return { ok: false, error: '칸을 찾지 못했어요 — 새로고침해 주세요.' };
    if (findSlotLine(lines, unit.slotKey, unit.unitNo)) return { ok: false, error: '이 칸은 영업 품목에 있어요 — 옮길 수 없어요.' };
    const srcSoftware = kindOfSlotKey(unit.slotKey) === 'software' || !!unit.extra.ledgerPushed;
    if (srcSoftware !== (target.line.kind === 'software')) {
      return { ok: false, error: '소프트웨어 칸은 소프트웨어 품목으로만 옮길 수 있어요(대장 좌석 연결 때문).' };
    }
    const occupied = await readUnitRow(supabase, input.confirmId, { slotKey: toSlotKey, unitNo: toUnitNo });
    if (occupied.unit) {
      if (unitHasContent(occupied.unit)) return { ok: false, error: '그 칸에는 이미 적은 값이 있어요 — 빈 칸을 골라 주세요.' };
      // 아무것도 안 적은 빈 행 — 지우고 옮김(그 사이 누가 적었으면 0줄 → 충돌)
      const { data, error } = await supabase
        .from(SALES_CONFIRM_UNITS_TABLE)
        .delete()
        .eq('id', occupied.unit.id)
        .eq('updated_at', occupied.unit.updatedAt)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) return conflict();
    }
    const patch: Json = { slot_key: toSlotKey, unit_no: toUnitNo, updated_by: actor };
    // `＋ 줄 추가`한 칸으로 옮기면 추가 줄 표시도 같이(없으면 영업 수량 밖 번호라 다시 "영업에서 빠진 칸"이 됨)
    if (target.slot.added) {
      if (!schemaReady) return needSql();
      patch.extra = { ...unit.extra, added: true };
    }
    const moved = await updateUnitIf(supabase, unit, patch, schemaReady);
    return moved ? { ok: true, units: [moved] } : conflict();
  } catch (err) {
    return unitFail('빠진 칸 옮기기', err);
  }
}

/** 영업에서 빠진 칸 지우기(④ 만 — 소프트웨어 칸이어도 계약관리 대장 좌석·키는 그대로). 지금 품목에 있는 칸은 거절 */
export async function deleteOrphanUnit(input: { confirmId: string; unitId: string; actor: string }): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId) || !isUuid(input?.unitId)) return { ok: false, error: '칸을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    const supabase = createAdminClient();
    const lines = await currentLines(supabase, input.confirmId);
    const { unit } = await readUnitRow(supabase, input.confirmId, { id: input.unitId });
    if (!unit) return { ok: true, units: [] }; // 이미 지워짐
    if (findSlotLine(lines, unit.slotKey, unit.unitNo)) {
      return { ok: false, error: '영업 품목에 있는 칸은 지울 수 없어요 — 값을 비워 주세요.' };
    }
    const { data, error } = await supabase
      .from(SALES_CONFIRM_UNITS_TABLE)
      .delete()
      .eq('id', unit.id)
      .eq('confirm_id', input.confirmId)
      .eq('updated_at', unit.updatedAt)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return conflict();
    return { ok: true, units: [] };
  } catch (err) {
    return unitFail('빠진 칸 지우기', err);
  }
}

// ───────────────────────── `＋ 줄 추가` · `✕ 줄 빼기` (2026-11-27 사용자 결정) ─────────────────────────

/**
 * 품목 줄에 영업 수량보다 한 대 더 — 그 줄의 다음 번호(nextAddedUnitNo — 영업에서 빠진 칸 번호와도 안 겹침)로 빈 ④ 행,
 * extra = { added: true }, item_snapshot = 지금 영업 품목. 납품 확인서의 장비·모니터·기타 줄만(slots.addLineAllowed — 화면과 같은 판정).
 * 값은 화면의 칸 카드가 평소처럼 저장(saveSalesUnit). 같은 번호가 그 사이 생기면(23505) 다시 읽어 한 번 더. SQL 블록 A 전 → needSql.
 */
export async function addSalesUnit(input: { confirmId: string; itemIndex: number; actor: string }): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: '확인서를 정해 주세요.' };
  const itemIndex = Math.floor(Number(input.itemIndex));
  if (!Number.isFinite(itemIndex) || itemIndex < 0) return { ok: false, error: '품목을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const actor = cleanActor(input.actor);
  if (!actor) return { ok: false, error: MSG_NEED_NAME };
  try {
    const supabase = createAdminClient();
    for (let attempt = 0; attempt < 2; attempt++) {
      const [rec, read] = await Promise.all([readConfirmRecord(supabase, input.confirmId), readUnitsFor(supabase, input.confirmId)]);
      if (!rec) return { ok: false, error: MSG_NOT_FOUND };
      if (!read.schemaReady) return needSql();
      const line = buildSlotLines(slotItems(rec.confirm), read.units).lines[itemIndex];
      if (!line) return { ok: false, error: '품목을 찾지 못했어요 — 영업이 품목을 바꿨을 수 있어요. 새로고침해 주세요.' };
      if (!addLineAllowed(rec.confirm, line.kind)) {
        return { ok: false, error: '이 품목에는 줄을 더할 수 없어요(납품 확인서의 장비·모니터·기타만).' };
      }
      if (addedSlotCount(line) >= ADDED_LINE_MAX) return { ok: false, error: `한 품목에 ${ADDED_LINE_MAX}줄까지만 더할 수 있어요.` };
      const unitNo = nextAddedUnitNo(line, read.units);
      const created = await insertUnit(
        supabase,
        {
          confirm_id: input.confirmId,
          slot_key: line.slotKey,
          unit_no: unitNo,
          item_snapshot: itemSnapshot(line.item),
          extra: { added: true },
          updated_by: actor,
        },
        true,
      );
      if (created) return { ok: true, units: [created] };
      // 그 사이 같은 번호가 생김(다른 창에서 동시에 줄 추가) — 다시 읽어 다음 번호로
    }
    return conflict();
  } catch (err) {
    return unitFail('줄 추가', err);
  }
}

/**
 * `✕ 줄 빼기` — `＋ 줄 추가`한 칸(지금 영업 수량 밖에 붙은 SalesSlot.added)만 ④ 행째 지움. 영업 수량 안 칸·빠진 칸은 거절.
 * expectedUpdatedAt(화면이 본 값)과 같을 때만 — 그 사이 누가 값을 적었으면 conflict(화면이 다시 읽음). 값 있는 줄은 화면이 먼저 확인을 받음.
 */
export async function removeAddedSalesUnit(input: {
  confirmId: string;
  unitId: string;
  expectedUpdatedAt: string;
  actor: string;
}): Promise<SalesUnitSaveResult> {
  if (!isConfirmId(input?.confirmId) || !isUuid(input?.unitId)) return { ok: false, error: '칸을 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const expected = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt : '';
  try {
    const supabase = createAdminClient();
    const lines = await currentLines(supabase, input.confirmId);
    const { unit } = await readUnitRow(supabase, input.confirmId, { id: input.unitId });
    if (!unit) return { ok: true, units: [] }; // 이미 빠짐
    const hit = findSlotLine(lines, unit.slotKey, unit.unitNo);
    if (!hit || !hit.slot.added) return { ok: false, error: '추가한 줄만 뺄 수 있어요 — 영업 수량 안의 칸은 값을 비워 주세요.' };
    if (!expected || ms(unit.updatedAt) !== ms(expected)) return conflict();
    const { data, error } = await supabase
      .from(SALES_CONFIRM_UNITS_TABLE)
      .delete()
      .eq('id', unit.id)
      .eq('confirm_id', input.confirmId)
      .eq('updated_at', unit.updatedAt)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return conflict();
    return { ok: true, units: [] };
  } catch (err) {
    return unitFail('줄 빼기', err);
  }
}

// ───────────────────────── 건 단위(③) ─────────────────────────

/**
 * ③ 처리여부·처리자·시각·비고·건 단위 체크. expectedUpdatedAt 이 null 이면 새 행(이미 있으면 conflict).
 * 상태를 바꿀 때 그 시각 칸이 비어 있고 이번에 시각을 안 넘겼으면 지금으로(준비중 → 시작, 준비완료 → 종료, 출고 → 출고 — 1단계와 같음).
 * 체크만 바꾸면 그 항목만 합쳐 다시 시도(동시 수정에도 안 잃음).
 */
export async function saveSalesWork(input: {
  confirmId: string;
  expectedUpdatedAt: string | null;
  patch: {
    status?: string;
    processors?: string[];
    startedAt?: string | null;
    finishedAt?: string | null;
    shippedAt?: string | null;
    note?: string;
    checks?: { label: string; on: boolean }[];
  };
  actor: string;
}): Promise<SalesWorkSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: '확인서를 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const p = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const actor = cleanActor(input.actor);
  const expected = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt : null;

  const fields: Json = {};
  if (own(p, 'status')) {
    if (!isSalesConfirmStatus(p.status)) return { ok: false, error: '처리여부 값이 올바르지 않아요.' };
    fields.status = p.status;
  }
  if (own(p, 'processors')) {
    const seen = new Set<string>();
    for (const x of Array.isArray(p.processors) ? p.processors : []) {
      const name = text(x, 40);
      if (name) seen.add(name);
    }
    fields.processors = [...seen].slice(0, 5);
  }
  for (const [k, col] of [
    ['startedAt', 'started_at'],
    ['finishedAt', 'finished_at'],
    ['shippedAt', 'shipped_at'],
  ] as const) {
    if (!own(p, k)) continue;
    const raw = p[k];
    if (raw === null || raw === '') fields[col] = null;
    else {
      const t = Date.parse(String(raw));
      if (!Number.isFinite(t)) return { ok: false, error: '시각 값이 올바르지 않아요.' };
      fields[col] = new Date(t).toISOString();
    }
  }
  if (own(p, 'note')) fields.note = text(p.note, 2000);
  const checkOps = own(p, 'checks') ? cleanCheckOps(p.checks) : null;
  if (!Object.keys(fields).length && !checkOps) return { ok: false, error: '바꿀 값이 없어요.' };
  const checksOnly = !Object.keys(fields).length && !!checkOps;

  try {
    const supabase = createAdminClient();
    for (let attempt = 0; attempt < 3; attempt++) {
      const { row } = await readWorkRow(supabase, input.confirmId);
      if (!checksOnly) {
        if (row && (expected === null || ms(row.updated_at) !== ms(expected))) return { ok: false, conflict: true, error: MSG_CONFLICT };
        if (!row && expected !== null) return { ok: false, conflict: true, error: MSG_CONFLICT };
      }
      const now = new Date().toISOString();
      const upd: Json = { ...fields, updated_by: actor };
      if (typeof fields.status === 'string' && fields.status !== row?.status) {
        const auto: Partial<Record<string, keyof WorkRow>> = { 준비중: 'started_at', 준비완료: 'finished_at', 출고: 'shipped_at' };
        const col = auto[fields.status];
        if (col && !own(upd, col) && !row?.[col]) upd[col] = now;
      }
      if (checkOps) {
        const cur = row?.checks && typeof row.checks === 'object' && !Array.isArray(row.checks) ? (row.checks as Record<string, { at: string; by: string }>) : {};
        upd.checks = mergeChecks(cur, checkOps, actor, now);
      }
      if (row) {
        const { data, error } = await supabase
          .from(SALES_CONFIRM_WORK_TABLE)
          .update(upd)
          .eq('confirm_id', input.confirmId)
          .eq('updated_at', row.updated_at)
          .select('updated_at');
        if (error) throw error;
        if (data && data.length) return { ok: true, workUpdatedAt: (data[0] as { updated_at: string }).updated_at };
      } else {
        const { data, error } = await supabase
          .from(SALES_CONFIRM_WORK_TABLE)
          .insert({ confirm_id: input.confirmId, ...upd })
          .select('updated_at')
          .single();
        if (!error) return { ok: true, workUpdatedAt: (data as { updated_at: string }).updated_at };
        if (error.code === '23503') return { ok: false, error: MSG_NOT_FOUND };
        if (error.code !== '23505') throw error;
      }
      if (!checksOnly) return { ok: false, conflict: true, error: MSG_CONFLICT };
    }
    return { ok: false, conflict: true, error: MSG_CONFLICT };
  } catch (err) {
    return workFail('③ 저장', err);
  }
}

// ───────────────────────── 자산번호 조회 ─────────────────────────

/** "삼성 NT550" 에서 앞의 제조사 글자 뗌 */
function stripMaker(model: string, maker: string): string {
  const m = model.trim();
  const b = maker.trim();
  if (!b) return m;
  if (m.toLowerCase().startsWith(b.toLowerCase())) return m.slice(b.length).replace(/^[\s\-/·]+/, '').trim() || m;
  return m;
}

/**
 * 자산번호 → IT재고(없으면 임대리스트)의 제조사·모델명(앞 제조사 뗌)·시리얼 후보·사양 힌트(읽기만 — lookupUnitByAsset 그대로).
 * 채우기는 화면이 빈 칸만(그 저장도 차이 확인 대상).
 * confirmId 를 주면 dupes = 다른 확인서 ④ 에 같은 자산번호(이 확인서 빼고, 취소 건 빼고, 최대 5건 — 못 읽으면 빈 목록, 서버 로그에 code).
 * IT재고에서 못 찾아도 같은 자산번호 경고는 보여야 해서, 못 찾음은 ok:false 지만 dupes 가 있으면 error 문구에 덧붙임.
 */
export async function lookupSalesUnitAsset(input: {
  assetId: string;
  hint?: string;
  confirmId?: string;
}): Promise<
  | {
      ok: true;
      maker: string;
      model: string;
      serials: string[];
      specHint: string;
      dupes: { confirmId: string; docNo: string; company: string }[];
      /** 같은 자산번호 확인을 못 함(채우기는 됨) — 쉬운 말, 없으면 안 옴 */
      dupesError?: string;
    }
  /** 못 찾아도 다른 확인서에 같은 자산번호가 있으면 dupes(화면이 링크로 경고) */
  | { ok: false; error: string; dupes?: { confirmId: string; docNo: string; company: string }[]; dupesError?: string }
> {
  const key = assetText(input?.assetId);
  if (!key) return { ok: false, error: '자산번호를 적어 주세요.' };
  let dupesError = '';
  const dupesP: Promise<SalesAssetUse[]> =
    isConfirmId(input.confirmId) && isSupabaseConfigured()
      ? findAssetElsewhere(createAdminClient(), input.confirmId, [key])
          .then((m) => m[key] ?? [])
          .catch((err) => {
            // 채우기는 그대로 — 같은 자산번호 경고만 못 함을 화면에 알림(서버 로그엔 code)
            logSalesFail('같은 자산번호 읽기', err);
            dupesError = '다른 확인서에 같은 자산번호가 있는지 못 읽었어요.';
            return [];
          })
      : Promise.resolve([]);
  let found: Awaited<ReturnType<typeof lookupUnitByAsset>>;
  try {
    found = await lookupUnitByAsset(key, text(input.hint, 100));
  } catch (err) {
    logSalesFail('자산번호 조회', err);
    return { ok: false, error: 'IT재고를 읽지 못했어요 — 잠시 뒤 다시 해 주세요. 값은 직접 적어도 돼요.' };
  }
  const dupes = (await dupesP).map((d) => ({ confirmId: d.confirmId, docNo: d.docNo, company: d.company }));
  if (!found.source) {
    return {
      ok: false,
      error: 'IT재고·임대리스트에서 이 자산번호를 못 찾았어요 — 직접 적어 주세요.',
      dupes,
      ...(dupesError ? { dupesError } : {}),
    };
  }
  const maker = (found.brand ?? '').trim();
  return {
    ok: true,
    maker,
    model: stripMaker(found.model ?? '', maker),
    serials: (found.serials ?? []).filter(Boolean),
    specHint: (found.spec ?? '').trim(),
    dupes,
    ...(dupesError ? { dupesError } : {}),
  };
}

// ───────────────────────── 출력 기록 ─────────────────────────

/**
 * 출력 창에서 [인쇄]를 누름 → ③ printed_at·printed_ver·printed_by 만(다른 칸을 안 덮으므로 updated_at 검사 없음).
 * ver 는 지금 영업 판보다 클 수 없음. SQL 블록 A 전이면 printed_at 만. 새 updated_at 을 돌려줌(화면 workUpdatedAt 갱신).
 */
export async function markSalesConfirmPrinted(input: { confirmId: string; ver: number; actor: string }): Promise<SalesWorkSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: '확인서를 정해 주세요.' };
  const ver = Math.floor(Number(input.ver));
  if (!Number.isFinite(ver) || ver < 0) return { ok: false, error: '판 값이 올바르지 않아요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const actor = cleanActor(input.actor);
  try {
    const supabase = createAdminClient();
    const { data: c, error: cErr } = await supabase.from(SALES_CONFIRMS_TABLE).select('ver').eq('id', input.confirmId).maybeSingle();
    if (cErr) throw cErr;
    if (!c) return { ok: false, error: MSG_NOT_FOUND };
    const printedVer = Math.min(ver, Number((c as { ver: number | null }).ver) || 0);
    let full = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = new Date().toISOString();
      const patch: Json = full ? { printed_at: now, printed_ver: printedVer, printed_by: actor, updated_by: actor } : { printed_at: now, updated_by: actor };
      const { data: updated, error: uErr } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .update(patch)
        .eq('confirm_id', input.confirmId)
        .select('updated_at');
      if (uErr) {
        if (full && isMissingSalesColumn(uErr)) {
          full = false;
          continue;
        }
        throw uErr;
      }
      if (updated && updated.length) return { ok: true, workUpdatedAt: (updated[0] as { updated_at: string }).updated_at };
      // ③ 행이 없음 → 만듦
      const { data: ins, error: iErr } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .insert({ confirm_id: input.confirmId, ...patch })
        .select('updated_at')
        .single();
      if (!iErr) return { ok: true, workUpdatedAt: (ins as { updated_at: string }).updated_at };
      if (full && isMissingSalesColumn(iErr)) {
        full = false;
        continue;
      }
      if (iErr.code === '23503') return { ok: false, error: MSG_NOT_FOUND };
      if (iErr.code !== '23505') throw iErr; // 그 사이 누가 만듦 → 다시 update
    }
    return { ok: false, conflict: true, error: MSG_CONFLICT };
  } catch (err) {
    return workFail('출력 기록', err);
  }
}
