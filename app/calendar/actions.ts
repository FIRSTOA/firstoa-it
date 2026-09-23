'use server';

import { revalidatePath } from 'next/cache';
import {
  buildIcal,
  deleteEvent as naverDeleteEvent,
  getEvent as naverGetEvent,
  isNaverCalDavConfigured,
  listCalendars as naverListCalendars,
  mergeUpdate,
  putEvent as naverPutEvent,
} from '@/lib/naverCaldav';
import {
  calendarEventInputToRow,
  rowToCalendarEvent,
  rowToNaverCalendarConnection,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventRow,
  type NaverCalendarConnection,
  type NaverCalendarConnectionRow,
} from '@/lib/calendar';
import { CALENDAR_TABLE, createAdminClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

const NAVER_CALENDARS_TABLE = 'it_naver_calendars';

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
 * 네이버 반영은 최선노력입니다 — Supabase 쓰기가 이 앱의 기준값이고, 실패해도 사용자에게
 * 보이는 결과(로컬 저장 성공)는 바뀌지 않습니다. lib/inventory/movements.ts의
 * logAssetMovement와 동일한 원칙.
 */
async function syncToNaverBestEffort(fn: () => Promise<void>, label: string): Promise<void> {
  if (!isNaverCalDavConfigured()) return;
  try {
    await fn();
  } catch (err) {
    console.error(`[calendar] ${label} 실패(네이버):`, err);
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

export async function createEvent(input: CalendarEventInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { data, error } = await supabase.from(CALENDAR_TABLE).insert(calendarEventInputToRow(input)).select().single();
  if (error) {
    console.error('[calendar] createEvent 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  const id = (data as CalendarEventRow).id;
  if (input.calendarId) {
    await syncToNaverBestEffort(async () => {
      const uid = `it-${id}`;
      const ical = buildIcal({ uid, title: input.title, date: input.date, time: input.time, location: input.location, description: input.description });
      await naverPutEvent(input.calendarId as string, uid, ical);
      await supabase.from(CALENDAR_TABLE).update({ naver_uid: uid, naver_synced_at: new Date().toISOString() }).eq('id', id);
    }, 'createEvent');
  }

  revalidatePath('/calendar');
  return { ok: true };
}

export async function updateEvent(id: string, input: CalendarEventInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { data: beforeData } = await supabase.from(CALENDAR_TABLE).select('*').eq('id', id).maybeSingle();
  const prevCalendarId = (beforeData as CalendarEventRow | null)?.calendar_id ?? null;

  const { error } = await supabase.from(CALENDAR_TABLE).update(calendarEventInputToRow(input)).eq('id', id);
  if (error) {
    console.error('[calendar] updateEvent 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  await syncToNaverBestEffort(async () => {
    const uid = `it-${id}`;
    // 연결된 캘린더가 바뀌었으면 예전 캘린더에서는 지웁니다.
    if (prevCalendarId && prevCalendarId !== input.calendarId) {
      await naverDeleteEvent(prevCalendarId, uid);
    }
    if (input.calendarId) {
      const patch = { uid, title: input.title, date: input.date, time: input.time, location: input.location, description: input.description };
      const existing = prevCalendarId === input.calendarId ? await naverGetEvent(input.calendarId, uid) : null;
      const ical = existing ? mergeUpdate(existing, patch) : buildIcal(patch);
      await naverPutEvent(input.calendarId, uid, ical);
      await supabase.from(CALENDAR_TABLE).update({ naver_uid: uid, naver_synced_at: new Date().toISOString() }).eq('id', id);
    }
  }, 'updateEvent');

  revalidatePath('/calendar');
  return { ok: true };
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data } = await supabase.from(CALENDAR_TABLE).select('*').eq('id', id).maybeSingle();
  const calendarId = (data as CalendarEventRow | null)?.calendar_id ?? null;

  if (calendarId) {
    await syncToNaverBestEffort(() => naverDeleteEvent(calendarId, `it-${id}`), 'deleteEvent');
  }

  const { error } = await supabase.from(CALENDAR_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[calendar] deleteEvent 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  revalidatePath('/calendar');
  return { ok: true };
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
