import 'server-only';

import { createEvent, updateEvent } from '@/app/calendar/actions';
import { rowToCalendarEvent, type CalendarEventRow } from '@/lib/calendar';
import { toKstDateKey } from '@/lib/stocktake';
import { CALENDAR_TABLE, createAdminClient, RECEIVING_TABLE } from '@/lib/supabase/server';

/**
 * 수리입고예정 건을 등록하면(경로 상관없이 전부 — app/receiving/actions.ts의 createReceiving,
 * app/actions.ts의 requestRepair) 통합캘린더에 "IT접수/익일통합" 일정을 내일 날짜로 자동으로
 * 만듭니다 — 연결된 네이버 캘린더가 있으면 거기도 반영됩니다(app/calendar/actions.ts의
 * createEvent를 그대로 재사용 — 네이버 푸시 로직 중복 없음). 건마다 따로 일정을 만듭니다
 * (같은 날 여러 건이어도 하나로 합치지 않음).
 *
 * app/actions.ts와 app/receiving/actions.ts가 서로를 import하는 순환 참조를 피하려고
 * 이 공용 로직을 lib로 분리했습니다. best-effort입니다 — 실패해도 입고 등록 자체는
 * 막지 않고 로그만 남깁니다.
 */
export async function scheduleRepairCalendarEvent(
  receivingId: string,
  info: { category: string; model: string; assetId: string; vendor: string; manager: string; notes: string },
): Promise<void> {
  try {
    const supabase = createAdminClient();
    // "익일통합" 전용으로 이미 연결해둔 네이버 캘린더가 있으면 그걸 정확히 골라 씁니다 —
    // 아무 캘린더나(연결 순서상 처음 것) 쓰면 안 되고, 이름에 "익일통합"이 들어간 캘린더가
    // 바로 그 용도입니다(없으면 app 전용으로 저장만 하고 네이버 푸시는 건너뜀).
    const { data: calendars } = await supabase.from('it_naver_calendars').select('id,name');
    const target = ((calendars ?? []) as { id: string; name: string }[]).find((c) => c.name.includes('익일통합'));
    const calendarId = target?.id ?? null;

    const tomorrow = toKstDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    const title = `IT접수/익일통합/${info.category}/${info.model || info.assetId || '수리'}`.trim();
    const descriptionLines = [`자산번호: ${info.assetId || '-'}`, `품목: ${info.category} ${info.model}`.trim()];
    if (info.vendor.trim()) descriptionLines.push(`수리업체: ${info.vendor.trim()}`);
    if (info.notes.trim()) descriptionLines.push(info.notes.trim());

    const result = await createEvent({
      title,
      date: tomorrow,
      time: '',
      location: info.vendor.trim(),
      description: descriptionLines.join('\n'),
      status: '진행중',
      author: info.manager,
      important: false,
      items: info.assetId ? [{ category: info.category, model: info.model, quantity: 1, assetId: info.assetId, note: '수리입고' }] : [],
      calendarId,
    });
    if ('id' in result) {
      await supabase.from(RECEIVING_TABLE).update({ calendar_event_id: result.id }).eq('id', receivingId);
    } else {
      console.error('[repairCalendar] scheduleRepairCalendarEvent 일정 생성 실패:', result.error);
    }
  } catch (err) {
    console.error('[repairCalendar] scheduleRepairCalendarEvent 실패:', err);
  }
}

/** 수리입고 완료 처리 시, 연결된 통합캘린더 일정을 완료로 바꿉니다(네이버 쪽도 기존 updateEvent 로직으로 같이 반영). */
export async function markRepairCalendarEventComplete(calendarEventId: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from(CALENDAR_TABLE).select('*').eq('id', calendarEventId).maybeSingle();
    if (!data) return;
    const ev = rowToCalendarEvent(data as CalendarEventRow);
    if (ev.status === '완료') return;
    await updateEvent(calendarEventId, {
      title: ev.title,
      date: ev.date,
      time: ev.time,
      location: ev.location,
      description: ev.description,
      status: '완료',
      author: ev.author,
      important: ev.important,
      items: ev.items,
      calendarId: ev.calendarId,
    });
  } catch (err) {
    console.error('[repairCalendar] markRepairCalendarEventComplete 실패:', err);
  }
}
