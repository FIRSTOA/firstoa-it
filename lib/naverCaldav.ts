import 'server-only';

/**
 * 통합캘린더(lib/calendar.ts) Phase 2 — 네이버 캘린더 CalDAV 클라이언트.
 *
 * 참고 저장소(FIRSTOA/FIRSTOA-inspection-finder-MG, 읽기 전용 조사)의 검증된 요청 형식을
 * 그대로 이식했습니다. CalDAV는 OAuth를 전혀 쓰지 않고, 2단계인증 앱비밀번호로 만든 Basic
 * 인증 헤더 하나로 조회/등록/수정/삭제가 전부 됩니다.
 *
 * 환경변수: NAVER_CALDAV_ID(네이버 아이디), NAVER_CALDAV_APP_PASSWORD(앱비밀번호).
 * 대상 캘린더는 고정 1개가 아니라 여러 개 연결할 수 있어서(사용자가 "+ 캘린더 추가"로
 * 직접 선택), 각 함수가 calendarId를 인자로 받습니다 — 연결된 캘린더 목록 자체는
 * lib/calendar.ts의 it_naver_calendars 테이블에 있습니다(app/calendar/actions.ts 참고).
 */

const CALDAV_BASE = 'https://caldav.calendar.naver.com';

function caldavId(): string {
  return process.env.NAVER_CALDAV_ID || '';
}
function caldavPassword(): string {
  return process.env.NAVER_CALDAV_APP_PASSWORD || '';
}

/** CalDAV 인증 정보(아이디+앱비밀번호)가 있는지만 확인합니다 — 대상 캘린더는 별개(DB에 있음). */
export function isNaverCalDavConfigured(): boolean {
  return Boolean(caldavId() && caldavPassword());
}

function authHeader(): string {
  const id = caldavId();
  const pw = caldavPassword();
  if (!id || !pw) throw new Error('NAVER_CALDAV_ID / NAVER_CALDAV_APP_PASSWORD 환경변수가 없어요.');
  return 'Basic ' + Buffer.from(`${id}:${pw}`).toString('base64');
}

function calendarUrl(calendarId: string): string {
  return `${CALDAV_BASE}/caldav/${encodeURIComponent(caldavId())}/calendar/${encodeURIComponent(calendarId)}/`;
}

function eventUrl(calendarId: string, uid: string): string {
  return `${calendarUrl(calendarId)}${encodeURIComponent(uid)}.ics`;
}

// ── iCalendar 빌드 ──────────────────────────────────────────────

export function icalEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

type IcalInput = {
  uid: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // 'HH:MM' 또는 빈 값(종일)
  location: string;
  description: string;
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 종일/시간 일정 둘 다 지원하는 VEVENT 하나짜리 VCALENDAR 문서를 만듭니다. */
export function buildIcal(input: IcalInput): string {
  const [y, m, d] = input.date.split('-').map(Number);
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  let dtstartLine: string;
  let dtendLine: string;
  if (input.time) {
    const [hh, mm] = input.time.split(':').map(Number);
    const stamp = (h: number, min: number) => `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    const endMin = mm + 60;
    dtstartLine = `DTSTART;TZID=Asia/Seoul:${stamp(hh, mm)}`;
    dtendLine = `DTEND;TZID=Asia/Seoul:${stamp(hh + Math.floor(endMin / 60), endMin % 60)}`;
  } else {
    const next = new Date(y, m - 1, d + 1);
    const nextYmd = `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
    dtstartLine = `DTSTART;VALUE=DATE:${y}${pad(m)}${pad(d)}`;
    dtendLine = `DTEND;VALUE=DATE:${nextYmd}`;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:firstoa-it',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Seoul',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZNAME:GMT+09:00',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${dtstamp}`,
    dtstartLine,
    dtendLine,
    `SUMMARY:${icalEscape(input.title)}`,
    input.location ? `LOCATION:${icalEscape(input.location)}` : '',
    input.description ? `DESCRIPTION:${icalEscape(input.description)}` : '',
    'CLASS:PUBLIC',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

// ── VEVENT 파싱 ─────────────────────────────────────────────────

export type ParsedEvent = {
  uid: string;
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
};

function eventBlockOf(ics: string): string {
  const m = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/);
  return m ? m[0] : ics;
}

function icsProp(unfolded: string, name: string): string {
  const m = unfolded.match(new RegExp(`^${name}[^:]*:(.*)$`, 'mi'));
  return m ? m[1].trim().replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';') : '';
}

/** VEVENT 블록 하나를 우리 필드로 파싱합니다. UID/DTSTART가 없으면 null. */
export function parseEventBlock(ics: string): ParsedEvent | null {
  const unfolded = eventBlockOf(ics).replace(/\r?\n[ \t]/g, ''); // RFC5545 line folding 해제
  const uid = icsProp(unfolded, 'UID');
  const dtstartRaw = unfolded.match(/^DTSTART([^:]*):(.*)$/mi);
  if (!uid || !dtstartRaw) return null;

  const params = dtstartRaw[1] || '';
  const value = dtstartRaw[2].trim();
  let date = '';
  let time = '';
  if (/^\d{8}$/.test(value)) {
    date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  } else {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
    if (!m) return null;
    if (/Z$/.test(value) && !/TZID/i.test(params)) {
      const kst = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 9 * 3600_000);
      date = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
      time = `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
    } else {
      date = `${m[1]}-${m[2]}-${m[3]}`;
      time = `${m[4]}:${m[5]}`;
    }
  }

  return {
    uid,
    title: icsProp(unfolded, 'SUMMARY'),
    date,
    time,
    location: icsProp(unfolded, 'LOCATION'),
    description: icsProp(unfolded, 'DESCRIPTION'),
  };
}

/**
 * 기존 이벤트를 부분 수정합니다. DTSTART/DTEND/SUMMARY/LOCATION/DESCRIPTION만 새 값으로
 * 바꾸고 나머지 줄(RRULE 등)은 원문 그대로 보존한 뒤, 원래 VCALENDAR 껍데기에 다시 끼워넣습니다.
 */
export function mergeUpdate(existingIcs: string, patch: IcalInput): string {
  const newEvent = buildIcal(patch).match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/)![0];
  if (/BEGIN:VEVENT[\s\S]*?END:VEVENT/.test(existingIcs)) {
    return existingIcs.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT/, newEvent);
  }
  return buildIcal(patch);
}

// ── CalDAV 요청 ─────────────────────────────────────────────────

export async function putEvent(calendarId: string, uid: string, icalBody: string): Promise<void> {
  const res = await fetch(eventUrl(calendarId, uid), {
    method: 'PUT',
    headers: { Authorization: authHeader(), 'Content-Type': 'text/calendar; charset=utf-8' },
    body: icalBody.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('CalDAV 인증 실패 — 앱비밀번호를 확인하세요.');
    throw new Error(`네이버 일정 등록/수정 실패(${res.status}): ${text.slice(0, 160)}`);
  }
}

export async function getEvent(calendarId: string, uid: string): Promise<string | null> {
  const res = await fetch(eventUrl(calendarId, uid), { headers: { Authorization: authHeader() } });
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 401) throw new Error('CalDAV 인증 실패 — 앱비밀번호를 확인하세요.');
    throw new Error(`네이버 일정 조회 실패(${res.status})`);
  }
  return res.text();
}

export async function deleteEvent(calendarId: string, uid: string): Promise<void> {
  const res = await fetch(eventUrl(calendarId, uid), {
    method: 'DELETE',
    headers: { Authorization: authHeader() },
  });
  if (!res.ok && res.status !== 404) {
    if (res.status === 401) throw new Error('CalDAV 인증 실패 — 앱비밀번호를 확인하세요.');
    throw new Error(`네이버 일정 삭제 실패(${res.status})`);
  }
}

/** 캘린더 전체의 ctag(컬렉션 지문) — 안 바뀌었으면 REPORT 자체를 생략할 수 있습니다. */
export async function fetchCtag(calendarId: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">
  <D:prop><CS:getctag/></D:prop>
</D:propfind>`;
  const res = await fetch(calendarUrl(calendarId), {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/xml; charset=utf-8', Depth: '0' },
    body,
  });
  if (!res.ok) return '';
  const xml = await res.text();
  return (xml.match(/<[^>]*getctag[^>]*>([^<]+)</i) || [])[1]?.trim() || '';
}

export type HrefEtag = { href: string; etag: string };

/** 기간 안의 일정 목록(href+etag)을 REPORT로 가져옵니다. */
export async function reportChangedEvents(calendarId: string, startYmd: string, endYmd: string): Promise<HrefEtag[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">
    <C:time-range start="${startYmd}T000000Z" end="${endYmd}T235959Z"/>
  </C:comp-filter></C:comp-filter></C:filter>
</C:calendar-query>`;
  const res = await fetch(calendarUrl(calendarId), {
    method: 'REPORT',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error('CalDAV 인증 실패 — 앱비밀번호를 확인하세요.');
    throw new Error(`네이버 캘린더 조회 실패(${res.status}): ${text.slice(0, 160)}`);
  }

  const out: HrefEtag[] = [];
  for (const block of text.match(/<[^>]*response>[\s\S]*?<\/[^>]*response>/g) || []) {
    const href = (block.match(/<[^>]*href>([^<]+)</i) || [])[1] || '';
    const etag = (block.match(/<[^>]*getetag>([^<]*)</i) || [])[1] || '';
    if (href.endsWith('.ics')) out.push({ href, etag: etag.replace(/["]/g, '').trim() });
  }
  return out;
}

/** href로 이벤트 원문을 직접 가져옵니다(REPORT 결과의 inline calendar-data는 신뢰하지 않고 별도 GET). */
export async function getEventByHref(href: string): Promise<string> {
  const res = await fetch(`${CALDAV_BASE}${href}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`네이버 일정 본문 조회 실패(${res.status})`);
  return res.text();
}

export type NaverCalendarInfo = { id: string; name: string };

/**
 * PROPFIND로 이 계정이 볼 수 있는 캘린더 목록을 가져옵니다. 최초 설정 시 대상 캘린더 ID를
 * 알아내는 용도로만 씁니다(화면 없음 — 관리용 헬퍼).
 */
export async function listCalendars(): Promise<NaverCalendarInfo[]> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/">
  <D:prop><D:displayname/><D:resourcetype/></D:prop>
</D:propfind>`;
  const res = await fetch(`${CALDAV_BASE}/caldav/${encodeURIComponent(caldavId())}/calendar/`, {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error('CalDAV 인증 실패 — 아이디/앱비밀번호를 확인하세요.');
    throw new Error(`캘린더 목록 조회 실패(${res.status}): ${text.slice(0, 200)}`);
  }

  const out: NaverCalendarInfo[] = [];
  for (const block of text.match(/<[^>]*response>[\s\S]*?<\/[^>]*response>/g) || []) {
    const isCalendar = /<[^>]*resourcetype>[\s\S]*?<[^>]*calendar\s*\/>/i.test(block);
    if (!isCalendar) continue;
    const href = (block.match(/<[^>]*href>([^<]+)</i) || [])[1] || '';
    const nameMatch = block.match(/<[^>]*displayname>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/[^>]*displayname>/i);
    const name = (nameMatch ? nameMatch[1] : '').trim();
    const segments = href.split('/').filter(Boolean);
    const id = decodeURIComponent(segments[segments.length - 1] || '');
    if (id) out.push({ id, name });
  }
  return out;
}
