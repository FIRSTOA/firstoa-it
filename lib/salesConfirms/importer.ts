import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminClient, SALES_CONFIRMS_TABLE, SALES_CONFIRM_VERSIONS_TABLE, SALES_IMPORT_STATE_TABLE } from '@/lib/supabase/server';
import { describeShape, extractRecords, normalizeSalesConfirm, repairPatch, stableStringify, type StoredCompareRow } from './normalize';
import { fetchSalesConfirmOne, fetchSalesConfirms, SALES_ID_PATTERN } from './source';
import {
  importStateFromRow,
  SALES_STATE_DELETED,
  type NormalizedSalesConfirm,
  type SalesImportCounts,
  type SalesImportErrorCode,
  type SalesImportRouteResult,
  type SalesImportState,
  type SalesImportStateRow,
  type SalesImportTrigger,
} from './types';

// D3: 이 파일은 ①②(영업 원본)와 ⑤(상태)만 읽고 씀. IT 값 표(③④)는 import 도 하지 않음.

const STATE_ID = 'main';
// E2: 평소엔 어제부터(영업 since = 저장·지운 날짜 기준 — 어제 이후 고치거나 만들거나 지운 건은 빠짐없이 옴), 그날 첫 번만 90일
const NORMAL_DAYS = 1;
const DEEP_DAYS = 90;
const MAX_PICK_DAYS = 365;
// 목록 화면이 60초마다 부름 → 겹침 막기를 딱 60초로 두면 도착 시각 흔들림으로 두 번에 한 번 건너뜀(실제 2분 간격) — 55초
const CLAIM_GAP_MS = 55_000;
const CLAIM_GAP_FORCE_MS = 10_000;
const CLAIM_GAP_ONE_MS = 3_000;
// ⑤ 의 'one'(한 건 받기 간격)·'html'(양식 중계 간격) 줄 — 'main'(목록 상태 띠)과 섞이지 않게, 상태를 읽는 곳은 늘 'main' 만
export type ClaimRowId = 'one' | 'html';
const CHUNK = 200;
// 원문(payload)을 싣는 묶음은 작게(요청 크기·시간 제한)
const PAYLOAD_CHUNK = 50;

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** 표가 아직 없는지 — 좁게(42P01/PGRST205 또는 "does not exist" 류 문구). 권한 오류는 "없음"으로 안 봄 */
function isMissingTable(error: DbError): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const m = error.message ?? '';
  return /relation .* does not exist|could not find the table/i.test(m);
}

function kstDate(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const f = fromYmd.split('-').map(Number);
  const t = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86_400_000);
}

function validSince(s: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  const diff = daysBetween(s, today);
  return diff >= 0 && diff <= MAX_PICK_DAYS;
}

function dbMessage(error: DbError): string {
  return `저장 중 문제가 생겼어요${error?.code ? `(오류 ${error.code})` : ''} — 잠시 뒤 다시 해 보세요`;
}

export async function readSalesImportState(): Promise<SalesImportState | null> {
  try {
    const sb = createAdminClient();
    const { data, error } = await sb.from(SALES_IMPORT_STATE_TABLE).select('*').eq('id', STATE_ID).maybeSingle();
    if (error) return null;
    return importStateFromRow(data as SalesImportStateRow | null);
  } catch {
    return null;
  }
}

function result(
  partial: Partial<SalesImportRouteResult> & Pick<SalesImportRouteResult, 'ok'>,
  state: SalesImportState | null,
): SalesImportRouteResult {
  return { skippedRecent: false, changed: 0, errorCode: null, error: '', state, ...partial };
}

interface Prepared {
  n: NormalizedSalesConfirm;
  raw: unknown;
  hash: string;
}

function salesColumns(p: Prepared) {
  const n = p.n;
  return {
    doc_no: n.docNo,
    ver: n.ver,
    type: n.type,
    term: n.term,
    saved_at: n.savedAt,
    first_saved_at: n.createdAt ?? n.savedAt,
    sales_state: n.salesDeleted ? SALES_STATE_DELETED : '',
    saved_by: n.savedBy,
    sales_rep: n.salesRep,
    company: n.company,
    address: n.address,
    region: n.region,
    delivery_date: n.deliveryDate,
    contacts: n.contacts,
    items: n.items,
    supplies: n.supplies,
    replace_info: n.replaceInfo,
    special: n.special,
    doc_url: n.docUrl,
    payload: p.raw,
    payload_hash: p.hash,
  };
}

type ClaimResult =
  | { kind: 'claimed'; row: SalesImportStateRow }
  | { kind: 'skipped'; row: SalesImportStateRow | null }
  | { kind: 'error'; code: 'no_table' | 'db_error'; error: string };

/** ⑤ 줄을 조건부 update 로 한 명만 잡음(줄이 없으면 만들고 진행). 막히면 skipped — 오류 아님 */
async function claimStateRow(
  sb: ReturnType<typeof createAdminClient>,
  rowId: string,
  gapMs: number,
  nowMs: number,
): Promise<ClaimResult> {
  const nowIso = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - gapMs).toISOString();
  const claim = await sb
    .from(SALES_IMPORT_STATE_TABLE)
    .update({ last_attempt_at: nowIso })
    .eq('id', rowId)
    // 시각 값은 큰따옴표로 감쌈(PostgREST or 문법에서 값 안의 . : 를 안전하게)
    .or(`last_attempt_at.is.null,last_attempt_at.lt."${cutoff}"`)
    .select('*');
  if (claim.error) {
    if (isMissingTable(claim.error)) {
      return { kind: 'error', code: 'no_table', error: '영업 확인서 표가 아직 없어요 — SQL을 먼저 실행해 주세요' };
    }
    console.warn(`[sales-import] 상태 줄 확인 실패(${claim.error.code ?? '?'})`);
    return { kind: 'error', code: 'db_error', error: dbMessage(claim.error) };
  }
  const got = ((claim.data ?? []) as SalesImportStateRow[])[0] ?? null;
  if (got) return { kind: 'claimed', row: got };
  const exist = await sb.from(SALES_IMPORT_STATE_TABLE).select('*').eq('id', rowId).maybeSingle();
  if (exist.error) {
    console.warn(`[sales-import] 상태 줄 읽기 실패(${exist.error.code ?? '?'})`);
    return { kind: 'error', code: 'db_error', error: dbMessage(exist.error) };
  }
  // 방금 누가 받았음 — 오류 아님
  if (exist.data) return { kind: 'skipped', row: exist.data as SalesImportStateRow };
  // SQL 은 했는데 줄이 없음 → 만들고 진행(동시에 만들었으면 ignoreDuplicates 로 한쪽만 잡음)
  const ins = await sb
    .from(SALES_IMPORT_STATE_TABLE)
    .upsert({ id: rowId, last_attempt_at: nowIso }, { onConflict: 'id', ignoreDuplicates: true })
    .select('*');
  if (ins.error) {
    console.warn(`[sales-import] 상태 줄 만들기 실패(${ins.error.code ?? '?'})`);
    return { kind: 'error', code: 'db_error', error: dbMessage(ins.error) };
  }
  const made = ((ins.data ?? []) as SalesImportStateRow[])[0] ?? null;
  return made ? { kind: 'claimed', row: made } : { kind: 'skipped', row: null };
}

/** 양식 중계 라우트가 부르는 간격 막기('html' 줄). claimed = 이번엔 내가 잡음 */
export async function claimImportGap(
  rowId: ClaimRowId,
  gapMs: number,
): Promise<{ ok: true; claimed: boolean } | { ok: false; code: 'no_table' | 'db_error'; error: string }> {
  const r = await claimStateRow(createAdminClient(), rowId, gapMs, Date.now());
  if (r.kind === 'error') return { ok: false, code: r.code, error: r.error };
  return { ok: true, claimed: r.kind === 'claimed' };
}

/** ① 에 있는 확인서의 type(납품·교체·유지보수·소프트웨어) — 없는 id 면 type null. 표 오류는 code */
export async function readSalesConfirmType(
  id: string,
): Promise<{ ok: true; type: string | null } | { ok: false; code: 'no_table' | 'db_error'; error: string }> {
  const { data, error } = await createAdminClient().from(SALES_CONFIRMS_TABLE).select('type').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      return { ok: false, code: 'no_table', error: '영업 확인서 표가 아직 없어요 — SQL을 먼저 실행해 주세요' };
    }
    console.warn(`[sales-import] 종류 읽기 실패(${error.code ?? '?'})`);
    return { ok: false, code: 'db_error', error: dbMessage(error) };
  }
  if (!data) return { ok: true, type: null };
  return { ok: true, type: String((data as { type?: string | null }).type ?? '') };
}

type ApplyFail = { stage: 'read' | 'write'; error: DbError };

/**
 * 받은 건(byId)을 ①② 에 반영(목록·한 건 받기가 같이 씀 — 같은 규칙, ③④ 는 안 건드림).
 *   새 건: ① 먼저(② 가 ① 을 가리킴) → ②
 *   바뀐 건: ② 먼저 → ① — ① 을 바꾼 뒤 ② 가 실패하면 다음 가져오기 때 "같음"이 되어 그 판 원문이 영영 빠지므로.
 *            ② 가 먼저 들어가 있으면 ① 이 실패해도 다음 가져오기 때 다시 "바뀜" → ②(중복 무시) → ① 로 저절로 맞춰짐.
 */
async function applyPrepared(
  sb: ReturnType<typeof createAdminClient>,
  byId: Map<string, Prepared>,
  counts: SalesImportCounts,
  nowIso: string,
  repair = false,
): Promise<ApplyFail | null> {
  // 이미 가진 (id, ver, hash) 읽기
  const ids = [...byId.keys()];
  const have = new Map<string, { ver: number; hash: string; row: StoredCompareRow }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await sb
      .from(SALES_CONFIRMS_TABLE)
      .select(repair ? 'id, ver, payload_hash, first_saved_at, saved_at, sales_state, type, items' : 'id, ver, payload_hash')
      .in('id', ids.slice(i, i + CHUNK));
    if (error) return { stage: 'read', error };
    for (const row of (data ?? []) as unknown as ({ id: string; ver: number; payload_hash: string | null } & StoredCompareRow)[]) {
      have.set(row.id, { ver: Number(row.ver), hash: row.payload_hash ?? '', row });
    }
  }

  // 분류(§3-6 규칙 2~5)
  const toInsert: Prepared[] = [];
  const toUpdate: Prepared[] = [];
  const toRepair: { id: string; patch: Record<string, unknown> }[] = [];
  for (const p of byId.values()) {
    const h = have.get(p.n.id);
    if (!h) toInsert.push(p);
    else if (p.n.ver < h.ver) counts.older += 1;
    else if (p.n.ver > h.ver || p.hash !== h.hash) {
      if (p.n.ver === h.ver) counts.sameVer = (counts.sameVer ?? 0) + 1;
      toUpdate.push(p);
    } else {
      counts.unchanged += 1;
      // E29: hash 가 같아도 옛 규칙으로 저장된 칸(시각 9시간·지움 표시 등)을 지금 normalize 결과로 — ① 만, ② 는 안 씀
      if (repair) {
        const patch = repairPatch(h.row, p.n, SALES_STATE_DELETED);
        if (patch) toRepair.push({ id: p.n.id, patch });
      }
    }
  }

  const versionRow = (p: Prepared) => ({
    confirm_id: p.n.id,
    ver: p.n.ver,
    payload_hash: p.hash,
    payload: p.raw,
    fetched_at: nowIso,
  });
  const upsertVersions = async (list: Prepared[]): Promise<DbError> => {
    for (let i = 0; i < list.length; i += PAYLOAD_CHUNK) {
      const { error } = await sb
        .from(SALES_CONFIRM_VERSIONS_TABLE)
        .upsert(list.slice(i, i + PAYLOAD_CHUNK).map(versionRow), { onConflict: 'confirm_id,ver,payload_hash', ignoreDuplicates: true });
      if (error) return error;
    }
    return null;
  };

  const updVerErr = await upsertVersions(toUpdate);
  if (updVerErr) return { stage: 'write', error: updVerErr };

  for (let i = 0; i < toInsert.length; i += PAYLOAD_CHUNK) {
    const part = toInsert.slice(i, i + PAYLOAD_CHUNK);
    const { error } = await sb.from(SALES_CONFIRMS_TABLE).insert(
      part.map((p) => ({
        id: p.n.id,
        ...salesColumns(p),
        first_seen_at: nowIso,
        changed_at: nowIso,
        fetched_at: nowIso,
      })),
    );
    if (error) return { stage: 'write', error };
    counts.new += part.length;
  }

  for (const p of toUpdate) {
    const { error } = await sb
      .from(SALES_CONFIRMS_TABLE)
      .update({ ...salesColumns(p), changed_at: nowIso, fetched_at: nowIso })
      .eq('id', p.n.id);
    if (error) return { stage: 'write', error };
    counts.updated += 1;
  }

  for (const r of toRepair) {
    const { error } = await sb.from(SALES_CONFIRMS_TABLE).update(r.patch).eq('id', r.id);
    if (error) return { stage: 'write', error };
    counts.repaired = (counts.repaired ?? 0) + 1;
  }

  const insVerErr = await upsertVersions(toInsert);
  if (insVerErr) return { stage: 'write', error: insVerErr };
  return null;
}

/** 한 건 받기(E1) — ① 의 type 으로 영업 `?id=&type=` 한 건을 받아 목록과 같은 규칙으로 ①② 에 반영 */
async function runOne(opts: { id: string; trigger: SalesImportTrigger }): Promise<SalesImportRouteResult> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const none = { ver: null, notFound: false, salesDeleted: false };

  if (!SALES_ID_PATTERN.test(opts.id)) {
    return result({ ok: false, error: '확인서 번호가 올바르지 않아요', one: none }, null);
  }
  const t = await readSalesConfirmType(opts.id);
  if (!t.ok) return result({ ok: false, errorCode: t.code, error: t.error, one: none }, null);
  // ① 에 없는 id — 아무것도 안 씀
  if (t.type === null) return result({ ok: true, one: { ...none, notFound: true } }, await readSalesImportState());

  const sb = createAdminClient();
  const claim = await claimStateRow(sb, 'one', CLAIM_GAP_ONE_MS, nowMs);
  if (claim.kind === 'error') return result({ ok: false, errorCode: claim.code, error: claim.error, one: none }, null);
  if (claim.kind === 'skipped') return result({ ok: true, skippedRecent: true, one: none }, await readSalesImportState());

  const got = await fetchSalesConfirmOne(opts.id, t.type);
  if (!got.ok) {
    if (got.notFound) {
      // 영업이 못 찾음(종류가 바뀜 등) — 아무것도 안 씀
      return result({ ok: true, one: { ...none, notFound: true } }, await readSalesImportState());
    }
    console.warn(`[sales-import] 한 건 받기 실패 ${got.code} (${opts.trigger})`);
    return result({ ok: false, errorCode: got.code, error: got.error, one: none }, await readSalesImportState());
  }

  const prep = normalizeSalesConfirm(got.body);
  if (!prep.ok || prep.value.id !== opts.id) {
    console.warn(`[sales-import] 한 건 모양 다름 이유=${prep.ok ? 'id 다름' : prep.reason}`);
    return result(
      { ok: false, errorCode: 'bad_shape', error: '영업 웹앱이 보낸 모양이 달라요 — 가져오지 않았어요', one: none },
      await readSalesImportState(),
    );
  }
  const p: Prepared = {
    n: prep.value,
    raw: got.body,
    hash: createHash('sha256').update(stableStringify(got.body)).digest('hex'),
  };

  const counts: SalesImportCounts = { received: 1, new: 0, updated: 0, unchanged: 0, older: 0, skipped: 0 };
  const failed = await applyPrepared(sb, new Map([[p.n.id, p]]), counts, nowIso);
  if (failed) {
    console.warn(`[sales-import] 한 건 저장 실패(${failed.error?.code ?? '?'}) ${failed.stage}`);
    const code: SalesImportErrorCode = failed.stage === 'read' && isMissingTable(failed.error) ? 'no_table' : 'db_error';
    return result(
      {
        ok: false,
        errorCode: code,
        error: code === 'no_table' ? '영업 확인서 표가 아직 없어요 — SQL을 먼저 실행해 주세요' : dbMessage(failed.error),
        one: none,
      },
      await readSalesImportState(),
    );
  }
  return result(
    {
      ok: true,
      changed: counts.new + counts.updated,
      one: { ver: p.n.ver, notFound: false, salesDeleted: p.n.salesDeleted === true },
    },
    await readSalesImportState(),
  );
}

function bodyBytes(body: unknown): number | undefined {
  try {
    return JSON.stringify(body).length;
  } catch {
    return undefined;
  }
}

/** since(한국 날짜) 이후 저장된 ① 중 이번에 안 온 것(지움 제외). 실패하면 undefined(로그엔 code 만) */
async function countMissing(
  sb: ReturnType<typeof createAdminClient>,
  since: string,
  receivedIds: Set<string>,
): Promise<number | undefined> {
  const sinceIso = new Date(`${since}T00:00:00+09:00`).toISOString();
  let missing = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from(SALES_CONFIRMS_TABLE)
      .select('id')
      .neq('sales_state', SALES_STATE_DELETED)
      .or(`saved_at.gte."${sinceIso}",first_saved_at.gte."${sinceIso}"`)
      .order('id')
      .range(from, from + 999);
    if (error) {
      console.warn(`[sales-import] 빠진 건 세기 실패(${error.code ?? '?'})`);
      return undefined;
    }
    const rows = (data ?? []) as { id: string }[];
    for (const r of rows) if (!receivedIds.has(r.id)) missing += 1;
    if (rows.length < 1000) break;
  }
  return missing;
}

export async function runSalesConfirmImport(opts: {
  force?: boolean;
  since?: string;
  trigger: SalesImportTrigger;
  /** 결과에 받은 응답의 모양 요약(칸 이름·종류·건수만)을 붙임 — 실측용 */
  diag?: boolean;
  /** 있으면 그 확인서 한 건만 받음(E1) — since·force·diag 는 안 씀 */
  id?: string;
}): Promise<SalesImportRouteResult> {
  if (opts.id !== undefined) return runOne({ id: opts.id, trigger: opts.trigger });
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = kstDate(nowMs);

  if (opts.since !== undefined && !validSince(opts.since, today)) {
    return result(
      { ok: false, error: `날짜를 확인해 주세요 — 오늘부터 ${MAX_PICK_DAYS}일 전까지 고를 수 있어요` },
      null,
    );
  }

  const sb = createAdminClient();

  // 1) 겹침 막기 — ⑤ 'main' 줄을 조건부 update 로 한 명만 잡음
  const claim = await claimStateRow(sb, STATE_ID, opts.force ? CLAIM_GAP_FORCE_MS : CLAIM_GAP_MS, nowMs);
  if (claim.kind === 'error') return result({ ok: false, errorCode: claim.code, error: claim.error }, null);
  if (claim.kind === 'skipped') {
    // 방금 누가 받았음 — 오류 아님
    return result({ ok: true, skippedRecent: true }, importStateFromRow(claim.row));
  }
  const stateRow = claim.row;

  // 2) since(D14, E2) — 그날(한국) 첫 성공 전 = 90일, 그 뒤 = 어제부터
  const lastDeepDate = stateRow.last_deep_at ? kstDate(Date.parse(stateRow.last_deep_at)) : null;
  const autoDeep = opts.since === undefined && lastDeepDate !== today;
  const since = opts.since ?? addDays(today, -(autoDeep ? DEEP_DAYS : NORMAL_DAYS));
  const windowDays = daysBetween(since, today);
  const timeoutMs = opts.since !== undefined || autoDeep ? 15_000 : 8_000;

  const finishError = async (code: SalesImportErrorCode, error: string, counts?: SalesImportCounts) => {
    const upd = await sb
      .from(SALES_IMPORT_STATE_TABLE)
      .update({
        last_window_days: windowDays,
        last_error_code: code,
        last_error: error,
        ...(counts ? { last_counts: counts } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', STATE_ID);
    if (upd.error) console.warn(`[sales-import] 상태 기록 실패(${upd.error.code ?? '?'})`);
    return result({ ok: false, errorCode: code, error, deep: autoDeep }, await readSalesImportState());
  };

  // 3) 받기
  const got = await fetchSalesConfirms(since, timeoutMs);
  if (!got.ok) {
    console.warn(`[sales-import] 받기 실패 ${got.code} (${opts.trigger})`);
    return finishError(got.code, got.error);
  }
  // 모양 요약은 칸 이름·종류·건수만(값 없음) — 모양이 다를 때 이유 문구·⑤ 에 짧게, diag 면 결과에 전부
  const shape = opts.diag ? describeShape(got.body) : undefined;
  const withShape = async (r: Promise<SalesImportRouteResult> | SalesImportRouteResult) => {
    const v = await r;
    return shape ? { ...v, shape } : v;
  };
  const records = extractRecords(got.body);
  if (!records) {
    const brief = describeShape(got.body).slice(0, 300);
    console.warn(`[sales-import] 응답 모양 다름 (${opts.trigger}) ${brief}`);
    return withShape(finishError('bad_shape', `영업 웹앱이 보낸 모양이 달라요 — 하나도 가져오지 않았어요 (받은 모양: ${brief})`));
  }

  // 4) 모양 검사(건마다) — 같은 id 가 둘이면 ver 높은 쪽
  const byId = new Map<string, Prepared>();
  let skipped = 0;
  const reasons = new Map<string, number>(); // 이유(칸 이름만) → 건수
  for (const raw of records) {
    const r = normalizeSalesConfirm(raw);
    if (!r.ok) {
      skipped += 1;
      reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
      console.warn(`[sales-import] 건너뜀 id=${r.id || '(없음)'} 이유=${r.reason}`);
      continue;
    }
    const prev = byId.get(r.value.id);
    if (prev && prev.n.ver > r.value.ver) continue;
    byId.set(r.value.id, { n: r.value, raw, hash: createHash('sha256').update(stableStringify(raw)).digest('hex') });
  }
  const counts: SalesImportCounts = { received: records.length, new: 0, updated: 0, unchanged: 0, older: 0, skipped };

  const reasonText = [...reasons.entries()].map(([why, n]) => `${why} ${n}건`).join(', ');
  if (records.length > 0 && byId.size === 0) {
    return withShape(
      finishError('bad_shape', `영업 웹앱이 보낸 ${records.length}건이 모두 모양이 달라요 — 하나도 가져오지 않았어요 (${reasonText})`, counts),
    );
  }

  // 5~7) 이미 가진 건 읽기 → 분류 → 쓰기(①② 만, 판 원문 먼저 — applyPrepared)
  const failed = await applyPrepared(sb, byId, counts, nowIso, autoDeep || opts.since !== undefined);
  if (failed) {
    if (failed.stage === 'read') {
      if (isMissingTable(failed.error)) return finishError('no_table', '영업 확인서 표가 아직 없어요 — SQL을 먼저 실행해 주세요', counts);
      console.warn(`[sales-import] 기존 건 읽기 실패(${failed.error?.code ?? '?'})`);
      return finishError('db_error', dbMessage(failed.error), counts);
    }
    console.warn(`[sales-import] 저장 실패(${failed.error?.code ?? '?'}) 새 ${counts.new} 바뀜 ${counts.updated}`);
    return finishError('db_error', dbMessage(failed.error), counts);
  }

  // E30: 진단 숫자 — 받은 기간 안인데 이번 응답에 없고 지움도 아닌 건수(읽기 실패해도 가져오기는 성공으로 둠, 숫자만 빠짐)
  counts.missing = await countMissing(sb, since, new Set(byId.keys()));
  counts.bytes = bodyBytes(got.body);
  counts.ms = Date.now() - nowMs;

  // 8) 성공 기록
  const partialBad = skipped > 0;
  const error = partialBad ? `${skipped}건은 모양이 달라 건너뛰었어요 (${reasonText})` : '';
  const done = await sb
    .from(SALES_IMPORT_STATE_TABLE)
    .update({
      last_success_at: new Date().toISOString(),
      ...(autoDeep ? { last_deep_at: nowIso } : {}),
      last_window_days: windowDays,
      last_error_code: partialBad ? 'bad_shape' : null,
      last_error: error,
      last_counts: counts,
      updated_at: new Date().toISOString(),
    })
    .eq('id', STATE_ID);
  if (done.error) console.warn(`[sales-import] 성공 기록 실패(${done.error.code ?? '?'})`);

  return withShape(
    result(
      {
        ok: true,
        changed: counts.new + counts.updated,
        errorCode: partialBad ? 'bad_shape' : null,
        deep: autoDeep,
        error,
      },
      await readSalesImportState(),
    ),
  );
}
