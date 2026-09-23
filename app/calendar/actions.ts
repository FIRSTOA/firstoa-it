'use server';

import { revalidatePath } from 'next/cache';
import { calendarEventInputToRow, rowToCalendarEvent, type CalendarEvent, type CalendarEventInput, type CalendarEventRow } from '@/lib/calendar';
import { CALENDAR_TABLE, createAdminClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

function validate(input: CalendarEventInput): string | null {
  if (!input.title.trim()) return '제목은 필수예요.';
  if (!input.date.trim()) return '날짜는 필수예요.';
  return null;
}

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === '42P01') return '테이블이 없어요. supabase/calendar_schema.sql 을 먼저 실행하세요.';
  return `저장에 실패했어요: ${error.message}`;
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
  const { error } = await supabase.from(CALENDAR_TABLE).insert(calendarEventInputToRow(input));
  if (error) {
    console.error('[calendar] createEvent 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/calendar');
  return { ok: true };
}

export async function updateEvent(id: string, input: CalendarEventInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from(CALENDAR_TABLE).update(calendarEventInputToRow(input)).eq('id', id);
  if (error) {
    console.error('[calendar] updateEvent 실패:', error);
    return { ok: false, error: toMessage(error) };
  }

  revalidatePath('/calendar');
  return { ok: true };
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(CALENDAR_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[calendar] deleteEvent 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }

  revalidatePath('/calendar');
  return { ok: true };
}
