/**
 * 네이버 CalDAV 일정 원문(iCalendar) 다루기 — 순수 함수(import 없음, Node 로 바로 돌려 볼 수 있음).
 * 출고 준비 제목 태그(rewriteSummaryTags)와 통합 캘린더 수정(patchEventProps)이 같은 "첫 VEVENT 안의
 * 줄 찾기(알림 VALARM 안 줄은 건너뜀)"를 씁니다. 바꾸는 줄 말고는 글자 하나 안 건드리는 게 원칙 —
 * 네이버 원본은 다른 팀과 같이 쓰는 일정이라 알림·반복·참석자·네이버 고유 속성을 그대로 둬야 해서.
 */

export function icalEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unescapeIcsText = (s: string) =>
  s.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();

/** RFC 5545 줄 접기 · 75바이트 단위(한글이 잘리지 않게 글자 단위). */
export function foldLine(line: string, nl: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) {
      out.push(cur);
      cur = ' ' + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join(nl);
}

// ── 줄 찾기 ─────────────────────────────────────────────────────

/** 접기 푼 한 줄(논리 줄)과 원문에서의 위치. */
type IcsLine = {
  /** 줄 시작 */
  start: number;
  /** 내용 끝(줄바꿈 앞) — 접힌 연속 줄(공백/탭으로 시작)까지 포함 */
  end: number;
  /** 다음 줄 시작(줄바꿈 뒤) */
  next: number;
  /** 접기 푼 내용 */
  text: string;
};

type IcsProp = IcsLine & {
  /** 대문자 이름(비교용) */
  name: string;
  /** 원문 그대로의 이름 */
  nameRaw: string;
  /** 매개변수 원문(앞의 ";" 포함, 없으면 "") — 예: ";LANGUAGE=ko" */
  params: string;
  /** 값 원문(이스케이프 그대로) */
  value: string;
};

function logicalLines(ics: string): IcsLine[] {
  const out: IcsLine[] = [];
  let start = 0;
  while (start < ics.length) {
    let pos = start;
    let end = ics.length;
    let next = ics.length;
    for (;;) {
      const nl = ics.indexOf('\n', pos);
      if (nl < 0) break;
      const contentEnd = nl - 1 >= pos && ics[nl - 1] === '\r' ? nl - 1 : nl;
      const after = nl + 1;
      if (after < ics.length && (ics[after] === ' ' || ics[after] === '\t')) {
        pos = after;
        continue;
      }
      end = contentEnd;
      next = after;
      break;
    }
    out.push({ start, end, next, text: ics.slice(start, end).replace(/\r?\n[ \t]/g, '') });
    start = next;
  }
  return out;
}

function splitProp(line: IcsLine): IcsProp | null {
  const t = line.text;
  let i = 0;
  while (i < t.length && t[i] !== ';' && t[i] !== ':') i++;
  if (i >= t.length || i === 0) return null;
  let j = i;
  let quoted = false;
  while (j < t.length) {
    const c = t[j];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
    j++;
  }
  if (j >= t.length) return null;
  const nameRaw = t.slice(0, i);
  return { ...line, name: nameRaw.toUpperCase(), nameRaw, params: t.slice(i, j), value: t.slice(j + 1) };
}

/** 첫 VEVENT 의 속성 줄(알림 VALARM 등 안쪽 블록의 줄은 뺌)과 END:VEVENT 줄. 없으면 null. */
function scanFirstEvent(ics: string): { props: IcsProp[]; end: IcsLine } | null {
  let inEvent = false;
  let depth = 0;
  const props: IcsProp[] = [];
  for (const line of logicalLines(ics)) {
    const p = splitProp(line);
    if (!p) continue;
    if (!inEvent) {
      if (p.name === 'BEGIN' && p.value.trim().toUpperCase() === 'VEVENT') inEvent = true;
      continue;
    }
    if (p.name === 'BEGIN') {
      depth++;
    } else if (p.name === 'END') {
      if (depth === 0) return { props, end: line };
      depth--;
    } else if (depth === 0) {
      props.push(p);
    }
  }
  return null;
}

/**
 * 반복 일정인지 — VEVENT 가 둘 이상(반복의 예외 회차)이거나 VEVENT 안에 RRULE·RDATE·EXDATE·RECURRENCE-ID.
 * (시간대 VTIMEZONE 안의 RRULE 은 반복 일정이 아니라서 VEVENT 안만 봄.)
 */
export function isRecurringIcs(ics: string): boolean {
  let events = 0;
  let inEvent = false;
  let depth = 0;
  for (const line of logicalLines(ics)) {
    const p = splitProp(line);
    if (!p) continue;
    if (!inEvent) {
      if (p.name === 'BEGIN' && p.value.trim().toUpperCase() === 'VEVENT') {
        inEvent = true;
        depth = 0;
        events++;
        if (events > 1) return true;
      }
      continue;
    }
    if (p.name === 'BEGIN') depth++;
    else if (p.name === 'END') {
      if (depth === 0) inEvent = false;
      else depth--;
    } else if (depth === 0 && ['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID'].includes(p.name)) return true;
  }
  return false;
}

/** 앱 값과 네이버 값 비교용 — 공백·줄바꿈 차이는 같은 것으로. */
export function sameIcsText(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
}

// ── 출고 준비 태그(제목 앞 "이름준비중" 등) ─────────────────────────

/**
 * 일정 본문의 SUMMARY 줄만(알림 VALARM 안의 SUMMARY는 제외) 태그 반영해 교체합니다.
 * names에 있는 사람의 "이름오버홀/준비중/완료" 태그만 지우고 붙이므로 다른 시스템
 * (백오피스)이 붙인 자기 담당자 태그는 건드리지 않습니다. 바뀔 게 없으면 null.
 */
export function rewriteSummaryTags(ics: string, names: string[], tags: string[]): { ics: string; title: string } | null {
  const ev = scanFirstEvent(ics);
  if (!ev) throw new Error('VEVENT 없음');
  const p = ev.props.find((x) => x.name === 'SUMMARY');
  if (!p) throw new Error('일정 제목(SUMMARY) 없음');
  const value = p.value;
  const stripped = names.length
    ? value.replace(new RegExp(`(?:${names.map(escapeRe).join('|')})(?:오버홀|준비중|완료)\\s*`, 'g'), '').trimStart()
    : value;
  const next = (tags.length ? tags.join(' ') + ' ' : '') + stripped;
  if (next === value) return null;
  const nl = ics.includes('\r\n') ? '\r\n' : '\n';
  return {
    ics: ics.slice(0, p.start) + foldLine(`${p.nameRaw}${p.params}:${next}`, nl) + ics.slice(p.end),
    title: unescapeIcsText(next),
  };
}

// ── 바뀐 칸만 고치기(통합 캘린더 → 네이버) ───────────────────────────

export type EventPropPatch = {
  title?: string;
  location?: string;
  description?: string;
  completed?: boolean;
  /** 앱에서 만든 일정(it-)의 날짜·시간을 바꿀 때만 — 줄 전체(appEventTimeLines 가 만듦) */
  dtstart?: string;
  dtend?: string;
};

/**
 * 첫 VEVENT 안(VALARM 안 줄 제외)에서 patch 에 있는 칸의 줄만 바꿉니다.
 * - 이름·매개변수(SUMMARY;LANGUAGE=ko 등)와 원래 줄바꿈(CRLF/LF)은 그대로, 값은 icalEscape 후 75바이트 접기.
 * - 접힌 연속 줄까지 통째로 교체, 장소·설명을 비우면 그 줄(연속 줄 포함)을 지움, 없던 칸은 END:VEVENT 앞에 추가.
 * - patch 에 없는 칸과 나머지 줄(VALARM·RRULE·ATTENDEE·X-NAVER-*·VTIMEZONE …)은 글자 하나 안 바꿈.
 */
export function patchEventProps(ics: string, patch: EventPropPatch): string {
  const ev = scanFirstEvent(ics);
  if (!ev) throw new Error('VEVENT 없음');
  const nl = ics.includes('\r\n') ? '\r\n' : '\n';
  const edits: { at: number; to: number; text: string }[] = [];
  const inserts: string[] = [];
  const find = (name: string) => ev.props.find((p) => p.name === name);

  const setValue = (name: string, value: string | undefined, opts: { escape: boolean; removeIfEmpty: boolean }) => {
    if (value === undefined) return;
    const p = find(name);
    if (opts.removeIfEmpty && !value.trim()) {
      if (p) edits.push({ at: p.start, to: p.next, text: '' });
      return;
    }
    const v = opts.escape ? icalEscape(value) : value;
    if (p) edits.push({ at: p.start, to: p.end, text: foldLine(`${p.nameRaw}${p.params}:${v}`, nl) });
    else inserts.push(foldLine(`${name}:${v}`, nl));
  };
  const setLine = (name: string, line: string | undefined) => {
    if (line === undefined) return;
    const p = find(name);
    if (p) edits.push({ at: p.start, to: p.end, text: foldLine(line, nl) });
    else inserts.push(foldLine(line, nl));
  };

  setValue('SUMMARY', patch.title, { escape: true, removeIfEmpty: false });
  setValue('LOCATION', patch.location, { escape: true, removeIfEmpty: true });
  setValue('DESCRIPTION', patch.description, { escape: true, removeIfEmpty: true });
  setValue('X-NAVER-COMPLETED', patch.completed === undefined ? undefined : patch.completed ? 'true' : 'false', {
    escape: false,
    removeIfEmpty: false,
  });
  setLine('DTSTART', patch.dtstart);
  setLine('DTEND', patch.dtend);
  if (inserts.length) edits.push({ at: ev.end.start, to: ev.end.start, text: inserts.map((t) => t + nl).join('') });

  let out = ics;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.to);
  return out;
}

export const APP_TIME_CHANGE_REFUSED = '네이버 쪽 날짜 형식이 달라 앱에서 날짜·시간을 못 바꿔요 — 네이버에서 바꿔 주세요';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 앱에서 만든 일정(it-)의 새 날짜·시간 → DTSTART/DTEND 줄. 길이(며칠·몇 분)는 네이버에 있는 그대로 유지하고,
 * 종일↔시간 전환이면 VALUE=DATE / TZID=Asia/Seoul 로(길이는 1일 / 60분). 같은 종류면 원래 이름·매개변수 유지.
 * 네이버 쪽이 DURATION 이거나 DTEND 가 없거나 서울 시간대·날짜 형식이 아니면 바꾸지 않고 오류(APP_TIME_CHANGE_REFUSED).
 */
export function appEventTimeLines(ics: string, date: string, time: string): { dtstart: string; dtend: string } {
  const ev = scanFirstEvent(ics);
  if (!ev) throw new Error('VEVENT 없음');
  const s = ev.props.find((p) => p.name === 'DTSTART');
  const e = ev.props.find((p) => p.name === 'DTEND');
  if (!s || !e || ev.props.some((p) => p.name === 'DURATION')) throw new Error(APP_TIME_CHANGE_REFUSED);

  type Kind = { allDay: boolean; ms: number };
  const kindOf = (p: IcsProp): Kind | null => {
    const v = p.value.trim();
    const params = p.params.replace(/"/g, '');
    const ymd = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (ymd && /(^|;)VALUE=DATE(;|$)/i.test(params) && !/(^|;)TZID=/i.test(params)) {
      return { allDay: true, ms: Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]) };
    }
    const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (dt && /(^|;)TZID=Asia\/Seoul(;|$)/i.test(params)) {
      return { allDay: false, ms: Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +dt[6]) };
    }
    return null;
  };
  const oldStart = kindOf(s);
  const oldEnd = kindOf(e);
  if (!oldStart || !oldEnd || oldStart.allDay !== oldEnd.allDay) throw new Error(APP_TIME_CHANGE_REFUSED);

  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(APP_TIME_CHANGE_REFUSED);
  const newAllDay = !time;
  const sameKind = newAllDay === oldStart.allDay;
  const fmtDate = (ms: number) => {
    const t = new Date(ms);
    return `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}`;
  };
  const fmtDateTime = (ms: number) => {
    const t = new Date(ms);
    return `${fmtDate(ms)}T${pad2(t.getUTCHours())}${pad2(t.getUTCMinutes())}${pad2(t.getUTCSeconds())}`;
  };

  if (newAllDay) {
    const days = sameKind ? Math.max(1, Math.round((oldEnd.ms - oldStart.ms) / 86_400_000)) : 1;
    const start = Date.UTC(y, m - 1, d);
    const end = start + days * 86_400_000;
    return sameKind
      ? { dtstart: `${s.nameRaw}${s.params}:${fmtDate(start)}`, dtend: `${e.nameRaw}${e.params}:${fmtDate(end)}` }
      : { dtstart: `DTSTART;VALUE=DATE:${fmtDate(start)}`, dtend: `DTEND;VALUE=DATE:${fmtDate(end)}` };
  }
  const [hh, mm] = time.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) throw new Error(APP_TIME_CHANGE_REFUSED);
  const minutes = sameKind ? Math.max(1, Math.round((oldEnd.ms - oldStart.ms) / 60_000)) : 60;
  const start = Date.UTC(y, m - 1, d, hh, mm);
  const end = start + minutes * 60_000;
  return sameKind
    ? { dtstart: `${s.nameRaw}${s.params}:${fmtDateTime(start)}`, dtend: `${e.nameRaw}${e.params}:${fmtDateTime(end)}` }
    : { dtstart: `DTSTART;TZID=Asia/Seoul:${fmtDateTime(start)}`, dtend: `DTEND;TZID=Asia/Seoul:${fmtDateTime(end)}` };
}
