import 'server-only';
import { getSheetsClient, isGoogleServiceAccountConfigured } from '@/lib/googleAuth';

/**
 * AS접수 구글시트("IT AS접수" 탭) 읽기 전용. AS 접수는 아직 구글시트로 받고 있어서
 * 앱에 별도 테이블 없이 조회 시점에 시트를 직접 읽습니다(약 2,500행, 5분 메모리 캐시).
 */
export const AS_SHEET_ID = process.env.GOOGLE_AS_SHEET_ID || '1nbV1F-ayOtrWaUcsC_HmnSSBTmXw_MMdgZT4dFOdIRg';
export const AS_SHEET_TAB = 'IT AS접수';
export const AS_SHEET_URL = `https://docs.google.com/spreadsheets/d/${AS_SHEET_ID}/edit#gid=585820864`;

export type AsRecord = {
  receivedDate: string; // YYYY-MM-DD (못 읽으면 원문)
  receivedTime: string;
  status: string; // 처리여부
  channel: string; // 유입경로
  receiver: string; // 접수자
  handler: string; // 처리자
  company: string; // 상호
  assetCode: string;
  modelSpec: string;
  serial: string;
  symptom: string; // 증상
  action: string; // 처리내용
  note: string; // 비고
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; records: AsRecord[] } | null = null;

const REGION_RE = /^(수도권|경상|전라|충청|강원|제주|경기|서울|인천|부산|대구|광주|대전|울산|세종)/;

// 2026년부터 "남은개월" 칸(12)이 추가돼서, 그 이전 행은 12번째부터 한 칸씩 왼쪽으로 밀려 있습니다.
function layoutOffset(row: string[]): number {
  const c12 = (row[12] ?? '').trim();
  const c13 = (row[13] ?? '').trim();
  if (REGION_RE.test(c12)) return -1;
  if (REGION_RE.test(c13)) return 0;
  if (!c12 && c13) return -1;
  return 0;
}

function toIsoDate(rawDate: string, yymm: string): string {
  const m = rawDate.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const ym = yymm.trim().match(/^(\d{2})(\d{2})$/);
  if (!m || !ym) return rawDate.trim();
  return `20${ym[1]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function parseRow(row: string[]): AsRecord {
  const o = layoutOffset(row);
  const c = (i: number) => String(row[i] ?? '').trim();
  return {
    receivedDate: toIsoDate(c(1), c(2)),
    receivedTime: c(3).replace(/^(\d):/, '0$1:'),
    status: c(4),
    channel: c(5),
    receiver: c(6),
    handler: c(7),
    company: c(14 + o),
    assetCode: c(16 + o).toUpperCase(),
    modelSpec: c(17 + o),
    serial: c(18 + o).toUpperCase(),
    symptom: c(19 + o),
    action: c(20 + o),
    note: c(21 + o),
  };
}

export function isAsSheetConfigured(): boolean {
  return isGoogleServiceAccountConfigured();
}

async function readAllAsRecords(): Promise<AsRecord[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.records;
  const res = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId: AS_SHEET_ID,
    range: `'${AS_SHEET_TAB}'!A2:AZ`,
  });
  const rows = (res.data.values ?? []).map((r) => r.map((v) => String(v ?? '')));
  const records = rows.filter((r) => r.some((v) => v.trim())).map(parseRow);
  cache = { at: Date.now(), records };
  return records;
}

/** 자산번호 또는 시리얼번호가 일치하는 AS 접수 건(같은 접수가 두 번 복사된 행은 하나로). */
export async function findAsRecords(keys: string[]): Promise<AsRecord[]> {
  const wanted = new Set(keys.map((k) => k.trim().toUpperCase()).filter((k) => k.length >= 3));
  if (wanted.size === 0) return [];
  const all = await readAllAsRecords();
  const seen = new Set<string>();
  const hits: AsRecord[] = [];
  for (const r of all) {
    const match = (r.assetCode && wanted.has(r.assetCode)) || (r.serial && wanted.has(r.serial));
    if (!match) continue;
    const key = `${r.receivedDate}|${r.receivedTime}|${r.assetCode}|${r.symptom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(r);
  }
  return hits.sort((a, b) => `${a.receivedDate} ${a.receivedTime}`.localeCompare(`${b.receivedDate} ${b.receivedTime}`));
}
