'use server';

/**
 * 영업 확인서 ↔ 출고 준비 일정 연결 액션(4-1 — developer B). 설계 docs/tasks/2026-11-27-sales-confirm-prep-merge.md F2·F4·F8 · §4-A·§4-C.
 * 시그니처는 lib/salesConfirms/types.ts 맨 아래 4-1 절 주석 그대로. 판정·읽기·쓰기는 전부 lib/salesConfirms/prepLink.ts 가 하고
 * 여기는 입력 검사 + 오류를 쉬운 말로 바꾸기만.
 *   - 읽기(get·list)는 아무것도 안 씀(F4 — 화면 열기만으로는 안 씀).
 *   - 쓰기는 ③ it_sales_confirm_work 의 prep_event_id · link_source · updated_by 뿐(writeConfirmLink — 동시 수정 검사 그대로).
 *   - 네이버·카톡·시트·it_prep_* 표엔 안 씀.
 *   - 로그는 code 만(Supabase details 에 행 값이 들어감), payload·연락처는 응답에 없음(prepLink 가 만든 모양 그대로).
 * 'use server' 파일이라 async 함수만 export — 상수·타입은 lib/salesConfirms/ 에.
 *
 * 4-2(맨 아래 — developer C): getConfirmPrepReport(읽기만) · importReportUnitsToConfirm(④ 자산번호·시리얼만 씀 — 보고·③·카톡·시트 안 씀).
 */
import { getPrepEventRow, type PrepEventRow } from '@/app/shipment-prep/actions';
import {
  MAX_CONFIRM_BADGES,
  MAX_EVENT_BADGES,
  MSG_LINK_CONFIRM_GONE,
  MSG_LINK_EVENT_GONE,
  MSG_LINK_FAIL,
  MSG_LINK_NO_TABLE,
  linkedReportSource,
  readAssetBriefs,
  readConfirmPrepBadges,
  readEventConfirmBadges,
  readPrepLinkForConfirm,
  writeConfirmLink,
} from '@/lib/salesConfirms/prepLink';
import { isMissingSalesTable } from '@/lib/salesConfirms/listQuery';
import { droppedReportUnits, planReportUnitMove, reportUnitKey } from '@/lib/salesConfirms/prepLinkRules';
import { buildSlotLines, itemSnapshot, slotItems } from '@/lib/salesConfirms/slots';
import {
  SalesWorkError,
  cleanActor,
  insertUnit,
  logSalesFail,
  readConfirmRecord,
  readUnitsFor,
  updateUnitIf,
} from '@/lib/salesConfirms/work';
import {
  isOtherSalesType,
  type LinkedReportSource,
  type PrepConfirmBadge,
  type PrepLinkReadResult,
  type PrepLinkSaveResult,
  type PrepLinkState,
  type ReportUnitsImportResult,
  type SalesUnitRow,
} from '@/lib/salesConfirms/types';
import type { PrepUnit } from '@/lib/shipmentPrep';
import { createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { sheetFailReason } from '@/lib/syncFailure';

const NOT_CONFIGURED = 'Supabase 설정이 필요해요.';
const MSG_READ_FAIL = '출고 준비 연결을 읽지 못했어요 — 잠시 뒤 다시 해 주세요.';
const MSG_BADGE_FAIL = '확인서 정보를 못 읽었어요 — 잠시 뒤 다시 해 주세요.';
const MSG_BAD_INPUT = '요청 값이 올바르지 않아요 — 새로고침한 뒤 다시 해 주세요.';
/** 목록·일정 id 를 한 번에 이보다 많이 보내면 거절(정상 화면은 MAX 안 — 서버 액션은 누구나 부를 수 있으므로) */
const MAX_INPUT_IDS = 2000;

// ───────────────────────── 입력 검사 ─────────────────────────

/** 영업 확인서 id — 형식을 몰라서(16자 글자 실측) 길이만(salesDetailActions 와 같은 규칙) */
const isConfirmId = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
const isEventId = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
/** 화면이 본 ③ updated_at — DB 문자열 그대로(null = ③ 줄이 없었음). 길이만 막음 */
const isExpected = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 64);
const isActor = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;

/** 배열에서 쓸 수 있는 id 만, 겹침 없이, 최대 max 개. 배열이 아니거나 너무 길면 null */
function cleanIds(v: unknown, ok: (x: unknown) => x is string, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_INPUT_IDS) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (!ok(x)) continue;
    const id = x.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function readFail<T>(where: string, err: unknown, msg: string): PrepLinkReadResult<T> {
  if (isMissingSalesTable(err)) return { ok: false, missingTable: true, error: MSG_LINK_NO_TABLE };
  logSalesFail(where, err);
  return { ok: false, error: msg };
}

/** 연결이 바뀐 것만 서버 로그에(감사용 — id·값만, 이름·내용 없음. §4-G "서버 로그로 충분") */
function logLinkChange(confirmId: string, res: PrepLinkSaveResult) {
  if (!res.ok) return;
  console.log('[sales-confirms] 출고 준비 연결', JSON.stringify({ confirmId, eventId: res.prepEventId, source: res.linkSource }));
}

// ───────────────────────── 읽기(쓰기 0) ─────────────────────────

/** 확인서 하나의 연결 상태 + 후보(상세 출고 준비 상자 — 연결·풀기 뒤 다시 그리기용). 후보의 준비 기록·완료 보고까지 */
export async function getConfirmPrepLink(input: { confirmId: string }): Promise<PrepLinkReadResult<PrepLinkState>> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    const state = await readPrepLinkForConfirm(input.confirmId.trim(), { withRecords: true });
    if (!state) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
    return { ok: true, data: state };
  } catch (err) {
    return readFail('출고 준비 연결 읽기', err, MSG_READ_FAIL);
  }
}

/**
 * 목록 보이는 줄의 출고 준비 칸(확인서 id → 상태). 없는 id 는 빠짐, 최대 MAX_CONFIRM_BADGES(500).
 * 목록 60초 가져오기 고리에 넣지 말 것 — 목록 열 때·5분마다(§9-11).
 */
export async function listConfirmPrepBadges(input: { confirmIds: string[] }): Promise<PrepLinkReadResult<Record<string, PrepLinkState>>> {
  const ids = cleanIds(input?.confirmIds, isConfirmId, MAX_CONFIRM_BADGES);
  if (!ids) return { ok: false, error: MSG_BAD_INPUT };
  if (!ids.length) return { ok: true, data: {} };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    return { ok: true, data: await readConfirmPrepBadges(ids) };
  } catch (err) {
    return readFail('출고 준비 칸 읽기', err, MSG_BADGE_FAIL);
  }
}

/**
 * 출고 준비 리스트에 보이는 일정의 확인서 배지(일정 id → 배지). 없는 일정 id 는 빠짐, 최대 MAX_EVENT_BADGES(300).
 * listPrepEvents 모양은 안 바꿈(H14 — 홈도 씀). 확인서 표가 없으면 missingTable → 화면은 배지 없이 그대로(§4-G).
 */
export async function listEventConfirmBadges(input: { eventIds: string[] }): Promise<PrepLinkReadResult<Record<string, PrepConfirmBadge>>> {
  const ids = cleanIds(input?.eventIds, isEventId, MAX_EVENT_BADGES);
  if (!ids) return { ok: false, error: MSG_BAD_INPUT };
  if (!ids.length) return { ok: true, data: {} };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    return { ok: true, data: await readEventConfirmBadges(ids) };
  } catch (err) {
    return readFail('출고 준비 배지 읽기', err, MSG_BADGE_FAIL);
  }
}

// ───────────────────────── 쓰기(③ prep_event_id · link_source 만) ─────────────────────────

/** [연결]·[바꾸기]·자동 짝 [이걸로 확정] — 'manual'. expectedUpdatedAt = 화면이 본 ③ updated_at(③ 줄이 없었으면 null) */
export async function linkConfirmPrepEvent(input: {
  confirmId: string;
  eventId: string;
  expectedUpdatedAt: string | null;
  actor: string;
}): Promise<PrepLinkSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isEventId(input?.eventId)) return { ok: false, error: MSG_LINK_EVENT_GONE };
  if (!isExpected(input?.expectedUpdatedAt) || !isActor(input?.actor)) return { ok: false, error: MSG_BAD_INPUT };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const confirmId = input.confirmId.trim();
  try {
    const res = await writeConfirmLink({
      confirmId,
      eventId: input.eventId.trim().toLowerCase(),
      source: 'manual',
      expectedUpdatedAt: input.expectedUpdatedAt,
      actor: input.actor,
    });
    logLinkChange(confirmId, res);
    return res;
  } catch (err) {
    // writeConfirmLink 는 던지지 않게 만들어져 있지만, 혹시 던지면 저장 안 된 것으로
    logSalesFail('출고 준비 연결', err);
    return { ok: false, error: MSG_LINK_FAIL };
  }
}

/** [풀기]·[출고 일정 없음으로 두기] — prep_event_id null + 'none'(자동 연결·"일정 없음" 알림 끔) */
export async function unlinkConfirmPrepEvent(input: {
  confirmId: string;
  expectedUpdatedAt: string | null;
  actor: string;
}): Promise<PrepLinkSaveResult> {
  return writeEmpty(input, 'none', '출고 준비 연결 풀기');
}

/** 'none' 되돌리기 = 다시 자동으로 찾기 — prep_event_id null + '' */
export async function resetConfirmPrepLink(input: {
  confirmId: string;
  expectedUpdatedAt: string | null;
  actor: string;
}): Promise<PrepLinkSaveResult> {
  return writeEmpty(input, '', '출고 준비 연결 되돌리기');
}

async function writeEmpty(
  input: { confirmId: string; expectedUpdatedAt: string | null; actor: string },
  source: 'none' | '',
  where: string,
): Promise<PrepLinkSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isExpected(input?.expectedUpdatedAt) || !isActor(input?.actor)) return { ok: false, error: MSG_BAD_INPUT };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const confirmId = input.confirmId.trim();
  try {
    const res = await writeConfirmLink({ confirmId, eventId: null, source, expectedUpdatedAt: input.expectedUpdatedAt, actor: input.actor });
    logLinkChange(confirmId, res);
    return res;
  } catch (err) {
    logSalesFail(where, err);
    return { ok: false, error: MSG_LINK_FAIL };
  }
}

// ───────────────────────── 4-2 완료 보고(§4-D · F12 · F13) ─────────────────────────
// 시그니처는 lib/salesConfirms/types.ts 맨 아래 4-2 절 주석 그대로. 보고(it_prep_reports)·카톡·시트엔 안 씀 —
// 보고 기기는 완료 보고 창의 저장(app/shipment-prep/reportActions.ts)이 확인서에서 다시 만듦.

const MSG_REPORT_READ_FAIL = '완료 보고 상태를 못 읽었어요 — 잠시 뒤 다시 해 주세요.';
const MSG_MOVE_FAIL = '보고 기기를 확인서로 옮기지 못했어요 — 잠시 뒤 다시 해 주세요.';
const MSG_MOVE_NOT_LINKED = '이 확인서는 그 출고 일정과 연결돼 있지 않아요 — 새로고침한 뒤 다시 해 주세요.';
const MSG_MOVE_OTHER = '철수·이전·판매 확인서는 기기 칸이 없어요 — 완료 보고 창에서 직접 적어 주세요.';
/** 자산번호: 대문자·공백 없음, 시리얼: 앞뒤 공백 — 확인서 칸 저장(salesDetailActions)과 같은 규칙 */
const assetText = (v: unknown) => String(v ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 60);
const serialText = (v: unknown) => String(v ?? '').trim().slice(0, 100);

/**
 * 확인서 상세 출고 준비 상자의 완료 보고 상태 — 창 열기용 일정 줄(보냄·사진 n장·재고 문제 n대) + 보고 기기 출처(보고 뒤 바뀜·보고에만 있는 기기).
 * 읽기만. IT재고 색인은 안 읽음(상자 요약 — linked.units 의 구분·사양은 비어 있을 수 있음).
 */
export async function getConfirmPrepReport(input: {
  confirmId: string;
  eventId: string;
}): Promise<PrepLinkReadResult<{ event: PrepEventRow; linked: LinkedReportSource; role: 'source' | 'excluded' | 'notLinked' }>> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isEventId(input?.eventId)) return { ok: false, error: MSG_LINK_EVENT_GONE };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const confirmId = input.confirmId.trim();
  const eventId = input.eventId.trim().toLowerCase();
  try {
    const [row, linked] = await Promise.all([getPrepEventRow(eventId), linkedReportSource(eventId, { withBriefs: false })]);
    if (!row.ok) return { ok: false, error: row.error };
    const role = linked.confirms.some((c) => c.confirmId === confirmId)
      ? 'source'
      : linked.excluded.some((c) => c.confirmId === confirmId)
        ? 'excluded'
        : 'notLinked';
    return { ok: true, data: { event: row.event, linked, role } };
  } catch (err) {
    return readFail('완료 보고 상태 읽기', err, MSG_REPORT_READ_FAIL);
  }
}

/**
 * F12 [확인서 빈 칸으로 옮기기] — 보고 기기 중 확인서에 없는 것을 IT재고 품목으로 같은 종류 빈 칸에(자산번호·시리얼만).
 * 이 확인서가 그 일정에 연결(저장·자동)돼 있을 때만. ④ 만 씀(칸마다 updated_at 조건부 — 그 사이 누가 고치면 거기서 멈춤),
 * 보고·③·카톡·시트엔 안 씀. 제조사·모델·사양은 안 옮김(차이 확인 창 D27 을 건너뛰지 않게 — 상세에서 IT재고로 채움).
 */
export async function importReportUnitsToConfirm(input: {
  confirmId: string;
  eventId: string;
  actor: string;
}): Promise<ReportUnitsImportResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isEventId(input?.eventId)) return { ok: false, error: MSG_LINK_EVENT_GONE };
  if (!isActor(input?.actor)) return { ok: false, error: MSG_BAD_INPUT };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const confirmId = input.confirmId.trim();
  const eventId = input.eventId.trim().toLowerCase();
  const actor = cleanActor(input.actor);
  try {
    const supabase = createAdminClient();
    // 1) 보고 기기 + 연결 확인(후보만인 확인서로는 안 옮김)
    const { data: rep, error: repError } = await supabase.from('it_prep_reports').select('units,sent_at').eq('event_id', eventId).maybeSingle();
    if (repError) throw repError;
    const report = (rep as { units: PrepUnit[] | null; sent_at: string | null } | null) ?? null;
    const linked = await linkedReportSource(eventId, { supabase, report });
    if (![...linked.confirms, ...linked.excluded].some((c) => c.confirmId === confirmId)) return { ok: false, error: MSG_MOVE_NOT_LINKED };
    const reportUnits = Array.isArray(report?.units) ? report!.units! : [];

    // 2) 확인서 칸(상세와 같은 계산)
    const rec = await readConfirmRecord(supabase, confirmId);
    if (!rec) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
    if (isOtherSalesType(rec.confirm.type)) return { ok: false, error: MSG_MOVE_OTHER };
    const { units, schemaReady } = await readUnitsFor(supabase, confirmId);
    const { lines, orphans } = buildSlotLines(slotItems(rec.confirm), units);

    // 3) 확인서에 없는 보고 기기 → IT재고 품목(색인 한 번)
    const inConfirm: PrepUnit[] = units.map((u) => ({ assetId: u.assetId, serial: u.serial, grade: '' }));
    const missing = new Set(droppedReportUnits(reportUnits, inConfirm).map((u) => reportUnitKey(u)));
    if (!missing.size) return { ok: true, moved: [], left: [], changed: false };
    const wanted = reportUnits
      .filter((u) => missing.has(reportUnitKey(u)) && (u.assetId ?? '').trim())
      .map((u) => ({ assetId: u.assetId, hint: `${u.category ?? ''} ${u.gubun ?? ''} ${u.model ?? ''}` }));
    const { briefs, error: invError } = await readAssetBriefs(wanted);
    if (invError) {
      logSalesFail('IT재고 색인 읽기(보고 기기 옮기기)', invError);
      return { ok: false, error: `IT재고를 못 읽어서(${sheetFailReason(invError)}) 어느 칸으로 갈지 못 정했어요 — 잠시 뒤 다시 해 주세요.` };
    }
    const categories: Record<string, string> = {};
    for (const [id, b] of Object.entries(briefs)) categories[id] = b.category;
    const plan = planReportUnitMove({
      lines,
      orphans,
      reportUnits: reportUnits.map((u) => ({ ...u, assetId: assetText(u.assetId), serial: serialText(u.serial) })),
      categories,
    });

    // 4) 쓰기 — 칸마다 조건부(④ updated_at 그대로 / 줄이 없으면 새로). 0줄·같은 칸이 생김 = 그 사이 누가 고침 → 거기서 멈춤
    const unitById = new Map(units.map((u) => [u.id, u] as const));
    const moved: Extract<ReportUnitsImportResult, { ok: true }>['moved'] = [];
    const left: Extract<ReportUnitsImportResult, { ok: true }>['left'] = [...plan.left];
    let stopped = false;
    for (const m of plan.moves) {
      if (stopped) {
        left.push({ assetId: m.assetId, serial: m.serial, reason: 'conflict' });
        continue;
      }
      const line = lines.find((l) => l.itemIndex === m.itemIndex);
      const cur = m.unitId ? unitById.get(m.unitId) : undefined;
      let saved: SalesUnitRow | null = null;
      if (cur) {
        saved = await updateUnitIf(supabase, cur, { asset_id: m.assetId, serial: m.serial, updated_by: actor }, schemaReady);
      } else if (line) {
        saved = await insertUnit(
          supabase,
          {
            confirm_id: confirmId,
            slot_key: m.slotKey,
            unit_no: m.unitNo,
            item_snapshot: itemSnapshot(line.item),
            asset_id: m.assetId,
            serial: m.serial,
            updated_by: actor,
          },
          schemaReady,
        );
      }
      if (!saved) {
        stopped = true;
        left.push({ assetId: m.assetId, serial: m.serial, reason: 'conflict' });
        continue;
      }
      moved.push({ assetId: m.assetId, serial: m.serial, slotKey: m.slotKey, unitNo: m.unitNo });
    }
    if (moved.length) console.log('[sales-confirms] 보고 기기 → 확인서', JSON.stringify({ confirmId, eventId, moved: moved.length }));
    return { ok: true, moved, left, changed: moved.length > 0 };
  } catch (err) {
    if (err instanceof SalesWorkError) return { ok: false, error: err.message };
    if (isMissingSalesTable(err)) return { ok: false, error: MSG_LINK_NO_TABLE };
    logSalesFail('보고 기기 옮기기', err);
    return { ok: false, error: MSG_MOVE_FAIL };
  }
}
