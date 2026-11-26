import 'server-only';

/**
 * 시트와 비교(전환 기간, 읽기만 — 설계 §3-8). 확인서리스트 워크북 'IT확인서리스트' 탭을 batchGet 1회로
 * B·C·D, G~J, M, O~Q, T 칸만 읽음(연락처 N 은 읽지 않음). 쓰기 코드 없음, 재시도 반복 없음.
 */
import { CONFIRM_SHEET_ID } from '@/lib/confirmSheetServer';
import { getSheetsClient, isGoogleServiceAccountConfigured } from '@/lib/googleAuth';
import { matchSheet, type MatchConfirm, type SheetRow } from './sheetMatch';
import type { SheetCompareResult } from './types';

const TAB = 'IT확인서리스트';
const q = `'${TAB}'`;
/** 읽는 칸 — 순서가 아래 파싱과 맞아야 함 */
const RANGES = [`${q}!B2:D`, `${q}!G2:J`, `${q}!M2:M`, `${q}!O2:Q`, `${q}!T2:T`];

const cell = (row: unknown[] | undefined, i: number): string => String(row?.[i] ?? '').trim();

function isQuota(err: unknown): boolean {
  const e = err as { code?: number; status?: number; message?: string };
  return e?.code === 429 || e?.status === 429 || /quota|rate limit/i.test(e?.message ?? '');
}

export async function compareConfirmsWithSheet(confirms: MatchConfirm[]): Promise<SheetCompareResult> {
  if (!isGoogleServiceAccountConfigured()) return { ok: false, error: '구글시트 연결 설정이 없어서 비교할 수 없어요.' };
  let ranges: { values?: unknown[][] | null }[];
  try {
    const res = await getSheetsClient().spreadsheets.values.batchGet({ spreadsheetId: CONFIRM_SHEET_ID, ranges: RANGES });
    ranges = res.data.valueRanges ?? [];
  } catch (err) {
    console.warn('[sales-confirms] 시트 비교 읽기 실패', (err as { code?: number | string } | null)?.code ?? 'unknown');
    return {
      ok: false,
      error: isQuota(err) ? '시트를 못 읽었어요(1분 뒤 다시)' : '시트를 못 읽었어요(잠시 뒤 다시, 계속되면 개발 담당에게)',
    };
  }
  const [bcd, ghij, m, opq] = [0, 1, 2, 3].map((i) => (ranges[i]?.values ?? []) as unknown[][]);
  const n = Math.max(bcd.length, ghij.length, m.length, opq.length);
  const rows: SheetRow[] = [];
  for (let i = 0; i < n; i++) {
    const row: SheetRow = {
      sheetRow: i + 2, // 머리줄이 1행이라 데이터는 2행부터
      deliveryText: cell(bcd[i], 0),
      receivedDate: cell(bcd[i], 1),
      receivedTime: cell(bcd[i], 2),
      status: cell(ghij[i], 0),
      type: cell(ghij[i], 3),
      company: cell(m[i], 0),
      items: cell(opq[i], 0),
      assetText: cell(opq[i], 2),
    };
    if (row.company) rows.push(row);
  }
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const { byConfirm, sheetOnly } = matchSheet(confirms, rows, today);
  return { ok: true, byConfirm, sheetOnly, readAt: new Date().toISOString() };
}
