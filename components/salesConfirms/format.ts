/**
 * 영업 확인서 목록 화면이 같이 쓰는 날짜·글자 도우미(순수 함수 — 서버·브라우저 어디서나).
 * 날짜는 모두 한국 시간(KST) 기준.
 */
import type { SalesConfirmStatus } from '@/lib/salesConfirms/types';

const KST_MS = 9 * 60 * 60 * 1000;
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function ymdFromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcMsFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** 한국 시간 기준 오늘 'YYYY-MM-DD' */
export function kstToday(nowMs: number = Date.now()): string {
  return ymdFromUtcMs(nowMs + KST_MS);
}

export function addDays(ymd: string, n: number): string {
  return ymdFromUtcMs(utcMsFromYmd(ymd) + n * 86_400_000);
}

/** 그 날이 든 주의 월요일~일요일 */
export function weekRange(ymd: string): { from: string; to: string } {
  const dow = new Date(utcMsFromYmd(ymd)).getUTCDay(); // 0=일
  const fromMon = dow === 0 ? -6 : 1 - dow;
  const from = addDays(ymd, fromMon);
  return { from, to: addDays(from, 6) };
}

/** '2026-11-27' → '11/27(금)'. 못 읽으면 '-' */
export function fmtDate(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '-';
  const dow = new Date(utcMsFromYmd(ymd)).getUTCDay();
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${DAY_NAMES[dow]})`;
}

/** ISO 시각 → '11/25 16:32'(한국 시간). 못 읽으면 '-' */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '-';
  const d = new Date(t + KST_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

/** '3분 전' 꼴. 모르면 '' */
export function agoText(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((nowMs - t) / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

/** 전화번호 비교용 — 숫자만 */
export function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '');
}

/** 처리여부 색(globals.css .sc-st-*) */
export function statusClass(status: SalesConfirmStatus): string {
  return `sc-st-${status}`;
}

/** 앞 n개 + "외 m" */
export function headAndMore(list: string[], n: number): string {
  if (list.length <= n) return list.join(', ');
  return `${list.slice(0, n).join(', ')} 외 ${list.length - n}`;
}
