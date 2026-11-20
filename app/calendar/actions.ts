'use server';

import { revalidatePath } from 'next/cache';
import { syncPrepTitleTag } from '@/app/shipment-prep/actions';
import { appEventTimeLines, isRecurringIcs, patchEventProps, sameIcsText, type EventPropPatch } from '@/lib/icsPatch';
import {
  buildIcal,
  deleteEventByHref,
  eventHref,
  isNaverCalDavConfigured,
  listCalendars as naverListCalendars,
  parseEventBlock,
  putEvent as naverPutEvent,
  putEventByHref,
  readEventByHref,
  type ParsedEvent,
} from '@/lib/naverCaldav';
import {
  calendarEventInputToRow,
  calendarEventOrigin,
  rowToCalendarEvent,
  rowToNaverCalendarConnection,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventRow,
  type NaverCalendarConnection,
  type NaverCalendarConnectionRow,
} from '@/lib/calendar';
import { CALENDAR_TABLE, createAdminClient } from '@/lib/supabase/server';
import { naverFailReason } from '@/lib/syncFailure';

/**
 * naverWarning = 앱 저장은 됐지만 네이버 반영이 실패한 이유(화면이 "다시 [저장]" 안내와 함께 경고).
 * warning = 그대로 보여 줄 완성된 경고 문장(다시 저장해도 소용없는 경우 등).
 */
export type ActionResult = { ok: true; naverWarning?: string; warning?: string } | { ok: false; error: string };

const NAVER_CALENDARS_TABLE = 'it_naver_calendars';
const SYNC_STATE_TABLE = 'it_naver_sync_state';
const PREP_EVENTS_TABLE = 'it_prep_events';

const MSG_NAVER_LOCK_CAL = '네이버에서 만든 일정은 앱에서 캘린더를 못 바꿔요 — 네이버에서 옮겨 주세요.';
const MSG_NAVER_LOCK_TIME = '네이버에서 만든 일정은 날짜·시간을 앱에서 못 바꿔요 — 네이버에서 바꿔 주세요.';
const MSG_BROKEN =
  '이 일정은 예전 오류로 네이버에 복제본이 생긴 일정이에요. 🔗 캘린더 연결 → 🧹 복제본 정리에서 먼저 정리해 주세요(★ 중요·품목·등록자는 지금도 고칠 수 있어요).';
const MSG_LOCKED =
  '네이버에서 복사된 일정이라 앱에서 네이버 쪽 내용은 못 바꿔요 — 네이버에서 고쳐 주세요(★ 중요·품목·등록자는 고칠 수 있어요).';
const MSG_BROKEN_DELETE =
  '이 일정은 예전 오류로 네이버에 복제본이 생긴 일정이라 지금은 못 지워요. 🔗 캘린더 연결 → 🧹 복제본 정리에서 먼저 정리해 주세요.';
const MSG_NO_NAVER_CAL = '연결이 끊긴 네이버 캘린더의 일정이라 앱에서 네이버 쪽은 못 바꿔요 — 네이버에서 해 주세요.';
const MSG_RECURRING_EDIT = '반복 일정은 앱에서 못 고쳐요 — 네이버에서 고쳐 주세요. 앱에도 저장하지 않았어요.';
const MSG_RECURRING_DELETE = '반복 일정은 앱에서 못 지워요 — 네이버에서 지워 주세요.';
const MSG_NO_CALDAV = '네이버 연동 설정이 없어 네이버 일정을 바꿀 수 없어요.';
// 네이버가 일정 버전 표시(ETag)를 안 주면 If-Match 없이 덮어쓰거나 지우게 됨 → 다른 팀 원본이라 안전하게 거절(연동희 조건)
const MSG_NO_ETAG_EDIT = '네이버가 이 일정의 버전 표시를 주지 않아 안전하게 고칠 수 없어요 — 네이버에서 고쳐 주세요. 앱에도 저장하지 않았어요.';
const MSG_NO_ETAG_DELETE = '네이버가 이 일정의 버전 표시를 주지 않아 안전하게 지울 수 없어요 — 네이버에서 지워 주세요. 앱에서도 안 지웠어요.';

/** 앱 일정이 네이버에서 반복 일정으로 바뀌어 네이버 쪽을 안 건드린 경우(조용히 넘기지 않고 경고). */
class NaverRecurringError extends Error {
  constructor() {
    super('반복 일정');
  }
}

function validate(input: CalendarEventInput): string | null {
  if (!input.title.trim()) return '제목은 필수예요.';
  if (!input.date.trim()) return '날짜는 필수예요.';
  return null;
}

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '42P01') return '테이블이 없어요. supabase/calendar_schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
}

/**
 * 네이버 반영은 최선노력입니다 — Supabase 쓰기가 이 앱의 기준값이라 실패해도 앱 저장은
 * 성공으로 둡니다. 다만 실패를 삼키지 않고 이유(쉬운 말)를 돌려줘서, 화면이 "앱에는 저장,
 * 네이버는 실패 — 다시 [저장]"을 알립니다. null = 반영 성공(또는 네이버 연동 설정 없음).
 */
async function syncToNaverBestEffort(fn: () => Promise<void>, label: string): Promise<string | null> {
  if (!isNaverCalDavConfigured()) return null;
  try {
    await fn();
    return null;
  } catch (err) {
    console.error(`[calendar] ${label} 실패(네이버):`, err);
    return naverFailReason(err);
  }
}

export async function listEventsInRange(startDate: string, endDate: string): Promise<CalendarEvent[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(CALENDAR_TABLE)
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) {
    console.error('[calendar] listEventsInRange 실패:', error);
    return [];
  }
  return ((data ?? []) as CalendarEventRow[]).map(rowToCalendarEvent);
}

export async function createEvent(
  input: CalendarEventInput,
): Promise<{ ok: true; id: string; naverWarning?: string } | { ok: false; error: string }> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { data, error } = await supabase.from(CALENDAR_TABLE).insert(calendarEventInputToRow(input)).select().single();
  if (error) {
    console.error('[calendar] createEvent 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  const id = (data as CalendarEventRow).id;
  let naverWarning: string | null = null;
  if (input.calendarId) {
    naverWarning = await syncToNaverBestEffort(async () => {
      const uid = `it-${id}`;
      const ical = buildIcal({
        uid,
        title: input.title,
        date: input.date,
        time: input.time,
        location: input.location,
        description: input.description,
        completed: input.status === '완료',
      });
      await naverPutEvent(input.calendarId as string, uid, ical);
      await supabase.from(CALENDAR_TABLE).update({ naver_uid: uid, naver_synced_at: new Date().toISOString() }).eq('id', id);
    }, 'createEvent');
  }

  revalidatePath('/calendar');
  return naverWarning ? { ok: true, id, naverWarning } : { ok: true, id };
}

/**
 * 일정 고치기 — 어디서 온 일정인지(lib/calendar.ts calendarEventOrigin)로 맨 먼저 나눔.
 * 예전엔 모든 일정을 it-<id>.ics 로 올려서, 네이버에서 만든 일정을 고치면 네이버에 복제본이 생기고
 * 앱 줄의 naver_uid 가 덮어써져 원본과 끊겼음(앱에 두 줄). 네이버 원본은 이제 원래 주소를 고침.
 */
export async function updateEvent(id: string, input: CalendarEventInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { data: beforeData, error: readError } = await supabase.from(CALENDAR_TABLE).select('*').eq('id', id).maybeSingle();
  if (readError) return { ok: false, error: `일정을 읽지 못했어요: ${readError.message}` };
  if (!beforeData) return { ok: false, error: '일정을 찾지 못했어요 — 새로고침해 주세요.' };
  const before = beforeData as CalendarEventRow;

  const origin = calendarEventOrigin(rowToCalendarEvent(before));
  if (origin === 'naver') return updateNaverOriginEvent(before, input);
  if (origin === 'broken' || origin === 'locked') {
    // 네이버 쪽 칸은 못 바꿈 — 앱 전용 칸(★ 중요·품목·등록자)만 저장
    const sameCal = (input.calendarId ?? null) === (before.calendar_id ?? null);
    const sameTime = input.date === before.date && (input.time ?? '') === (before.time ?? '');
    if (!sameCal || !sameTime || changedNaverFields(before, input).labels.length) {
      return { ok: false, error: origin === 'broken' ? MSG_BROKEN : MSG_LOCKED };
    }
    return saveAppOnlyFields(before, input);
  }
  return updateAppEvent(before, input);
}

/** 네이버로 가는 칸(제목·장소·설명·완료) 중 바뀐 것 — "고치기 전 값"은 서버가 DB 에서 읽은 값. */
function changedNaverFields(before: CalendarEventRow, input: CalendarEventInput): { patch: EventPropPatch; labels: string[] } {
  const patch: EventPropPatch = {};
  const labels: string[] = [];
  if (!sameIcsText(before.title, input.title)) {
    patch.title = input.title;
    labels.push('제목');
  }
  if (!sameIcsText(before.location, input.location)) {
    patch.location = input.location;
    labels.push('장소');
  }
  if (!sameIcsText(before.description, input.description)) {
    patch.description = input.description;
    labels.push('설명');
  }
  if ((before.status === '완료') !== (input.status === '완료')) {
    patch.completed = input.status === '완료';
    labels.push('완료');
  }
  return { patch, labels };
}

/** 바꾸려는 칸이 네이버에서 그 사이 바뀌었는지 — 네이버 지금 값이 앱이 알던 값(DB)과 다르면 그 칸 이름. */
function naverConflicts(parsed: ParsedEvent, before: CalendarEventRow, patch: EventPropPatch): string[] {
  const out: string[] = [];
  if (patch.title !== undefined && !sameIcsText(parsed.title, before.title)) out.push('제목');
  if (patch.location !== undefined && !sameIcsText(parsed.location, before.location)) out.push('장소');
  if (patch.description !== undefined && !sameIcsText(parsed.description, before.description)) out.push('설명');
  if (patch.completed !== undefined && parsed.completed !== (before.status === '완료')) out.push('완료');
  return out;
}

async function saveAppOnlyFields(before: CalendarEventRow, input: CalendarEventInput): Promise<ActionResult> {
  const { error } = await createAdminClient().from(CALENDAR_TABLE).update(calendarEventInputToRow(input)).eq('id', before.id);
  if (error) {
    console.error('[calendar] updateEvent 실패:', error);
    return { ok: false, error: toMessage(error) };
  }
  revalidatePath('/calendar');
  return { ok: true };
}

type SyncStateRow = { href: string; etag: string; uid: string; calendar_id: string };

/**
 * 네이버 원본의 주소 — 상태 표에서 uid·calendar_id 로 좁혀 찾음(전체를 안 읽어서 1000줄 잘림과 무관).
 * 없으면(동기화 범위 -30~+120일 밖이거나 아직 안 읽음) 네이버에서 하라고 안내.
 */
async function findNaverState(uid: string, calendarId: string, verb: '고쳐' | '지워'): Promise<{ ok: true; row: SyncStateRow } | { ok: false; error: string }> {
  const { data, error } = await createAdminClient()
    .from(SYNC_STATE_TABLE)
    .select('href,etag,uid,calendar_id')
    .eq('uid', uid)
    .eq('calendar_id', calendarId)
    .limit(2);
  if (error) return { ok: false, error: `네이버 일정 주소를 읽지 못했어요(${error.message}) — 잠시 뒤 다시 해 주세요.` };
  const rows = (data ?? []) as SyncStateRow[];
  if (!rows.length) return { ok: false, error: `네이버 일정 주소를 몰라요(동기화 범위 밖이거나 아직 안 읽음) — 네이버에서 ${verb} 주세요.` };
  if (rows.length > 1) return { ok: false, error: `같은 일정의 네이버 주소가 여러 개예요 — 네이버에서 ${verb} 주세요.` };
  return { ok: true, row: rows[0] };
}

/**
 * 네이버에서 만든 원본 고치기·완료 체크 — 원래 주소(href)를 If-Match 로, 바뀐 칸만(lib/icsPatch.ts).
 * 날짜·시간·캘린더는 못 바꿈(원본마다 길이·형식이 달라서). 네이버 먼저 → 성공하면 앱 저장(naver_uid 는 그대로).
 * 네이버가 실패하면 앱에도 안 씀 — 앱만 바꾸면 다음 동기화가 어차피 네이버 값으로 되돌림.
 * 상태 표 etag 는 안 씀(다음 동기화가 갱신).
 */
async function updateNaverOriginEvent(before: CalendarEventRow, input: CalendarEventInput): Promise<ActionResult> {
  const id = before.id;
  if ((input.calendarId ?? null) !== (before.calendar_id ?? null)) return { ok: false, error: MSG_NAVER_LOCK_CAL };
  if (input.date !== before.date || (input.time ?? '') !== (before.time ?? '')) return { ok: false, error: MSG_NAVER_LOCK_TIME };

  const { patch, labels } = changedNaverFields(before, input);
  // 앱 전용 칸(★ 중요·품목·등록자)만 바뀜 → 네이버는 읽지도 않음
  if (!labels.length) return saveAppOnlyFields(before, input);

  if (!isNaverCalDavConfigured()) return { ok: false, error: MSG_NO_CALDAV };
  if (!before.calendar_id) return { ok: false, error: MSG_NO_NAVER_CAL };
  const naverUid = before.naver_uid as string;
  const loc = await findNaverState(naverUid, before.calendar_id, '고쳐');
  if (!loc.ok) return { ok: false, error: loc.error };
  const href = loc.row.href;

  try {
    let written = false;
    // 412(그 사이 누가 고침)면 다시 읽어 다시 비교한 뒤 한 번 더
    for (let attempt = 0; attempt < 2 && !written; attempt++) {
      const cur = await readEventByHref(href);
      if (!cur) return { ok: false, error: '네이버에서 이미 지워진 일정이에요 — 새로고침해 주세요. 앱에도 저장하지 않았어요.' };
      if (!cur.etag) return { ok: false, error: MSG_NO_ETAG_EDIT };
      if (isRecurringIcs(cur.ics)) return { ok: false, error: MSG_RECURRING_EDIT };
      const parsed = parseEventBlock(cur.ics);
      if (!parsed || parsed.uid !== naverUid.split('#')[0]) {
        return { ok: false, error: '네이버 주소의 일정이 이 일정과 달라요 — 새로고침한 뒤 다시 해 주세요. 앱에도 저장하지 않았어요.' };
      }
      const conflicts = naverConflicts(parsed, before, patch);
      if (conflicts.length) {
        return {
          ok: false,
          error: `네이버에서 그 사이 바뀌었어요(${conflicts.join('·')}) — 새로고침해서 바뀐 내용을 본 뒤 다시 고쳐 주세요. 앱에도 저장하지 않았어요.`,
        };
      }
      written = (await putEventByHref(href, patchEventProps(cur.ics, patch), cur.etag)) === 'ok';
    }
    if (!written) {
      return { ok: false, error: '다른 사람이 동시에 고치고 있어서 네이버에 못 바꿨어요 — 잠시 뒤 다시 해 주세요. 앱에도 저장하지 않았어요.' };
    }
  } catch (err) {
    console.error('[calendar] 네이버 원본 수정 실패:', id, href, err);
    return { ok: false, error: `네이버에 못 바꿔서 저장하지 않았어요(${naverFailReason(err)}) — 잠시 뒤 다시 해 주세요.` };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from(CALENDAR_TABLE)
    .update({ ...calendarEventInputToRow(input), naver_synced_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[calendar] 네이버 원본은 고쳤지만 앱 저장 실패:', id, error);
    return { ok: false, error: `네이버에는 바꿨지만 앱 저장에 실패했어요(${error.message}) — 다음 동기화 때 네이버 값으로 맞춰져요.` };
  }

  let warning: string | undefined;
  if (patch.title !== undefined) {
    // 제목을 바꿨으면 출고 준비 담당자 태그를 다시 붙임(우리 담당자 태그만 — 백오피스 태그는 그대로)
    const { data: prep } = await supabase.from(PREP_EVENTS_TABLE).select('event_id').eq('event_id', id).maybeSingle();
    if (prep) {
      const tag = await syncPrepTitleTag(id);
      if (!tag.ok) warning = `저장했어요. 다만 출고 준비 태그를 네이버 제목에 다시 붙이지 못했어요(${tag.error}) — 출고 준비 화면에서 다시 시도해 주세요.`;
    }
  }
  revalidatePath('/calendar');
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * 앱에서 만든 일정(it-<id>) 고치기 — 앱 줄 먼저 저장(앱이 기준), 네이버는 최선노력(실패하면 naverWarning).
 * 네이버에서 단 별표·알림·참석자가 지워지지 않게 바뀐 칸만 고침(예전엔 VEVENT 통째 교체).
 * 지난번 반영이 실패했으면(naver_synced_at 비어 있음) 네이버와 다른 칸을 모두 다시 맞춤 — 그래서 "다시 [저장]"이 통함.
 */
async function updateAppEvent(before: CalendarEventRow, input: CalendarEventInput): Promise<ActionResult> {
  const id = before.id;
  const supabase = createAdminClient();
  const { error } = await supabase.from(CALENDAR_TABLE).update(calendarEventInputToRow(input)).eq('id', id);
  if (error) {
    console.error('[calendar] updateEvent 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  const prevCal = before.calendar_id ?? null;
  const nextCal = input.calendarId ?? null;
  let result: ActionResult = { ok: true };
  if (isNaverCalDavConfigured() && (prevCal || nextCal)) {
    try {
      await pushAppEvent(before, input, prevCal, nextCal);
      if (nextCal) {
        await supabase.from(CALENDAR_TABLE).update({ naver_uid: `it-${id}`, naver_synced_at: new Date().toISOString() }).eq('id', id);
      }
    } catch (err) {
      console.error('[calendar] updateEvent 실패(네이버):', id, err);
      // 다음 [저장] 때 네이버와 다른 칸을 모두 다시 맞추도록 표시
      const { error: markError } = await supabase.from(CALENDAR_TABLE).update({ naver_synced_at: null }).eq('id', id);
      if (markError) console.error('[calendar] naver_synced_at 비우기 실패:', id, markError);
      result =
        err instanceof NaverRecurringError
          ? { ok: true, warning: '앱에는 저장했어요. 네이버에서 반복 일정으로 바뀐 일정이라 네이버 쪽은 안 바꿨어요 — 네이버에서 고쳐 주세요.' }
          : { ok: true, naverWarning: naverFailReason(err) };
    }
  }
  revalidatePath('/calendar');
  return result;
}

async function pushAppEvent(before: CalendarEventRow, input: CalendarEventInput, prevCal: string | null, nextCal: string | null): Promise<void> {
  const uid = `it-${before.id}`;
  // 연결된 캘린더가 바뀌었으면 예전 캘린더에서는 지움(If-Match, 404 는 성공)
  if (prevCal && prevCal !== nextCal) await deleteAppEventFromNaver(prevCal, uid);
  if (!nextCal) return;
  const fresh = {
    uid,
    title: input.title,
    date: input.date,
    time: input.time,
    location: input.location,
    description: input.description,
    completed: input.status === '완료',
  };
  if (prevCal !== nextCal) {
    await naverPutEvent(nextCal, uid, buildIcal(fresh));
    return;
  }
  const href = eventHref(nextCal, uid);
  const retryAll = !before.naver_synced_at;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await readEventByHref(href);
    if (!cur) {
      // 네이버에 없음(처음 올리기가 실패했던 일정 등) → 새로 만듦(예전 동작)
      await naverPutEvent(nextCal, uid, buildIcal(fresh));
      return;
    }
    if (isRecurringIcs(cur.ics)) throw new NaverRecurringError();
    const parsed = parseEventBlock(cur.ics);
    const want = (changedInApp: boolean, differsInNaver: boolean) => changedInApp || (retryAll && differsInNaver);
    const patch: EventPropPatch = {};
    if (want(!sameIcsText(before.title, input.title), !!parsed && !sameIcsText(parsed.title, input.title))) patch.title = input.title;
    if (want(!sameIcsText(before.location, input.location), !!parsed && !sameIcsText(parsed.location, input.location))) {
      patch.location = input.location;
    }
    if (want(!sameIcsText(before.description, input.description), !!parsed && !sameIcsText(parsed.description, input.description))) {
      patch.description = input.description;
    }
    const done = input.status === '완료';
    if (want((before.status === '완료') !== done, !!parsed && parsed.completed !== done)) patch.completed = done;
    const timeChanged = before.date !== input.date || (before.time ?? '') !== (input.time ?? '');
    if (want(timeChanged, !!parsed && (parsed.date !== input.date || parsed.time !== (input.time ?? '')))) {
      const lines = appEventTimeLines(cur.ics, input.date, input.time ?? '');
      patch.dtstart = lines.dtstart;
      patch.dtend = lines.dtend;
    }
    if (!Object.keys(patch).length) return;
    if ((await putEventByHref(href, patchEventProps(cur.ics, patch), cur.etag)) === 'ok') return;
  }
  throw new Error('다른 사람이 동시에 고치고 있어서 네이버에 못 바꿨어요');
}

/** 앱 일정을 네이버에서 지움 — If-Match, 404 는 이미 없음(성공), 412 면 다시 읽고 한 번 더. 반복 일정이면 안 지움. */
async function deleteAppEventFromNaver(calendarId: string, uid: string): Promise<void> {
  const href = eventHref(calendarId, uid);
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await readEventByHref(href);
    if (!cur) return;
    if (isRecurringIcs(cur.ics)) throw new NaverRecurringError();
    if (!cur.etag) throw new Error('네이버가 일정 버전 표시를 주지 않아 안전하게 못 지웠어요 — 네이버에서 직접 지워 주세요');
    if ((await deleteEventByHref(href, cur.etag)) !== 'conflict') return;
  }
  throw new Error('다른 사람이 동시에 고치고 있어서 네이버에서 못 지웠어요');
}

/**
 * 일정 지우기. 네이버에서 만든 원본은 네이버에서도 지움 — 화면이 한 번 더 확인하고, 서버도
 * confirmNaverDelete 를 받아야 지움(서버 액션은 누구나 부를 수 있어서). actor = 지운 사람 이름(있으면, 로그용).
 */
export async function deleteEvent(id: string, opts: { confirmNaverDelete?: boolean; actor?: string } = {}): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data, error: readError } = await supabase.from(CALENDAR_TABLE).select('*').eq('id', id).maybeSingle();
  if (readError) return { ok: false, error: `일정을 읽지 못했어요: ${readError.message}` };
  if (!data) {
    revalidatePath('/calendar');
    return { ok: true };
  }
  const before = data as CalendarEventRow;
  const origin = calendarEventOrigin(rowToCalendarEvent(before));
  if (origin === 'broken') return { ok: false, error: MSG_BROKEN_DELETE };
  if (origin === 'locked') return { ok: false, error: '네이버에서 복사된 일정이라 앱에서 못 지워요 — 네이버에서 지워 주세요.' };
  if (origin === 'naver') return deleteNaverOriginEvent(before, opts);

  // 앱에서 만든 일정 — 예전처럼 네이버 삭제가 실패해도 앱에서는 지움(경고). 반복 일정으로 바뀌었으면 안 지움.
  let naverWarning: string | null = null;
  if (before.calendar_id && isNaverCalDavConfigured()) {
    try {
      await deleteAppEventFromNaver(before.calendar_id, `it-${id}`);
    } catch (err) {
      if (err instanceof NaverRecurringError) {
        return { ok: false, error: '네이버에서 반복 일정으로 바뀐 일정이라 앱에서 못 지워요 — 네이버에서 지워 주세요.' };
      }
      console.error('[calendar] deleteEvent 실패(네이버):', id, err);
      naverWarning = naverFailReason(err);
    }
  }

  const { error } = await supabase.from(CALENDAR_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[calendar] deleteEvent 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  revalidatePath('/calendar');
  return naverWarning ? { ok: true, naverWarning } : { ok: true };
}

/**
 * 네이버에서 만든 원본 지우기: 주소 찾기 → 원문 읽기 → 반복이면 거절 → 제목·날짜가 앱 줄과 같은지 →
 * If-Match DELETE → 상태 표 줄 삭제 → 앱 줄 삭제. 네이버에서 못 지우면 앱도 안 지움(앱만 지우면 원본이 되살아남).
 * 앱 줄 삭제가 실패하면 상태 표 줄을 되돌려 다시 [삭제]할 수 있게 함. 감사 기록은 새 표 없이 서버 로그로.
 */
async function deleteNaverOriginEvent(before: CalendarEventRow, opts: { confirmNaverDelete?: boolean; actor?: string }): Promise<ActionResult> {
  const id = before.id;
  if (opts.confirmNaverDelete !== true) {
    return { ok: false, error: '네이버에서 만든 일정은 네이버 원본도 지워져서 한 번 더 확인이 필요해요 — 화면에서 다시 지워 주세요.' };
  }
  if (!isNaverCalDavConfigured()) return { ok: false, error: MSG_NO_CALDAV };
  if (!before.calendar_id) return { ok: false, error: MSG_NO_NAVER_CAL };
  const naverUid = before.naver_uid as string;
  const loc = await findNaverState(naverUid, before.calendar_id, '지워');
  if (!loc.ok) return { ok: false, error: loc.error };
  const state = loc.row;

  let alreadyGone = false;
  try {
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      const cur = await readEventByHref(state.href);
      if (!cur) {
        alreadyGone = true;
        break;
      }
      if (isRecurringIcs(cur.ics)) return { ok: false, error: MSG_RECURRING_DELETE };
      if (!cur.etag) return { ok: false, error: MSG_NO_ETAG_DELETE };
      const parsed = parseEventBlock(cur.ics);
      if (!parsed || parsed.uid !== naverUid.split('#')[0]) {
        return { ok: false, error: '네이버 주소의 일정이 이 일정과 달라요 — 새로고침한 뒤 다시 해 주세요.' };
      }
      const diff = [!sameIcsText(parsed.title, before.title) && '제목', parsed.date !== before.date && '날짜'].filter(Boolean);
      if (diff.length) {
        return { ok: false, error: `네이버에서 그 사이 바뀐 일정이에요(${diff.join('·')}) — 새로고침해서 확인한 뒤 다시 지워 주세요.` };
      }
      const r = await deleteEventByHref(state.href, cur.etag);
      if (r === 'gone') alreadyGone = true;
      done = r !== 'conflict';
    }
    if (!done && !alreadyGone) {
      return { ok: false, error: '다른 사람이 동시에 고치고 있어서 네이버에서 못 지웠어요 — 잠시 뒤 다시 해 주세요. 앱에서도 안 지웠어요.' };
    }
  } catch (err) {
    console.error('[calendar] 네이버 원본 삭제 실패:', id, state.href, err);
    return { ok: false, error: `네이버에서 못 지워서 앱에서도 안 지웠어요(${naverFailReason(err)}) — 잠시 뒤 다시 해 주세요.` };
  }

  console.log(
    '[calendar] 네이버 원본 삭제',
    JSON.stringify({
      actor: (opts.actor ?? '').trim().slice(0, 40) || '(이름 없음)',
      at: new Date().toISOString(),
      eventId: id,
      title: before.title,
      date: before.date,
      calendarId: before.calendar_id,
      href: state.href,
      alreadyGone,
    }),
  );

  const supabase = createAdminClient();
  const { error: stateError } = await supabase.from(SYNC_STATE_TABLE).delete().eq('href', state.href);
  if (stateError) {
    console.error('[calendar] 동기화 기록 삭제 실패:', state.href, stateError);
    return { ok: false, error: `네이버에서는 지웠지만 동기화 기록을 못 지웠어요(${stateError.message}) — 다시 [삭제]를 눌러 주세요.` };
  }
  const { error: deleteError } = await supabase.from(CALENDAR_TABLE).delete().eq('id', id);
  if (deleteError) {
    console.error('[calendar] 네이버 원본은 지웠지만 앱 줄 삭제 실패:', id, deleteError);
    // 다시 [삭제]할 때 주소를 찾을 수 있게 상태 표 줄을 원래대로
    const { error: restoreError } = await supabase.from(SYNC_STATE_TABLE).upsert(state, { onConflict: 'href' });
    if (restoreError) console.error('[calendar] 동기화 기록 되돌리기 실패:', state.href, restoreError);
    return {
      ok: false,
      error: `네이버에서는 지웠지만 앱 줄을 못 지웠어요(${deleteError.message}) — 다시 [삭제]를 눌러 주세요.${restoreError ? ' (동기화 기록 되돌리기도 실패 — 개발 담당에게 알려 주세요)' : ''}`,
    };
  }
  revalidatePath('/calendar');
  return alreadyGone ? { ok: true, warning: '네이버에서는 이미 지워져 있었어요 — 앱에서도 지웠어요.' } : { ok: true };
}

// ── 연결된 네이버 캘린더 관리 ──────────────────────────────────────

export async function listConnectedCalendars(): Promise<NaverCalendarConnection[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(NAVER_CALENDARS_TABLE).select('id,name,enabled').order('created_at', { ascending: true });
  if (error) {
    console.error('[calendar] listConnectedCalendars 실패:', error);
    return [];
  }
  return ((data ?? []) as NaverCalendarConnectionRow[]).map(rowToNaverCalendarConnection);
}

export type NaverCalendarOption = { id: string; name: string };

/** "+ 캘린더 추가" 모달의 선택지 — 이 네이버 계정이 볼 수 있는 전체 캘린더 목록. */
export async function listAvailableNaverCalendars(): Promise<{ ok: true; calendars: NaverCalendarOption[] } | { ok: false; error: string }> {
  if (!isNaverCalDavConfigured()) return { ok: false, error: '네이버 CalDAV 연동이 아직 설정되지 않았어요.' };
  try {
    const calendars = await naverListCalendars();
    return { ok: true, calendars };
  } catch (err) {
    console.error('[calendar] listAvailableNaverCalendars 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : '캘린더 목록을 가져오지 못했어요.' };
  }
}

export async function addConnectedCalendar(id: string, name: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(NAVER_CALENDARS_TABLE).upsert({ id, name, enabled: true }, { onConflict: 'id' });
  if (error) {
    console.error('[calendar] addConnectedCalendar 실패:', error);
    return { ok: false, error: toMessage(error) };
  }
  revalidatePath('/calendar');
  return { ok: true };
}

export async function removeConnectedCalendar(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(NAVER_CALENDARS_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[calendar] removeConnectedCalendar 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }
  revalidatePath('/calendar');
  return { ok: true };
}
