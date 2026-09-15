/**
 * "스프레드시트 열기" 버튼의 주소를 한 곳에서만 계산합니다 (컴포넌트에 주소를 직접 적지 않음).
 * server-only는 아닙니다 — 값 자체(스프레드시트 URL)는 민감정보가 아니라서, 서버 컴포넌트가
 * 계산해서 prop으로 클라이언트에 내려주는 값의 타입/검증 로직을 클라이언트에서도 재사용합니다.
 */

const ALLOWED_HOST = 'docs.google.com';

/**
 * INVENTORY_SPREADSHEET_URL 을 명시적으로 넣어두면 그 값을 그대로 쓰고,
 * 없으면 이미 설정된 GOOGLE_INVENTORY_SHEET_ID(재고 5개 시트가 있는 워크북)로부터 유도합니다.
 * 서버 컴포넌트(app/page.tsx)에서만 호출하세요 — env 값을 직접 읽습니다.
 */
export function getInventorySpreadsheetUrl(): string | null {
  const explicit = process.env.INVENTORY_SPREADSHEET_URL;
  if (explicit) return isSafeSpreadsheetUrl(explicit) ? explicit : null;

  const sheetId = process.env.GOOGLE_INVENTORY_SHEET_ID || process.env.GOOGLE_RENTAL_SHEET_ID;
  if (!sheetId) return null;
  const derived = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  return isSafeSpreadsheetUrl(derived) ? derived : null;
}

/** javascript:, data: 같은 위험한 스킴을 걸러내고, https://docs.google.com 만 허용합니다. */
export function isSafeSpreadsheetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}
