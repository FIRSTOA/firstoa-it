'use server';

/**
 * 영업 확인서 목록 화면 액션(1단계). ①② 는 읽기만, 쓰기는 ③ it_sales_confirm_work 뿐.
 * ③ 쓰기는 동시 수정 확인: expectedUpdatedAt 이 null 이면 insert(이미 있으면 conflict),
 * 있으면 updated_at 이 같을 때만 update(아니면 conflict). 로그·오류 문구에 영업 원문(payload)·연락처를 안 넣음.
 * 'use server' 파일이라 async 함수만 export — 상수·타입은 lib/salesConfirms/ 에.
 */
import { isMissingSalesTable, loadListRowsByIds, loadSalesConfirmList } from '@/lib/salesConfirms/listQuery';
import { normalizeSalesConfirm } from '@/lib/salesConfirms/normalize';
import { compareConfirmsWithSheet } from '@/lib/salesConfirms/sheetCompare';
import {
  SALES_CONFIRMS_TABLE,
  SALES_CONFIRM_VERSIONS_TABLE,
  SALES_CONFIRM_WORK_TABLE,
  createAdminClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  isSalesConfirmStatus,
  safeDocUrl,
  salesChangedSince,
  type NormalizedSalesConfirm,
  type SalesConfirmItem,
  type SalesConfirmListResult,
  type SalesConfirmPreviewData,
  type SalesConfirmStatus,
  type SalesConfirmSupply,
  type SalesWorkSaveResult,
  type SheetCompareResult,
} from '@/lib/salesConfirms/types';

type Json = Record<string, unknown>;
const NOT_CONFIGURED = 'Supabase 설정이 필요해요.';
const GENERIC = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.';

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const cleanActor = (a: unknown) => String(a ?? '').trim().slice(0, 40);
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

function logFail(where: string, err: unknown) {
  // 코드만 — 메시지에 원문이 섞일 수 있음
  console.warn(`[sales-confirms] ${where} 실패`, (err as { code?: string } | null)?.code ?? 'unknown');
}

// ───────────── ③ 쓰기 공통 ─────────────

type WorkPatch = Record<string, unknown>;

/**
 * ③ 한 줄 저장. current 는 상태 바꿀 때 "비어 있으면 시각 채우기"용으로 읽은 줄.
 * expectedUpdatedAt === null → insert, 아니면 읽은 줄의 updated_at 과 같을 때만 update.
 */
async function saveWork(
  id: string,
  expectedUpdatedAt: string | null,
  actor: string,
  build: (current: { started_at: string | null; finished_at: string | null; shipped_at: string | null } | null) => WorkPatch,
): Promise<SalesWorkSaveResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    if (expectedUpdatedAt === null) {
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .insert({ confirm_id: id, ...build(null), updated_at: now, updated_by: actor })
        .select('updated_at')
        .single();
      if (error) {
        if (error.code === '23505') return { ok: false, conflict: true, error: '다른 사람이 방금 고쳤어요 — 새로 불러올게요.' };
        if (error.code === '23503') return { ok: false, error: '확인서를 못 찾았어요. 목록을 새로고침해 주세요.' };
        throw error;
      }
      return { ok: true, workUpdatedAt: (data as { updated_at: string }).updated_at };
    }
    const { data: cur, error: curErr } = await supabase
      .from(SALES_CONFIRM_WORK_TABLE)
      .select('updated_at,started_at,finished_at,shipped_at')
      .eq('confirm_id', id)
      .maybeSingle();
    if (curErr) throw curErr;
    const row = cur as { updated_at: string; started_at: string | null; finished_at: string | null; shipped_at: string | null } | null;
    if (!row || ms(row.updated_at) !== ms(expectedUpdatedAt)) {
      return { ok: false, conflict: true, error: '다른 사람이 방금 고쳤어요 — 새로 불러올게요.' };
    }
    const { data, error } = await supabase
      .from(SALES_CONFIRM_WORK_TABLE)
      .update({ ...build(row), updated_at: now, updated_by: actor })
      .eq('confirm_id', id)
      .eq('updated_at', row.updated_at) // 읽은 뒤 또 바뀌었으면 0줄
      .select('updated_at');
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, conflict: true, error: '다른 사람이 방금 고쳤어요 — 새로 불러올게요.' };
    return { ok: true, workUpdatedAt: (data[0] as { updated_at: string }).updated_at };
  } catch (err) {
    logFail('③ 저장', err);
    return isMissingSalesTable(err)
      ? { ok: false, error: '영업 확인서 표가 아직 없어요 — 개발 담당에게 알려 주세요.' }
      : { ok: false, error: GENERIC };
  }
}

// ───────────── 액션 ─────────────

/** 가져오기 뒤(changed > 0) 화면이 다시 부름 — loadSalesConfirmList 와 같은 결과 */
export async function listSalesConfirms(): Promise<SalesConfirmListResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  return loadSalesConfirmList();
}

export async function setSalesConfirmStatus(input: {
  id: string;
  status: SalesConfirmStatus;
  actor: string;
  expectedUpdatedAt: string | null;
}): Promise<SalesWorkSaveResult> {
  if (!input?.id) return { ok: false, error: '확인서를 정해 주세요.' };
  if (!isSalesConfirmStatus(input.status)) return { ok: false, error: '처리여부 값이 올바르지 않아요.' };
  const status = input.status;
  const now = new Date().toISOString();
  return saveWork(input.id, input.expectedUpdatedAt, cleanActor(input.actor), (cur) => {
    const patch: WorkPatch = { status };
    // 비어 있을 때만 시각을 채움(덮어쓰지 않음)
    if (status === '준비중' && !cur?.started_at) patch.started_at = now;
    if (status === '준비완료' && !cur?.finished_at) patch.finished_at = now;
    if (status === '출고' && !cur?.shipped_at) patch.shipped_at = now;
    return patch;
  });
}

export async function setSalesConfirmProcessors(input: {
  id: string;
  processors: string[];
  actor: string;
  expectedUpdatedAt: string | null;
}): Promise<SalesWorkSaveResult> {
  if (!input?.id) return { ok: false, error: '확인서를 정해 주세요.' };
  const seen = new Set<string>();
  for (const p of Array.isArray(input.processors) ? input.processors : []) {
    const name = String(p ?? '').trim().slice(0, 40);
    if (name) seen.add(name);
  }
  const processors = [...seen].slice(0, 5);
  return saveWork(input.id, input.expectedUpdatedAt, cleanActor(input.actor), () => ({ processors }));
}

function confirmFromStored(r: Json): NormalizedSalesConfirm {
  const contacts = asObj(r.contacts);
  const items: SalesConfirmItem[] = asArr(r.items).map((x) => {
    const it = asObj(x);
    const spec: Record<string, string> = {};
    for (const [k, v] of Object.entries(asObj(it.spec))) if (asStr(v)) spec[k] = asStr(v);
    const qty = Math.floor(Number(it.qty));
    return {
      cat: asStr(it.cat) || '기타',
      model: asStr(it.model),
      maker: asStr(it.maker),
      state: asStr(it.state),
      qty: Number.isFinite(qty) && qty > 0 ? qty : 0,
      spec,
      place: asStr(it.place),
    };
  });
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
    items,
    supplies,
    replaceInfo: rep ? { before: rep.before ?? null, after: rep.after ?? null } : null,
    docUrl: asStr(r.doc_url),
    inflow: '',
    leaseNo: '',
    reason: '',
  };
}

/**
 * 줄을 누르면 부름 — ① 한 건·② 버전 수·③ 을 돌려줌.
 * 화면 모양은 저장된 원문(payload)을 지금 normalize 로 다시 읽어 만듦(그래야 정규화를 고친 뒤에도 이미 받은 건이 바로 새 칸을 보여 줌 —
 * 예: 계약담당·유입담당·사유·모르는 사양 칸). 원문이 이상하면 저장된 칸(confirmFromStored)으로.
 * ③ first_opened_at 이 비었으면 지금·actor 로 채우고, seen_ver 가 비었으면 지금 ver·hash 로 채움(이미 있으면 안 건드림).
 */
export async function openSalesConfirmPreview(input: {
  id: string;
  actor: string;
}): Promise<{ ok: true; data: SalesConfirmPreviewData } | { ok: false; error: string }> {
  if (!input?.id) return { ok: false, error: '확인서를 정해 주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const actor = cleanActor(input.actor);
  try {
    const supabase = createAdminClient();
    const [confirmRes, versionsRes, workRes] = await Promise.all([
      supabase
        .from(SALES_CONFIRMS_TABLE)
        .select(
          'id,doc_no,ver,type,term,saved_at,saved_by,sales_rep,company,address,region,delivery_date,contacts,items,supplies,replace_info,special,doc_url,payload,payload_hash,first_seen_at,changed_at,fetched_at',
        )
        .eq('id', input.id)
        .maybeSingle(),
      supabase.from(SALES_CONFIRM_VERSIONS_TABLE).select('id', { count: 'exact', head: true }).eq('confirm_id', input.id),
      supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .select('status,processors,note,seen_ver,seen_hash,first_opened_at,updated_at')
        .eq('confirm_id', input.id)
        .maybeSingle(),
    ]);
    if (confirmRes.error) throw confirmRes.error;
    if (versionsRes.error) throw versionsRes.error;
    if (workRes.error) throw workRes.error;
    const c = confirmRes.data as Json | null;
    if (!c) return { ok: false, error: '확인서를 못 찾았어요. 목록을 새로고침해 주세요.' };
    const work = workRes.data as {
      status: string | null;
      processors: string[] | null;
      note: string | null;
      seen_ver: number | null;
      seen_hash: string | null;
      first_opened_at: string | null;
      updated_at: string;
    } | null;

    const ver = Number(c.ver) || 0;
    const hash = asStr(c.payload_hash);
    let workUpdatedAt: string | null = work?.updated_at ?? null;
    let seenVer = work?.seen_ver ?? null;

    // 처음 열람 표시("새로" 끝) — 실패해도 미리보기는 보여 주되 이유는 서버 로그에
    const now = new Date().toISOString();
    try {
      if (!work) {
        const { data, error } = await supabase
          .from(SALES_CONFIRM_WORK_TABLE)
          .insert({ confirm_id: input.id, first_opened_at: now, first_opened_by: actor, seen_ver: ver, seen_hash: hash, updated_at: now, updated_by: actor })
          .select('updated_at')
          .single();
        if (error) throw error;
        workUpdatedAt = (data as { updated_at: string }).updated_at;
        seenVer = ver;
      } else if (!work.first_opened_at || work.seen_ver === null) {
        const patch: WorkPatch = { updated_at: now, updated_by: actor };
        if (!work.first_opened_at) {
          patch.first_opened_at = now;
          patch.first_opened_by = actor;
        }
        if (work.seen_ver === null) {
          patch.seen_ver = ver;
          patch.seen_hash = hash;
        }
        const { data, error } = await supabase
          .from(SALES_CONFIRM_WORK_TABLE)
          .update(patch)
          .eq('confirm_id', input.id)
          .eq('updated_at', work.updated_at)
          .select('updated_at');
        if (error) throw error;
        if (data && data.length > 0) {
          workUpdatedAt = (data[0] as { updated_at: string }).updated_at;
          if (work.seen_ver === null) seenVer = ver;
        } // 0줄 = 그 사이 누가 고침 — 열람 표시는 다음에 다시
      }
    } catch (err) {
      logFail('③ 열람 표시', err);
    }

    const status: SalesConfirmStatus = work && isSalesConfirmStatus(work.status) ? work.status : '접수';
    const salesChanged = salesChangedSince(seenVer, ver);
    const fromPayload = normalizeSalesConfirm(c.payload);
    const confirm = fromPayload.ok ? fromPayload.value : confirmFromStored(c);
    return {
      ok: true,
      data: {
        confirm,
        status,
        processors: work?.processors ?? [],
        note: work?.note ?? '',
        firstSeenAt: asStr(c.first_seen_at),
        changedAt: asStr(c.changed_at) || null,
        fetchedAt: asStr(c.fetched_at),
        versionCount: versionsRes.count ?? 0,
        docUrl: safeDocUrl(confirm.docUrl),
        salesChanged,
        payloadHash: hash,
        workUpdatedAt,
      },
    };
  } catch (err) {
    logFail('미리보기 읽기', err);
    return { ok: false, error: '확인서를 열지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** "영업에서 수정됨" [확인함] — seen_ver·seen_hash 를 그 값으로(③ 행이 없으면 만듦) */
export async function acknowledgeSalesConfirmChange(input: {
  id: string;
  ver: number;
  payloadHash: string;
  actor: string;
}): Promise<SalesWorkSaveResult> {
  if (!input?.id) return { ok: false, error: '확인서를 정해 주세요.' };
  const ver = Math.floor(Number(input.ver));
  if (!Number.isFinite(ver) || ver < 0) return { ok: false, error: '버전 값이 올바르지 않아요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const actor = cleanActor(input.actor);
  const hash = String(input.payloadHash ?? '');
  const seen = { seen_ver: ver, seen_hash: hash };
  try {
    const supabase = createAdminClient();
    // 건 단위 조건 갱신 — 그 사이 다른 칸이 바뀌어 0줄이면 한 번 더 읽고 다시(seen 칸은 이 버튼만 씀)
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: cur, error: curErr } = await supabase.from(SALES_CONFIRM_WORK_TABLE).select('updated_at').eq('confirm_id', input.id).maybeSingle();
      if (curErr) throw curErr;
      const now = new Date().toISOString();
      if (!cur) {
        const { data, error } = await supabase
          .from(SALES_CONFIRM_WORK_TABLE)
          .insert({ confirm_id: input.id, ...seen, updated_at: now, updated_by: actor })
          .select('updated_at')
          .single();
        if (!error) return { ok: true, workUpdatedAt: (data as { updated_at: string }).updated_at };
        if (error.code === '23505') continue;
        if (error.code === '23503') return { ok: false, error: '확인서를 못 찾았어요. 목록을 새로고침해 주세요.' };
        throw error;
      }
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .update({ ...seen, updated_at: now, updated_by: actor })
        .eq('confirm_id', input.id)
        .eq('updated_at', (cur as { updated_at: string }).updated_at)
        .select('updated_at');
      if (error) throw error;
      if (data && data.length > 0) return { ok: true, workUpdatedAt: (data[0] as { updated_at: string }).updated_at };
    }
    return { ok: false, conflict: true, error: '다른 사람이 방금 고쳤어요 — 새로 불러올게요.' };
  } catch (err) {
    logFail('확인함 저장', err);
    return { ok: false, error: GENERIC };
  }
}

/** 시트와 비교(읽기만) — 고른 목록 줄들을 'IT확인서리스트' 탭과 맞춰 봄. 시트는 1번만 읽음 */
export async function compareSalesConfirmsWithSheet(ids: string[]): Promise<SheetCompareResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  let rows;
  try {
    rows = await loadListRowsByIds(Array.isArray(ids) ? ids : []);
  } catch (err) {
    logFail('비교용 목록 읽기', err);
    return { ok: false, error: '영업 확인서를 읽지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
  return compareConfirmsWithSheet(
    rows.map((r) => ({
      id: r.id,
      company: r.company,
      deliveryDate: r.deliveryDate,
      type: r.type,
      receivedAt: r.receivedAt,
      status: r.status,
      assetIds: r.assetIds,
    })),
  );
}
