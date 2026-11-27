/**
 * 영업 확인서 ↔ 출고 준비 일정 — 상호·지역 **정규화만**(순수, import 는 salesForm/confirm 만).
 * 짝 찾기 규칙(확실·후보·약한 후보)과 연결 상태 판정은 4-1 부터 prepLinkRules.ts 한 곳(설계 §4-B·§4-C).
 * 쓰는 곳: prepLinkRules.ts(상호 맞추기) · listQuery.ts·prepLink.ts(지역 추정).
 */
import { regionOf } from './salesForm/confirm';

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

/** 확인서 지역 — 영업 값, 비었으면 주소로 추정(영업 웹앱과 같은 regionOf). guessed = 추정값 */
export function regionWithGuess(region: string | null | undefined, address: string | null | undefined): { region: string; guessed: boolean } {
  const r = String(region ?? '').trim();
  if (r) return { region: r, guessed: false };
  const g = regionOf(String(address ?? ''));
  return g ? { region: g, guessed: true } : { region: '', guessed: false };
}
