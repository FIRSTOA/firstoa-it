import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminClient, SALES_CONFIRMS_TABLE, SALES_CONFIRM_VERSIONS_TABLE, SALES_IMPORT_STATE_TABLE } from '@/lib/supabase/server';
import { describeShape, extractRecords, normalizeSalesConfirm, stableStringify } from './normalize';
import { fetchSalesConfirms } from './source';
import {
  importStateFromRow,
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
const NORMAL_DAYS = 30;
const DEEP_DAYS = 90;
const MAX_PICK_DAYS = 365;
const CLAIM_GAP_MS = 60_000;
const CLAIM_GAP_FORCE_MS = 10_000;
const CHUNK = 200;

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

export async function runSalesConfirmImport(opts: {
  force?: boolean;
  since?: string;
  trigger: SalesImportTrigger;
  /** 결과에 받은 응답의 모양 요약(칸 이름·종류·건수만)을 붙임 — 실측용 */
  diag?: boolean;
}): Promise<SalesImportRouteResult> {
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
  const gap = opts.force ? CLAIM_GAP_FORCE_MS : CLAIM_GAP_MS;
  const cutoff = new Date(nowMs - gap).toISOString();
  const claim = await sb
    .from(SALES_IMPORT_STATE_TABLE)
    .update({ last_attempt_at: nowIso })
    .eq('id', STATE_ID)
    // 시각 값은 큰따옴표로 감쌈(PostgREST or 문법에서 값 안의 . : 를 안전하게)
    .or(`last_attempt_at.is.null,last_attempt_at.lt."${cutoff}"`)
    .select('*');
  if (claim.error) {
    if (isMissingTable(claim.error)) {
      return result({ ok: false, errorCode: 'no_table', error: '영업 확인서 표가 아직 없어요 — SQL을 먼저 실행해 주세요' }, null);
    }
    console.warn(`[sales-import] 상태 줄 확인 실패(${claim.error.code ?? '?'})`);
    return result({ ok: false, errorCode: 'db_error', error: dbMessage(claim.error) }, null);
  }
  let stateRow = ((claim.data ?? []) as SalesImportStateRow[])[0] ?? null;
  if (!stateRow) {
    const exist = await sb.from(SALES_IMPORT_STATE_TABLE).select('*').eq('id', STATE_ID).maybeSingle();
    if (exist.error) {
      console.warn(`[sales-import] 상태 줄 읽기 실패(${exist.error.code ?? '?'})`);
      return result({ ok: false, errorCode: 'db_error', error: dbMessage(exist.error) }, null);
    }
    if (exist.data) {
      // 방금 누가 받았음 — 오류 아님
      return result({ ok: true, skippedRecent: true }, importStateFromRow(exist.data as SalesImportStateRow));
    }
    // SQL 은 했는데 줄이 없음 → 만들고 진행
    const ins = await sb
      .from(SALES_IMPORT_STATE_TABLE)
      .upsert({ id: STATE_ID, last_attempt_at: nowIso }, { onConflict: 'id', ignoreDuplicates: true })
      .select('*');
    if (ins.error) {
      console.warn(`[sales-import] 상태 줄 만들기 실패(${ins.error.code ?? '?'})`);
      return result({ ok: false, errorCode: 'db_error', error: dbMessage(ins.error) }, null);
    }
    stateRow = ((ins.data ?? []) as SalesImportStateRow[])[0] ?? { ...emptyRow(), last_attempt_at: nowIso };
  }

  // 2) since(D14)
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
    return result({ ok: false, errorCode: code, error }, await readSalesImportState());
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

  // 5) 이미 가진 (id, ver, hash) 읽기
  const ids = [...byId.keys()];
  const have = new Map<string, { ver: number; hash: string }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await sb
      .from(SALES_CONFIRMS_TABLE)
      .select('id, ver, payload_hash')
      .in('id', ids.slice(i, i + CHUNK));
    if (error) {
      if (isMissingTable(error)) return finishError('no_table', '영업 확인서 표가 아직 없어요 — SQL을 먼저 실행해 주세요', counts);
      console.warn(`[sales-import] 기존 건 읽기 실패(${error.code ?? '?'})`);
      return finishError('db_error', dbMessage(error), counts);
    }
    for (const row of (data ?? []) as { id: string; ver: number; payload_hash: string | null }[]) {
      have.set(row.id, { ver: Number(row.ver), hash: row.payload_hash ?? '' });
    }
  }

  // 6) 분류(§3-6 규칙 2~5)
  const toInsert: Prepared[] = [];
  const toUpdate: Prepared[] = [];
  for (const p of byId.values()) {
    const h = have.get(p.n.id);
    if (!h) toInsert.push(p);
    else if (p.n.ver < h.ver) counts.older += 1;
    else if (p.n.ver > h.ver || p.hash !== h.hash) toUpdate.push(p);
    else counts.unchanged += 1;
  }

  // 7) 쓰기
  //   새 건: ① 먼저(② 가 ① 을 가리킴) → ②
  //   바뀐 건: ② 먼저 → ① — ① 을 바꾼 뒤 ② 가 실패하면 다음 가져오기 때 "같음"이 되어 그 판 원문이 영영 빠지므로.
  //            ② 가 먼저 들어가 있으면 ① 이 실패해도 다음 가져오기 때 다시 "바뀜" → ②(중복 무시) → ① 로 저절로 맞춰짐.
  const writeFail = (error: DbError) => {
    console.warn(`[sales-import] 저장 실패(${error?.code ?? '?'}) 새 ${counts.new} 바뀜 ${counts.updated}`);
    return finishError('db_error', dbMessage(error), counts);
  };
  const versionRow = (p: Prepared) => ({
    confirm_id: p.n.id,
    ver: p.n.ver,
    payload_hash: p.hash,
    payload: p.raw,
    fetched_at: nowIso,
  });
  const upsertVersions = async (list: Prepared[]): Promise<DbError> => {
    for (let i = 0; i < list.length; i += CHUNK) {
      const { error } = await sb
        .from(SALES_CONFIRM_VERSIONS_TABLE)
        .upsert(list.slice(i, i + CHUNK).map(versionRow), { onConflict: 'confirm_id,ver,payload_hash', ignoreDuplicates: true });
      if (error) return error;
    }
    return null;
  };

  const updVerErr = await upsertVersions(toUpdate);
  if (updVerErr) return writeFail(updVerErr);

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const part = toInsert.slice(i, i + CHUNK);
    const { error } = await sb.from(SALES_CONFIRMS_TABLE).insert(
      part.map((p) => ({
        id: p.n.id,
        ...salesColumns(p),
        first_saved_at: p.n.savedAt,
        first_seen_at: nowIso,
        changed_at: nowIso,
        fetched_at: nowIso,
      })),
    );
    if (error) return writeFail(error);
    counts.new += part.length;
  }

  for (const p of toUpdate) {
    const { error } = await sb
      .from(SALES_CONFIRMS_TABLE)
      .update({ ...salesColumns(p), changed_at: nowIso, fetched_at: nowIso })
      .eq('id', p.n.id);
    if (error) return writeFail(error);
    counts.updated += 1;
  }

  const insVerErr = await upsertVersions(toInsert);
  if (insVerErr) return writeFail(insVerErr);

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
        error,
      },
      await readSalesImportState(),
    ),
  );
}

function emptyRow(): SalesImportStateRow {
  return {
    id: STATE_ID,
    last_attempt_at: null,
    last_success_at: null,
    last_deep_at: null,
    last_window_days: null,
    last_error_code: null,
    last_error: null,
    last_counts: null,
  };
}
