/**
 * 통합캘린더 — IT팀 업무 일정. Phase 1(이 파일)은 네이버 연동과 무관하게 앱 안의 캘린더
 * 자체를 다룹니다. naver_uid 등 Phase 2용 필드는 타입에는 있지만 Phase 1에서는 항상 비어있음.
 */

export const CALENDAR_STATUSES = ['진행중', '완료'] as const;

/**
 * "납품철수교체휴가교육" 같은 네이버 캘린더는 일정 제목에 "철수(일반)/퍼스트/..." 처럼 유형이
 * 앞에 붙어 있어서, 별도 필드 없이 제목 텍스트에서 유형을 뽑아 필터링할 수 있게 합니다.
 * 제목 어디에 있든(괄호 앞뒤 상관없이) 해당 단어가 포함되면 그 유형으로 봅니다.
 */
export const CALENDAR_EVENT_KINDS = ['납품', '교체', '철수', '휴가', '교육'] as const;

export function parseEventKind(title: string): string | null {
  return CALENDAR_EVENT_KINDS.find((k) => title.includes(k)) ?? null;
}

/** 제목에 "IT"가 독립 토큰으로 들어있는지(예: "★IT/위탁납품(일반)/...") — 네이버 캘린더 하나에
 * 여러 부서 일정이 섞여 있어서, 제목 기준으로 IT 관련 일정만 따로 걸러볼 때 씁니다. */
export function isITEvent(title: string): boolean {
  return /\bIT\b/.test(title);
}

/** 연결된 캘린더마다 다른 색으로 보여주기 위한 팔레트 칸 수 — app/globals.css의 .calendar-cal-0~N과 짝. */
export const CALENDAR_COLOR_COUNT = 8;

/**
 * calendarId가 연결된 캘린더 목록(calendarIds, listConnectedCalendars가 created_at 순으로 줌)
 * 안에서 몇 번째인지로 색 인덱스를 결정합니다 — 연결 순서가 바뀌지 않는 한 같은 캘린더는
 * 항상 같은 색을 유지합니다. 연결이 끊겼거나(calendarId가 null) 목록에 없으면 null.
 */
export function calendarColorIndex(calendarId: string | null | undefined, calendarIds: string[]): number | null {
  if (!calendarId) return null;
  const idx = calendarIds.indexOf(calendarId);
  return idx < 0 ? null : idx % CALENDAR_COLOR_COUNT;
}

export type CalendarEventItem = {
  category: string;
  model: string;
  quantity: number;
  assetId: string;
  note: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // 'HH:MM', 빈 값이면 종일
  location: string;
  description: string;
  status: string;
  author: string;
  important: boolean;
  items: CalendarEventItem[];
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
  important: boolean;
  items: CalendarEventItem[];
  naver_uid: string | null;
  source: string;
  calendar_id: string | null;
  /** 네이버에 마지막으로 맞춘 때 — 앱 일정은 반영이 실패하면 null 로 둬서 다음 [저장] 때 다시 맞춤 */
  naver_synced_at?: string | null;
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
    important: row.important,
    items: row.items ?? [],
    naverUid: row.naver_uid,
    source: row.source,
    calendarId: row.calendar_id,
  };
}

export type CalendarEventInput = Omit<CalendarEvent, 'id' | 'naverUid' | 'source'>;

/**
 * 일정이 어디서 왔는지 — 앱 수정·삭제가 네이버의 어느 리소스를 고칠지 가름(app/calendar/actions.ts).
 * - app: 앱에서 만든 일정(네이버에는 it-<id>.ics 로 올림)
 * - naver: 네이버에서 만든 원본(naver_uid = 네이버 UID) — 주소+If-Match 로 바뀐 칸만, 날짜·시간·캘린더는 잠금
 * - broken: 예전 버그로 naver_uid 가 it-<자기 id> 로 덮어써진 네이버 일정(네이버에 복제본이 있음) — 정리 전엔 네이버 쪽 안 고침
 * - locked: 그 밖의 네이버 줄(예: 네이버에서 복사된 앱 일정 it-…#…) — 네이버 쪽 안 고침
 */
export type CalendarOrigin = 'app' | 'naver' | 'broken' | 'locked';

export function calendarEventOrigin(ev: Pick<CalendarEvent, 'id' | 'source' | 'naverUid'>): CalendarOrigin {
  if (ev.source !== 'naver') return 'app';
  if (ev.naverUid && !ev.naverUid.startsWith('it-')) return 'naver';
  if (ev.naverUid === `it-${ev.id}`) return 'broken';
  return 'locked';
}

export function calendarEventInputToRow(input: CalendarEventInput) {
  return {
    title: input.title,
    date: input.date,
    time: input.time,
    location: input.location,
    description: input.description,
    status: input.status,
    author: input.author,
    important: input.important,
    items: input.items,
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
