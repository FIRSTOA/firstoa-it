/**
 * 영업 확인서 ↔ "같은 건으로 보이는 출고 준비 일정" (설계 §3-7, D8 — 보여 주기만, DB 에 연결을 저장하지 않음, 매번 계산).
 * 순수 함수(import 는 regionSlot·salesForm/confirm 만) — Node 로 바로 돌려 봄.
 *
 * 같은 건 = 아래 전부:
 *   ① 상호: 일정 제목의 거래처(부르는 쪽이 parseEventTitle 로 뽑아 넘김)와 확인서 상호가 정규화해서 같음
 *      (공백·기호·㈜·(주)·주식회사 등 뗌, 소문자). 통째로 같거나, '-' 앞(상호-현장명의 상호)끼리 같음(그때 exactCompany false)
 *   ② 날짜: 납품/교체일과 일정 날짜 차 ≤ 3일
 *   ③ 구분: 확인서 구분(납품·교체·유지보수)과 일정 제목의 구분 칸이 같음(확인서 구분이 그 밖이면 안 봄)
 *   ④ 지역: 일정 시작 시각 → 지역(regionFromEventTime — 9시 A·12시 B·15시 C·18시 D·21시 E)과 확인서 지역이 같음
 *      — **둘 다 있을 때만**(종일·다른 시각 일정이나 지역 모르는 확인서는 안 봄)
 */
import { regionFromEventTime } from './regionSlot';
import { regionOf } from './salesForm/confirm';

export interface PrepEventCandidate {
  id: string;
  /** 'YYYY-MM-DD' (it_calendar_events.date) */
  date: string;
  /** 'HH:MM' 또는 ''(종일) — it_calendar_events.time */
  time: string;
  title: string;
  /** 제목에서 뽑은 거래처(parseEventTitle(title).company — 못 뽑으면 '') */
  company: string;
}

export interface PrepMatchConfirm {
  company: string;
  /** 'YYYY-MM-DD' | null */
  deliveryDate: string | null;
  /** 영업 구분('납품'|'교체'|'유지보수'|…) */
  type: string;
  /** 확인서 지역(영업 값, 비었으면 주소 추정값 — regionWithGuess) */
  region: string | null;
}

export interface PrepMatch {
  event: PrepEventCandidate;
  /** 날짜 차(일, 절댓값) */
  dayDiff: number;
  /** 상호가 통째로 같음(false = '-' 앞 상호만 같음) */
  exactCompany: boolean;
  /** 일정 시각으로 본 지역(모르면 null) */
  eventRegion: string | null;
}

/** 상호 정규화 — NFKC·소문자, ㈜·(주)·주식회사·(유)·유한회사 등과 공백·기호 뗌 */
export function normCompanyName(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(\s*주\s*\)|\(\s*유\s*\)|\(\s*사\s*\)|\(\s*재\s*\)|주식회사|유한회사|유한책임회사/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** '상호-현장명' 의 상호 부분(정규화). '-' 가 없으면 전체 */
export function companyBase(s: string | null | undefined): string {
  const raw = String(s ?? '').normalize('NFKC');
  const cut = raw.split(/\s*[-–—]\s*/)[0] ?? raw;
  return normCompanyName(cut);
}

/** 확인서 구분 → 비교용(납품·교체·유지보수), 그 밖은 null(구분을 안 봄) */
export function confirmKindOf(type: string | null | undefined): '납품' | '교체' | '유지보수' | null {
  const t = String(type ?? '');
  if (/교체/.test(t)) return '교체';
  if (/유지보수/.test(t)) return '유지보수';
  if (/납품/.test(t)) return '납품';
  return null;
}

/**
 * 일정 제목의 구분 — '/' 로 나눈 칸 중 구분 칸(납품|교체|철수|회수|유지보수, 뒤에 (현장) 같은 괄호 허용)을 먼저 보고,
 * 없으면 제목 글자(교체 → 교체, 철수·회수 → 철수, 유지보수 → 유지보수, 그 밖 → 납품 — shipmentPrep eventKindOf 와 같은 기본값).
 */
export function eventKindOfTitle(title: string | null | undefined): '납품' | '교체' | '철수' | '유지보수' {
  const t = String(title ?? '');
  for (const part of t.split('/').map((p) => p.trim())) {
    const m = /^(납품|교체|철수|회수|유지보수)(\([^)]*\))?$/.exec(part);
    if (m) return m[1] === '회수' ? '철수' : (m[1] as '납품' | '교체' | '철수' | '유지보수');
  }
  if (t.includes('철수') || t.includes('회수')) return '철수';
  if (t.includes('교체')) return '교체';
  if (t.includes('유지보수')) return '유지보수';
  return '납품';
}

/** 확인서 지역 — 영업 값, 비었으면 주소로 추정(영업 웹앱과 같은 regionOf). guessed = 추정값 */
export function regionWithGuess(region: string | null | undefined, address: string | null | undefined): { region: string; guessed: boolean } {
  const r = String(region ?? '').trim();
  if (r) return { region: r, guessed: false };
  const g = regionOf(String(address ?? ''));
  return g ? { region: g, guessed: true } : { region: '', guessed: false };
}

const ymdMs = (ymd: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? '').slice(0, 10));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};

/** 같은 건으로 보이는 일정 — 상호 통째로 같은 것 먼저, 그다음 날짜 가까운 순, 시각 순 */
export function matchPrepEvents(confirm: PrepMatchConfirm, events: readonly PrepEventCandidate[], maxDays = 3): PrepMatch[] {
  const base = confirm.deliveryDate ? ymdMs(confirm.deliveryDate) : null;
  if (base === null) return [];
  const full = normCompanyName(confirm.company);
  const short = companyBase(confirm.company);
  if (!full) return [];
  const kind = confirmKindOf(confirm.type);
  const region = String(confirm.region ?? '').trim();
  const out: PrepMatch[] = [];
  for (const ev of events) {
    const d = ymdMs(ev.date);
    if (d === null) continue;
    const dayDiff = Math.abs(Math.round((d - base) / 86_400_000));
    if (dayDiff > maxDays) continue;
    const evFull = normCompanyName(ev.company);
    if (!evFull) continue;
    const exactCompany = evFull === full;
    const evShort = companyBase(ev.company);
    if (!exactCompany && !(short.length >= 2 && evShort === short)) continue;
    if (kind && eventKindOfTitle(ev.title) !== kind) continue;
    const eventRegion = regionFromEventTime(ev.time || null);
    if (region && eventRegion && region !== eventRegion) continue;
    out.push({ event: ev, dayDiff, exactCompany, eventRegion });
  }
  return out.sort(
    (a, b) =>
      Number(b.exactCompany) - Number(a.exactCompany) ||
      a.dayDiff - b.dayDiff ||
      String(a.event.time).localeCompare(String(b.event.time)) ||
      a.event.id.localeCompare(b.event.id),
  );
}
