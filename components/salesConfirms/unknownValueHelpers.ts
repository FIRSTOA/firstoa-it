/** 값이 비었는지(문자열 공백·빈 목록·안이 다 빈 객체 포함) */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0 || v.every(isBlank);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isBlank);
  return false;
}
