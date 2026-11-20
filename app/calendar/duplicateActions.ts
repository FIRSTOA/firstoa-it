'use server';

import { revalidatePath } from 'next/cache';
import { syncPrepTitleTag } from '@/app/shipment-prep/actions';
import { titleBody } from '@/lib/confirmSheet';
import { isRecurringIcs, sameIcsText } from '@/lib/icsPatch';
import { deleteEventByHref, eventHref, isNaverCalDavConfigured, parseEventBlock, readEventByHref, type ParsedEvent } from '@/lib/naverCaldav';
import { FETCH_CONCURRENCY } from '@/lib/naverCalendarSync';
import { CALENDAR_TABLE, createAdminClient, RECEIVING_TABLE } from '@/lib/supabase/server';
import { naverFailReason } from '@/lib/syncFailure';

/**
 * 예전 버그로 생긴 네이버 복제본 정리(🔗 캘린더 연결 → 🧹 복제본 정리).
 *
 * 예전엔 네이버에서 만든 일정을 앱에서 고치면 네이버에 it-<앱 id>.ics 복제본이 생기고, 앱 줄(X)의 naver_uid 가
 * 원본 UID 에서 it-<id> 로 덮어써져 원본과 끊겼음 → 원본이 다시 읽히면 새 앱 줄(Y)이 생겨 앱에 두 줄.
 * 찾기는 읽기만(화면에서 눌러야 돎), 정리는 사람이 미리보기에서 체크한 것만, 건마다 서버가 다시 확인.
 * 순서 고정: ① Y 처리 ② X 를 원본에 다시 연결 ③ 복제본 동기화 기록 삭제 ④ 네이버 복제본 If-Match 삭제 ⑤ 출고 태그.
 * 네이버를 먼저 지우면 안 됨 — 복제본 동기화 기록이 남은 채 복제본이 사라지면 동기화 정리 단계가 it-<id> 로
 * X 를 지우고 출고 준비 기록·완료 보고가 cascade 로 같이 사라짐(lib/naverCalendarSync.ts).
 */

const SYNC_STATE_TABLE = 'it_naver_sync_state';
const NAVER_CALENDARS_TABLE = 'it_naver_calendars';
const PREP_EVENTS_TABLE = 'it_prep_events';
const PREP_REPORTS_TABLE = 'it_prep_reports';
const CONFIRM_DOCS_TABLE = 'it_confirm_docs';
const EVENT_COLS = 'id,title,date,time,status,calendar_id,naver_uid,source';
/** 한 번에 보는 복제본 후보 최대 수 */
const MAX_ITEMS = 30;
/** 캘린더마다 원본 후보(앱 줄이 없는 동기화 기록)를 네이버에서 읽는 최대 수 */
const MAX_ORPHAN_READS = 40;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventRow = {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string;
  calendar_id: string | null;
  naver_uid: string | null;
  source: string;
};
type StateRow = { href: string; etag: string; uid: string; calendar_id: string };

export type DupRecords = { prepChecks: boolean; report: boolean; photos: number; reportSent: boolean; receiving: number; confirmDocs: number };
export type DupEventInfo = { id: string; title: string; date: string; time: string; status: string; records: DupRecords };
export type DupNaverInfo = { href: string; title: string; date: string; time: string; completed: boolean };
/** deleteY = 중복 앱 줄(Y) 지우고 X 를 원본에 연결 / keepY = 기록 있는 Y 를 남기고 X 를 지움 / relink = X 를 원본에 연결 / copyOnly = 이미 연결됨, 복제본만 */
export type DupPlan = 'deleteY' | 'keepY' | 'relink' | 'copyOnly';
export type DupItem = {
  xId: string;
  calendarId: string;
  calendarName: string;
  x: DupEventInfo;
  copyHref: string;
  copyExists: boolean;
  copyEtag: string | null;
  /** 네이버 복제본(지울 것) — 없으면 null */
  copy: DupNaverInfo | null;
  /** 네이버 원본(그대로 둠) */
  original: (DupNaverInfo & { uid: string }) | null;
  /** 원본에서 다시 생긴 앱 줄 */
  y: DupEventInfo | null;
  plan: DupPlan | null;
  /** 실행을 막는 이유(직접 확인) — 있으면 체크 못 함 */
  blocked: string | null;
  notes: string[];
};
export type DupSelection = {
  xId: string;
  calendarId: string;
  plan: DupPlan;
  copyHref: string;
  copyExists: boolean;
  copyEtag: string | null;
  originalUid: string;
  originalHref: string;
  yId: string | null;
};
export type DupResult = { xId: string; ok: boolean; message: string };

const isMissingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? ''));

async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

async function mapLimit<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += FETCH_CONCURRENCY) out.push(...(await Promise.all(items.slice(i, i + FETCH_CONCURRENCY).map(fn))));
  return out;
}

type NaverRead =
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ok'; etag: string | null; parsed: ParsedEvent | null; recurring: boolean };

async function readNaver(href: string): Promise<NaverRead> {
  try {
    const r = await readEventByHref(href);
    if (!r) return { state: 'missing' };
    return { state: 'ok', etag: r.etag, parsed: parseEventBlock(r.ics), recurring: isRecurringIcs(r.ics) };
  } catch (err) {
    return { state: 'error', message: naverFailReason(err) };
  }
}

const emptyRecords = (): DupRecords => ({ prepChecks: false, report: false, photos: 0, reportSent: false, receiving: 0, confirmDocs: 0 });
const hasRecords = (r: DupRecords) => r.prepChecks || r.report || r.receiving > 0 || r.confirmDocs > 0;

/** 앱 줄에 붙은 기록(출고 준비 체크·완료 보고·입고 연결·확인서 연결). 표가 없으면 0, 그 밖의 오류는 던짐(없다고 보면 지울 수 있어서). */
async function countRecords(ids: string[]): Promise<Map<string, DupRecords>> {
  const m = new Map(ids.map((id) => [id, emptyRecords()]));
  if (!ids.length) return m;
  const supabase = createAdminClient();
  const [prep, rep, rec, conf] = await Promise.all([
    supabase.from(PREP_EVENTS_TABLE).select('event_id,prep_checks').in('event_id', ids),
    supabase.from(PREP_REPORTS_TABLE).select('event_id,photos,sent_at').in('event_id', ids),
    supabase.from(RECEIVING_TABLE).select('calendar_event_id').in('calendar_event_id', ids),
    supabase.from(CONFIRM_DOCS_TABLE).select('prep_event_id').in('prep_event_id', ids),
  ]);
  for (const [label, r] of [
    ['출고 준비', prep],
    ['완료 보고', rep],
    ['입고', rec],
    ['확인서', conf],
  ] as const) {
    if (r.error && !isMissingTable(r.error)) throw new Error(`${label} 기록을 못 읽었어요(${r.error.message})`);
  }
  for (const p of (prep.data ?? []) as { event_id: string; prep_checks: Record<string, unknown> | null }[]) {
    const x = m.get(p.event_id);
    if (x) x.prepChecks = Object.keys(p.prep_checks ?? {}).length > 0;
  }
  for (const p of (rep.data ?? []) as { event_id: string; photos: unknown[] | null; sent_at: string | null }[]) {
    const x = m.get(p.event_id);
    if (!x) continue;
    x.report = true;
    x.photos = Array.isArray(p.photos) ? p.photos.length : 0;
    x.reportSent = !!p.sent_at;
  }
  for (const p of (rec.data ?? []) as { calendar_event_id: string }[]) {
    const x = m.get(p.calendar_event_id);
    if (x) x.receiving++;
  }
  for (const p of (conf.data ?? []) as { prep_event_id: string }[]) {
    const x = m.get(p.prep_event_id);
    if (x) x.confirmDocs++;
  }
  return m;
}

const info = (e: EventRow, records: DupRecords): DupEventInfo => ({
  id: e.id,
  title: e.title,
  date: e.date,
  time: e.time ?? '',
  status: e.status,
  records,
});
const naverInfo = (href: string, p: ParsedEvent): DupNaverInfo => ({ href, title: p.title, date: p.date, time: p.time, completed: p.completed });

type OrphanSet = { rows: { state: StateRow; read: NaverRead }[]; truncated: boolean };

/** 복제본 찾기 — 읽기만. 화면에서 [🔍 복제본 찾기]를 눌러야 돎. */
export async function previewNaverDuplicates(): Promise<{ ok: true; items: DupItem[]; truncated: boolean } | { ok: false; error: string }> {
  if (!isNaverCalDavConfigured()) return { ok: false, error: '네이버 연동 설정이 없어요.' };
  try {
    const supabase = createAdminClient();
    // (a) naver_uid 가 it-<자기 id> 로 덮어써진 네이버 줄
    const broken = (
      await readAll<EventRow>((a, b) =>
        supabase.from(CALENDAR_TABLE).select(EVENT_COLS).eq('source', 'naver').like('naver_uid', 'it-%').order('id').range(a, b),
      )
    ).filter((r) => r.naver_uid === `it-${r.id}`);
    // (b) 동기화 기록에 it-<id> 로 남은 복제본(그 id 가 네이버 줄이면 — 정리 도중 끊긴 것까지)
    const itStates = (
      await readAll<StateRow>((a, b) =>
        supabase.from(SYNC_STATE_TABLE).select('href,etag,uid,calendar_id').like('uid', 'it-%').order('href').range(a, b),
      )
    ).filter((s) => !s.uid.includes('#'));
    const statesByUid = new Map<string, StateRow[]>();
    for (const s of itStates) statesByUid.set(s.uid, [...(statesByUid.get(s.uid) ?? []), s]);
    const known = new Set(broken.map((b) => b.id));
    const moreIds = [...new Set(itStates.map((s) => s.uid.slice(3)))].filter((id) => UUID_RE.test(id) && !known.has(id));
    const more: EventRow[] = [];
    for (let i = 0; i < moreIds.length; i += 200) {
      const { data, error } = await supabase.from(CALENDAR_TABLE).select(EVENT_COLS).in('id', moreIds.slice(i, i + 200)).eq('source', 'naver');
      if (error) throw new Error(error.message);
      more.push(...((data ?? []) as EventRow[]));
    }
    const all = [...broken, ...more].sort((p, q) => p.date.localeCompare(q.date));
    const truncated = all.length > MAX_ITEMS;
    const candidates = all.slice(0, MAX_ITEMS);

    const { data: cals } = await supabase.from(NAVER_CALENDARS_TABLE).select('id,name');
    const calName = new Map(((cals ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

    // 앱 줄이 없는 동기화 기록(원본 후보) — 캘린더마다 한 번만, 네이버 읽기는 상한까지
    const orphanCache = new Map<string, Promise<OrphanSet>>();
    const orphansFor = (calendarId: string): Promise<OrphanSet> => {
      let p = orphanCache.get(calendarId);
      if (!p) {
        p = (async () => {
          const states = await readAll<StateRow>((a, b) =>
            supabase
              .from(SYNC_STATE_TABLE)
              .select('href,etag,uid,calendar_id')
              .eq('calendar_id', calendarId)
              .not('uid', 'like', 'it-%')
              .order('href')
              .range(a, b),
          );
          const uids = new Set(
            (
              await readAll<{ naver_uid: string }>((a, b) =>
                supabase.from(CALENDAR_TABLE).select('naver_uid').eq('calendar_id', calendarId).not('naver_uid', 'is', null).order('id').range(a, b),
              )
            ).map((r) => r.naver_uid),
          );
          const orphans = states.filter((s) => !uids.has(s.uid));
          const rows = await mapLimit(orphans.slice(0, MAX_ORPHAN_READS), async (state) => ({ state, read: await readNaver(state.href) }));
          return { rows, truncated: orphans.length > MAX_ORPHAN_READS };
        })();
        orphanCache.set(calendarId, p);
      }
      return p;
    };

    const items: DupItem[] = [];
    for (const x of candidates) {
      items.push(await previewOne(x, statesByUid.get(`it-${x.id}`) ?? [], calName, orphansFor));
    }
    return { ok: true, items, truncated };
  } catch (err) {
    console.error('[calendar] 복제본 찾기 실패:', err);
    return { ok: false, error: `복제본을 찾지 못했어요(${err instanceof Error ? err.message : String(err)})` };
  }
}

async function previewOne(
  x: EventRow,
  copyStates: StateRow[],
  calName: Map<string, string>,
  orphansFor: (calendarId: string) => Promise<OrphanSet>,
): Promise<DupItem> {
  const supabase = createAdminClient();
  const itUid = `it-${x.id}`;
  const calendarId = x.calendar_id ?? '';
  const notes: string[] = [];
  let blocked: string | null = null;
  const block = (why: string) => {
    if (!blocked) blocked = why;
  };
  const base: DupItem = {
    xId: x.id,
    calendarId,
    calendarName: calName.get(calendarId) ?? calendarId,
    x: info(x, emptyRecords()),
    copyHref: '',
    copyExists: false,
    copyEtag: null,
    copy: null,
    original: null,
    y: null,
    plan: null,
    blocked: null,
    notes,
  };
  if (!calendarId) return { ...base, blocked: '연결이 끊긴 캘린더의 일정이에요 — 직접 확인' };

  // 복제본: UID 가 정확히 it-<id> 이고 같은 캘린더인 것만
  if (copyStates.some((s) => s.calendar_id !== calendarId) || copyStates.length > 1) block('복제본 기록이 다른 캘린더에도 있어요 — 직접 확인');
  const copyHref = copyStates.find((s) => s.calendar_id === calendarId)?.href ?? eventHref(calendarId, itUid);
  const copyRead = await readNaver(copyHref);
  let copy: DupNaverInfo | null = null;
  let copyExists = false;
  let copyEtag: string | null = null;
  if (copyRead.state === 'error') block(`네이버 복제본을 못 읽었어요(${copyRead.message})`);
  if (copyRead.state === 'ok') {
    if (!copyRead.parsed || copyRead.parsed.uid !== itUid) {
      block('복제본 주소에 다른 일정이 있어요 — 직접 확인');
    } else {
      copyExists = true;
      copyEtag = copyRead.etag;
      copy = naverInfo(copyHref, copyRead.parsed);
      if (copyRead.recurring) block('복제본이 반복 일정이에요 — 네이버에서 직접 확인');
      if (!copyEtag) block('네이버가 버전 표시(ETag)를 안 줘서 안전하게 못 지워요 — 직접 확인');
    }
  }

  // 원본 찾기
  const relinked = x.naver_uid !== itUid;
  let originalUid = '';
  let y: EventRow | null = null;
  if (relinked) {
    if (!x.naver_uid || x.naver_uid.startsWith('it-')) block('앱 줄의 네이버 연결이 이상해요 — 직접 확인');
    else originalUid = x.naver_uid;
    if (!copyExists && !copyStates.length) notes.push('이미 정리된 것 같아요.');
  } else {
    const keys = new Set([titleBody(x.title), copy ? titleBody(copy.title) : ''].filter(Boolean));
    const { data: sameDay, error } = await supabase
      .from(CALENDAR_TABLE)
      .select(EVENT_COLS)
      .eq('source', 'naver')
      .eq('calendar_id', calendarId)
      .eq('date', x.date)
      .neq('id', x.id);
    if (error) throw new Error(error.message);
    const ys = ((sameDay ?? []) as EventRow[]).filter((r) => r.naver_uid && !r.naver_uid.startsWith('it-') && keys.has(titleBody(r.title)));
    const orphans = await orphansFor(calendarId);
    const fromOrphans = orphans.rows.filter(
      (o) => o.read.state === 'ok' && !!o.read.parsed && o.read.parsed.date === x.date && keys.has(titleBody(o.read.parsed.title)),
    );
    const cands: { uid: string; y: EventRow | null }[] = [
      ...ys.map((r) => ({ uid: r.naver_uid as string, y: r })),
      ...fromOrphans.map((o) => ({ uid: o.state.uid, y: null })),
    ];
    if (cands.length === 1) {
      originalUid = cands[0].uid;
      y = cands[0].y;
    } else if (!cands.length) {
      block(orphans.truncated ? '원본 후보를 다 못 읽었어요 — 직접 확인' : '네이버 원본을 못 찾았어요(제목·날짜가 같은 원본 없음) — 직접 확인');
    } else {
      block(`원본 후보가 ${cands.length}개예요 — 직접 확인`);
    }
  }

  let original: (DupNaverInfo & { uid: string }) | null = null;
  if (originalUid) {
    const { data: st, error } = await supabase
      .from(SYNC_STATE_TABLE)
      .select('href,etag,uid,calendar_id')
      .eq('uid', originalUid)
      .eq('calendar_id', calendarId)
      .limit(2);
    if (error) throw new Error(error.message);
    const rows = (st ?? []) as StateRow[];
    if (rows.length !== 1) {
      block('네이버 원본의 주소 기록이 없거나 여러 개예요 — 직접 확인');
    } else {
      const r = await readNaver(rows[0].href);
      if (r.state === 'error') block(`네이버 원본을 못 읽었어요(${r.message})`);
      else if (r.state === 'missing') block('네이버 원본이 이미 없어요 — 직접 확인');
      else if (!r.parsed || r.parsed.uid !== originalUid.split('#')[0]) block('원본 주소의 일정이 달라요 — 직접 확인');
      else {
        original = { ...naverInfo(rows[0].href, r.parsed), uid: originalUid };
        if (r.recurring) block('원본이 반복 일정이에요 — 직접 확인');
      }
    }
  }

  const records = await countRecords([x.id, ...(y ? [y.id] : [])]);
  const xRec = records.get(x.id) ?? emptyRecords();
  const yRec = y ? (records.get(y.id) ?? emptyRecords()) : null;
  let plan: DupPlan | null = null;
  if (relinked) plan = 'copyOnly';
  else if (y && yRec) {
    if (!hasRecords(yRec)) plan = 'deleteY';
    else if (!hasRecords(xRec)) plan = 'keepY';
    else block('앱 줄 두 개 모두 출고 준비·완료 보고·입고·확인서 기록이 있어요 — 직접 확인');
  } else if (originalUid) plan = 'relink';

  if (copy && original) {
    if (copy.completed !== original.completed) {
      notes.push(
        `복제본은 ${copy.completed ? '완료' : '진행중'}, 원본은 ${original.completed ? '완료' : '진행중'} — 원본은 그대로 둬요(필요하면 정리 뒤 앱에서 완료 체크).`,
      );
    }
    if (!sameIcsText(copy.title, original.title)) notes.push('복제본과 원본 제목이 달라요 — 원본 제목을 그대로 둬요.');
  }

  return {
    ...base,
    x: info(x, xRec),
    copyHref,
    copyExists,
    copyEtag,
    copy,
    original,
    y: y && yRec ? info(y, yRec) : null,
    plan: blocked ? null : plan,
    blocked,
  };
}

/** 정리 — 체크한 것만, 건마다 다시 확인하고 따로 결과(한 건 실패가 나머지를 막지 않음). */
export async function cleanupNaverDuplicates(
  selections: DupSelection[],
): Promise<{ ok: true; results: DupResult[] } | { ok: false; error: string }> {
  if (!isNaverCalDavConfigured()) return { ok: false, error: '네이버 연동 설정이 없어요.' };
  if (!Array.isArray(selections) || !selections.length) return { ok: false, error: '정리할 것을 골라 주세요.' };
  if (selections.length > MAX_ITEMS) return { ok: false, error: `한 번에 ${MAX_ITEMS}개까지만 정리할 수 있어요.` };
  const results: DupResult[] = [];
  for (const sel of selections) {
    try {
      results.push(await cleanupOne(sel));
    } catch (err) {
      console.error('[calendar] 복제본 정리 실패:', sel?.xId, err);
      results.push({ xId: String(sel?.xId ?? ''), ok: false, message: `건너뜀 — ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  revalidatePath('/calendar');
  return { ok: true, results };
}

async function cleanupOne(sel: DupSelection): Promise<DupResult> {
  const skip = (why: string): DupResult => ({ xId: String(sel?.xId ?? ''), ok: false, message: `건너뜀 — ${why}` });
  if (
    !sel ||
    typeof sel.xId !== 'string' ||
    !UUID_RE.test(sel.xId) ||
    !['deleteY', 'keepY', 'relink', 'copyOnly'].includes(sel.plan) ||
    typeof sel.calendarId !== 'string' ||
    !sel.calendarId ||
    typeof sel.originalUid !== 'string' ||
    !sel.originalUid ||
    sel.originalUid.startsWith('it-') ||
    typeof sel.originalHref !== 'string' ||
    !sel.originalHref ||
    typeof sel.copyHref !== 'string' ||
    (sel.yId !== null && (typeof sel.yId !== 'string' || !UUID_RE.test(sel.yId)))
  ) {
    return skip('정리 정보가 이상해요 — 다시 찾기 해 주세요');
  }
  const supabase = createAdminClient();
  const itUid = `it-${sel.xId}`;

  // 앱 줄 X 다시 확인
  const { data: xData, error: xError } = await supabase.from(CALENDAR_TABLE).select(EVENT_COLS).eq('id', sel.xId).maybeSingle();
  if (xError) return skip(`앱 줄을 못 읽었어요(${xError.message})`);
  const x = xData as EventRow | null;
  const expectUid = sel.plan === 'copyOnly' ? sel.originalUid : itUid;
  if (!x || x.source !== 'naver' || x.calendar_id !== sel.calendarId || x.naver_uid !== expectUid) {
    return skip('앱 줄이 그 사이 바뀌었어요 — 다시 찾기 해 주세요');
  }

  // 복제본 주소가 이 일정의 것인지(아무 주소나 지우지 않게) + 미리보기 때와 같은지
  const { data: csData, error: csError } = await supabase
    .from(SYNC_STATE_TABLE)
    .select('href,etag,uid,calendar_id')
    .eq('uid', itUid)
    .eq('calendar_id', sel.calendarId);
  if (csError) return skip(`복제본 동기화 기록을 못 읽었어요(${csError.message})`);
  const copyStates = (csData ?? []) as StateRow[];
  const okHref = sel.copyHref === eventHref(sel.calendarId, itUid) || copyStates.some((s) => s.href === sel.copyHref);
  if (!okHref) return skip('복제본 주소가 이 일정의 것이 아니에요');
  const copyNow = await readEventByHref(sel.copyHref);
  if (sel.copyExists) {
    if (!copyNow) return skip('네이버 복제본이 그 사이 없어졌어요 — 다시 찾기 해 주세요');
    if (!sel.copyEtag || copyNow.etag !== sel.copyEtag) return skip('네이버 복제본이 그 사이 바뀌었어요 — 다시 찾기 해서 확인해 주세요');
    const p = parseEventBlock(copyNow.ics);
    if (!p || p.uid !== itUid) return skip('복제본 주소에 다른 일정이 있어요');
    if (isRecurringIcs(copyNow.ics)) return skip('복제본이 반복 일정이에요 — 네이버에서 직접 확인해 주세요');
  } else if (copyNow) {
    return skip('그 사이 네이버에 복제본이 생겼어요 — 다시 찾기 해 주세요');
  }

  // 원본 다시 확인
  const { data: osData, error: osError } = await supabase
    .from(SYNC_STATE_TABLE)
    .select('href')
    .eq('uid', sel.originalUid)
    .eq('calendar_id', sel.calendarId)
    .limit(2);
  if (osError) return skip(`원본 기록을 못 읽었어요(${osError.message})`);
  const os = (osData ?? []) as { href: string }[];
  if (os.length !== 1 || os[0].href !== sel.originalHref) return skip('네이버 원본 기록이 그 사이 바뀌었어요 — 다시 찾기 해 주세요');
  const orig = await readEventByHref(sel.originalHref);
  if (!orig) return skip('네이버 원본이 그 사이 지워졌어요 — 다시 찾기 해 주세요');
  if (isRecurringIcs(orig.ics)) return skip('원본이 반복 일정이에요 — 직접 확인해 주세요');
  const op = parseEventBlock(orig.ics);
  if (!op || op.uid !== sel.originalUid.split('#')[0]) return skip('원본 주소의 일정이 달라요 — 다시 찾기 해 주세요');

  // Y 다시 확인(naver_uid 는 유일 칸 — 원본 UID 를 가진 줄이 계획과 맞아야 함)
  const { data: holders, error: hError } = await supabase.from(CALENDAR_TABLE).select(EVENT_COLS).eq('naver_uid', sel.originalUid).limit(3);
  if (hError) return skip(`앱 줄을 못 읽었어요(${hError.message})`);
  const holderRows = ((holders ?? []) as EventRow[]).filter((h) => h.id !== sel.xId);
  let y: EventRow | null = null;
  if (sel.plan === 'deleteY' || sel.plan === 'keepY') {
    y = holderRows.length === 1 && holderRows[0].id === sel.yId && holderRows[0].calendar_id === sel.calendarId ? holderRows[0] : null;
    if (!y) return skip('중복 앱 줄이 그 사이 바뀌었어요 — 다시 찾기 해 주세요');
  } else if (holderRows.length) {
    return skip('그 사이 원본 앱 줄이 새로 생겼어요 — 다시 찾기 해 주세요');
  }

  // 기록 다시 세기(Y 를 지우거나 X 를 지우기 전에)
  const records = await countRecords([sel.xId, ...(y ? [y.id] : [])]);
  if (sel.plan === 'deleteY' && y && hasRecords(records.get(y.id) ?? emptyRecords())) {
    return skip('중복 앱 줄에 그 사이 기록이 생겼어요 — 다시 찾기 해 주세요');
  }
  if (sel.plan === 'keepY' && hasRecords(records.get(sel.xId) ?? emptyRecords())) {
    return skip('앱 줄에 그 사이 기록이 생겼어요 — 다시 찾기 해 주세요');
  }

  const steps: string[] = [];
  const stop = (why: string): DupResult => ({
    xId: sel.xId,
    ok: false,
    message: `${steps.length ? `${steps.join(' · ')} 까지 했고, ` : ''}${why} — 다시 찾기 해서 확인해 주세요.`,
  });

  // ① Y 처리
  if (sel.plan === 'deleteY' && y) {
    const { error } = await supabase.from(CALENDAR_TABLE).delete().eq('id', y.id).eq('naver_uid', sel.originalUid);
    if (error) return stop(`① 중복 앱 줄을 못 지웠어요(${error.message})`);
    steps.push('① 중복 앱 줄 지움');
  }

  // ② X 를 원본에 다시 연결(내용도 원본 값으로 — 다음 동기화가 할 일을 미리) / keepY 면 X 를 지움
  if (sel.plan === 'deleteY' || sel.plan === 'relink') {
    const fields = {
      naver_uid: sel.originalUid,
      title: op.title,
      date: op.date,
      time: op.time,
      location: op.location,
      description: op.description,
      status: op.completed ? '완료' : '진행중',
      naver_synced_at: new Date().toISOString(),
    };
    let upd = await supabase
      .from(CALENDAR_TABLE)
      .update({ ...fields, naver_important: op.important })
      .eq('id', sel.xId)
      .eq('naver_uid', itUid)
      .select('id');
    // shipment_prep_schema.sql 실행 전이면 naver_important 칸이 없어요 — 그 칸만 빼고
    if (upd.error && /naver_important/.test(upd.error.message)) {
      upd = await supabase.from(CALENDAR_TABLE).update(fields).eq('id', sel.xId).eq('naver_uid', itUid).select('id');
    }
    if (upd.error || !(upd.data ?? []).length) return stop(`② 앱 줄을 원본에 다시 연결하지 못했어요(${upd.error?.message ?? '바뀐 줄 없음'})`);
    steps.push('② 앱 줄을 원본에 다시 연결');
  } else if (sel.plan === 'keepY') {
    const del = await supabase.from(CALENDAR_TABLE).delete().eq('id', sel.xId).eq('naver_uid', itUid).select('id');
    if (del.error || !(del.data ?? []).length) return stop(`② 복제본 쪽 앱 줄을 못 지웠어요(${del.error?.message ?? '지운 줄 없음'})`);
    steps.push('② 복제본 쪽 앱 줄 지움(기록 있는 원본 줄을 남김)');
  }

  // ③ 복제본 동기화 기록 삭제(②가 끝난 뒤에만)
  if (copyStates.length) {
    const { error } = await supabase.from(SYNC_STATE_TABLE).delete().eq('uid', itUid).eq('calendar_id', sel.calendarId);
    if (error) return stop(`③ 복제본 동기화 기록을 못 지웠어요(${error.message})`);
    steps.push('③ 복제본 동기화 기록 지움');
  }

  // ④ 네이버 복제본 삭제(If-Match = 미리보기 때 확인한 버전)
  if (sel.copyExists) {
    let outcome: 'ok' | 'conflict' | 'gone' | 'error' = 'error';
    let why = '';
    try {
      outcome = await deleteEventByHref(sel.copyHref, sel.copyEtag);
    } catch (err) {
      why = naverFailReason(err);
    }
    if (outcome === 'conflict' || outcome === 'error') {
      // 복제본이 남았으니 동기화 기록도 원래대로(다시 정리할 수 있게)
      if (copyStates.length) {
        const { error } = await supabase.from(SYNC_STATE_TABLE).upsert(copyStates, { onConflict: 'href' });
        if (error) console.error('[calendar] 복제본 동기화 기록 되돌리기 실패:', sel.xId, error);
      }
      return stop(`④ 네이버 복제본은 남았어요(${outcome === 'conflict' ? '그 사이 누가 고침' : why}) — 복제본 남음, 다시 정리해 주세요`);
    }
    steps.push(outcome === 'gone' ? '④ 네이버 복제본은 이미 없었음' : '④ 네이버 복제본 지움');
  }

  // ⑤ 출고 준비 기록이 있으면 담당자 태그를 원본 제목에(실패는 안내만)
  const keepId = sel.plan === 'keepY' && y ? y.id : sel.xId;
  const { data: prep } = await supabase.from(PREP_EVENTS_TABLE).select('event_id').eq('event_id', keepId).maybeSingle();
  if (prep) {
    const t = await syncPrepTitleTag(keepId);
    steps.push(t.ok ? '⑤ 출고 준비 태그를 원본 제목에 맞춤' : `⑤ 출고 준비 태그는 못 맞춤(${t.error}) — 출고 준비 화면에서 다시 시도`);
  }

  console.log(
    '[calendar] 복제본 정리',
    JSON.stringify({ at: new Date().toISOString(), xId: sel.xId, plan: sel.plan, yId: sel.yId, copyHref: sel.copyHref, originalHref: sel.originalHref, steps }),
  );
  return { xId: sel.xId, ok: true, message: steps.join(' · ') || '바꿀 것이 없었어요' };
}
