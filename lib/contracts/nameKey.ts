/**
 * 거래처 이름·코드 정리 — import 없는 순수 함수(Node 로 바로 돌려 볼 수 있음).
 * 설계: docs/tasks/2026-11-20-contract-management.md §3-2, §3-6.
 */

const COMPANY_MARKS = /㈜|\(\s*주\s*\)|（\s*주\s*）|주식회사|\(\s*유\s*\)|（\s*유\s*）|유한회사/g;
const STRIP = /[\s·.,\-_/()（）[\]]/g;

/** 정규화 이름 — ㈜ (주) 주식회사 (유) 유한회사 제거, 공백·기호 제거, 소문자 */
export function nameKey(name: string): string {
  return String(name ?? '')
    .replace(COMPANY_MARKS, '')
    .replace(STRIP, '')
    .toLowerCase();
}

/**
 * works 거래처 코드(ecount_code) 정리 — 이카운트 10자리 숫자 또는 P숫자.
 * `_NRD(2)` 같은 꼬리는 뗌. 주민번호 꼴(숫자 13자리, 6-7 하이픈 포함)·못 알아보는 값은 '' — 저장·표시·비교에 안 씀.
 * 서버 밖으로 내보내지 않는 값.
 */
export function vendorCodeKey(raw: string | null | undefined): string {
  const compact = String(raw ?? '').replace(/[\s-]/g, '');
  if (!compact) return '';
  const base = compact.split(/[_(]/)[0];
  if (/^\d{13}$/.test(base)) return ''; // 주민번호 꼴
  if (/^P\d+$/i.test(base)) return base.toUpperCase();
  if (/^\d{10,}/.test(base)) return base.slice(0, 10);
  return '';
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 이름이 비슷한가 — 정리한 이름이 서로 포함하거나 편집거리 2 이하. 3자 미만은 비교 안 함 */
export function similarNames(a: string, b: string): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (ka.length < 3 || kb.length < 3) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  return editDistance(ka, kb) <= 2;
}
