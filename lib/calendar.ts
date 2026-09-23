/**
 * 통합캘린더 — IT팀 업무 일정. Phase 1(이 파일)은 네이버 연동과 무관하게 앱 안의 캘린더
 * 자체를 다룹니다. naver_uid 등 Phase 2용 필드는 타입에는 있지만 Phase 1에서는 항상 비어있음.
 */

export const CALENDAR_STATUSES = ['진행중', '완료'] as const;

export type CalendarEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // 'HH:MM', 빈 값이면 종일
  location: string;
  description: string;
  status: string;
  author: string;
  naverUid: string | null;
  source: string;
  calendarId: string | null; // 연결된 네이버 캘린더 ID (Phase 2, 없으면 동기화 안 됨)
};

export type CalendarEventRow = {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
  status: string;
  author: string;
  naver_uid: string | null;
  source: string;
  calendar_id: string | null;
};

export function rowToCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    time: row.time,
    location: row.location,
    description: row.description,
    status: row.status,
    author: row.author,
    naverUid: row.naver_uid,
    source: row.source,
    calendarId: row.calendar_id,
  };
}

export type CalendarEventInput = Omit<CalendarEvent, 'id' | 'naverUid' | 'source'>;

export function calendarEventInputToRow(input: CalendarEventInput) {
  return {
    title: input.title,
    date: input.date,
    time: input.time,
    location: input.location,
    description: input.description,
    status: input.status,
    author: input.author,
    calendar_id: input.calendarId,
  };
}

export type NaverCalendarConnection = {
  id: string;
  name: string;
  enabled: boolean;
};

export type NaverCalendarConnectionRow = {
  id: string;
  name: string;
  enabled: boolean;
};

export function rowToNaverCalendarConnection(row: NaverCalendarConnectionRow): NaverCalendarConnection {
  return { id: row.id, name: row.name, enabled: row.enabled };
}

/** 달력 그리드(일요일 시작, 6주 고정)를 채울 날짜 범위 — 월 앞뒤로 삐져나온 날짜도 포함합니다. */
export function monthGridRange(year: number, month: number): { start: Date; end: Date } {
  const firstOfMonth = new Date(year, month - 1, 1);
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 41); // 6주(42일) - 1
  return { start, end };
}

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  }
  return map;
}
