import 'server-only';
import { google, type sheets_v4 } from 'googleapis';

/**
 * 임대리스트 조회(lib/rentals/server.ts)와 재고 시트 읽기/쓰기(lib/inventory/sheets.ts)가
 * 공유하는 구글 서비스계정 인증. 같은 서비스계정 키를 재사용하되, 재고 시트 쓰기가
 * 필요해져서 스코프를 읽기전용에서 읽기+쓰기로 넓혔습니다.
 */

const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

export function isGoogleServiceAccountConfigured(): boolean {
  return Boolean(SERVICE_ACCOUNT_EMAIL && SERVICE_ACCOUNT_PRIVATE_KEY);
}

let sheetsClient: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error('Google 서비스 계정 환경변수가 없습니다.');
  }
  const auth = new google.auth.JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    // .env 파일에는 개행이 "\n" 리터럴 문자열로 들어오므로 실제 개행으로 되돌립니다.
    key: SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/** 0-based 컬럼 인덱스를 A1 표기 열 문자(A, B, ..., Z, AA, ...)로 변환 */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
