/**
 * 영업 확인서 목록 ↔ 확인서리스트 시트 'IT확인서리스트' 탭 맞추기 (순수 함수 — import type 말고 import 없음).
 * 시트는 읽기만 하고(sheetCompare.ts), 여기선 이미 읽은 줄을 맞춰 보기만 함. 연락처는 다루지 않음.
 */
import type { SheetCompareEntry, SheetOnlyRow } from './types';

/** 시트 한 줄(읽은 칸만) — sheetRow 는 1부터(머리줄 포함) */
export interface SheetRow {
  sheetRow: number;
  /** B 납품/교체일 '11월27일' (연도 없음) */
  deliveryText: string;
  /** C 접수일 '11.25' */
  receivedDate: string;
  /** D 접수시간 */
  receivedTime: string;
  /** G 처리여부 */
  status: string;
  /** J 구분 */
  type: string;
  /** M 상호 */
  company: string;
  /** O 품목 */
  items: string;
  /** Q 자산번호(여러 줄 가능) */
  assetText: string;
}

/** 목록 줄에서 비교에 쓰는 것만 */
export interface MatchConfirm {
  id: string;
  company: string;
  /** 'YYYY-MM-DD' | null */
  deliveryDate: string | null;
  type: string;
  /** ISO | null */
  receivedAt: string | null;
  /** 우리 처리여부(6단계 중 하나) */
  status: string;
  assetIds: string[];
}

/** 상호 정규화 — 공백·㈜·(주)·주식회사·(유)·유한회사·기호 제거, 소문자 */
export function normCompany(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(\s*주\s*\)|\(\s*유\s*\)|\(\s*사\s*\)|\(\s*재\s*\)|주식회사|유한회사|유한책임회사/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// ───────────── 날짜 ─────────────

const DAY = 86400000;
const ymdToMs = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const msToYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const validMd = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

function parseYmd(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? ymdToMs(+m[1], +m[2], +m[3]) : null;
}

/** '11월27일' / '11/27' / '11.27' → [월, 일] */
export function parseMonthDay(text: string): [number, number] | null {
  const t = String(text ?? '').trim();
  const a = /(\d{1,2})\s*월\s*(\d{1,2})/.exec(t);
  const b = a ? null : /(\d{1,2})\s*[./-]\s*(\d{1,2})/.exec(t);
  const m = a ?? b;
  if (!m) return null;
  const mo = +m[1];
  const d = +m[2];
  return validMd(mo, d) ? [mo, d] : null;
}

/**
 * 접수일 'MM.DD' → 연도 추정: 오늘 + 14일 이하 중 가장 늦은 날(12월 말에 '01.02' 면 다음 해, 1월에 '12.28' 이면 작년).
 */
export function resolveReceivedYmd(text: string, todayYmd: string): string | null {
  const md = parseMonthDay(text);
  const today = parseYmd(todayYmd);
  if (!md || today === null) return null;
  const limit = today + 14 * DAY;
  const y0 = new Date(today).getUTCFullYear();
  for (const y of [y0 + 1, y0, y0 - 1]) {
    const ms = ymdToMs(y, md[0], md[1]);
    if (ms <= limit) return msToYmd(ms);
  }
  return null;
}

/**
 * 납품/교체일 '11월27일' → 연도 추정: 접수일(없으면 오늘)에 가장 가까운 해(12월↔1월 넘김 처리).
 */
export function resolveDeliveryYmd(text: string, receivedYmd: string | null, todayYmd: string): string | null {
  const md = parseMonthDay(text);
  const ref = parseYmd(receivedYmd ?? todayYmd) ?? parseYmd(todayYmd);
  if (!md || ref === null) return null;
  const y0 = new Date(ref).getUTCFullYear();
  let best: number | null = null;
  for (const y of [y0 - 1, y0, y0 + 1]) {
    const ms = ymdToMs(y, md[0], md[1]);
    if (best === null || Math.abs(ms - ref) < Math.abs(best - ref)) best = ms;
  }
  return best === null ? null : msToYmd(best);
}

const kstYmd = (iso: string | null): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : null;
};

// ───────────── 처리여부·자산번호 ─────────────

/**
 * 시트 처리여부 → 우리 6단계로 대응. 모르는 값(요청사항 긴 글 등)은 null = 비교 안 함.
 *   '준비완료' → 준비완료(또는 이미 출고로 넘어갔어도 같게 봄) · '처리완료' → 출고 · 취소·보류·준비중 → 같은 이름 · ''·'접수' → 접수
 */
export function sheetStatusToOurs(text: string): 'any-ready' | '출고' | '취소' | '보류' | '준비중' | '접수' | null {
  const t = String(text ?? '').trim();
  if (t === '') return '접수';
  if (t === '준비완료') return 'any-ready';
  if (t === '처리완료') return '출고';
  if (t === '취소' || t === '보류' || t === '준비중' || t === '접수') return t;
  return null;
}

/** 시트 처리여부와 우리 처리여부가 같은 뜻인가 (null = 비교 불가 → 같게 봄) */
export function statusSame(sheetText: string, ours: string): boolean {
  const s = sheetStatusToOurs(sheetText);
  if (s === null) return true;
  if (s === 'any-ready') return ours === '준비완료' || ours === '출고';
  if (s === '접수') return ours === '접수' || ours === '준비중';
  return s === ours;
}

/** 자산번호 칸 → 번호 목록(줄바꿈·쉼표·공백 구분, 대문자, 중복 제거) */
export function splitAssetIds(text: string): string[] {
  const seen = new Set<string>();
  for (const p of String(text ?? '').split(/[\s,;/]+/)) {
    const v = p.trim().toUpperCase();
    if (v) seen.add(v);
  }
  return [...seen];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// ───────────── 맞추기 ─────────────

export interface MatchResult {
  byConfirm: Record<string, SheetCompareEntry>;
  sheetOnly: SheetOnlyRow[];
}

interface Parsed {
  row: SheetRow;
  key: string;
  date: string | null;
  receivedYmd: string | null;
}

/**
 * 목록 줄들을 시트 줄과 맞춤. 열쇠 = 상호(정규화) + 납품/교체일 + 구분.
 * 같은 열쇠가 둘 이상이면 접수일이 같은 줄을 먼저, 그다음 시트 순서대로 한 줄씩 짝짓기(한 시트 줄은 한 건에만).
 * sheetOnly = 목록 줄들의 납품일 범위(최소~최대) 안인데 짝이 없는 시트 줄.
 */
export function matchSheet(confirms: MatchConfirm[], rows: SheetRow[], todayYmd: string): MatchResult {
  const parsed: Parsed[] = rows
    .filter((r) => normCompany(r.company))
    .map((row) => {
      const receivedYmd = resolveReceivedYmd(row.receivedDate, todayYmd);
      const date = resolveDeliveryYmd(row.deliveryText, receivedYmd, todayYmd);
      return { row, key: `${normCompany(row.company)}|${date ?? ''}|${row.type.trim()}`, date, receivedYmd };
    });
  const groups = new Map<string, Parsed[]>();
  for (const p of parsed) {
    const g = groups.get(p.key);
    if (g) g.push(p);
    else groups.set(p.key, [p]);
  }

  const used = new Set<number>();
  const byConfirm: Record<string, SheetCompareEntry> = {};
  // 먼저 접수된 건부터 짝을 지어 결과가 화면 순서에 안 흔들리게
  const ordered = [...confirms].sort((a, b) => (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '') || a.id.localeCompare(b.id));
  for (const c of ordered) {
    const cand = c.deliveryDate ? (groups.get(`${normCompany(c.company)}|${c.deliveryDate}|${c.type.trim()}`) ?? []).filter((p) => !used.has(p.row.sheetRow)) : [];
    const recv = kstYmd(c.receivedAt);
    const pick = cand.find((p) => recv && p.receivedYmd === recv) ?? cand[0];
    if (!pick) {
      byConfirm[c.id] = { state: 'missing', diffs: [], sheetRow: null, sheetStatus: '', sheetAssetIds: [] };
      continue;
    }
    used.add(pick.row.sheetRow);
    const sheetAssets = splitAssetIds(pick.row.assetText);
    const ours = c.assetIds.map((x) => x.trim().toUpperCase()).filter(Boolean);
    const diffs: string[] = [];
    if (!statusSame(pick.row.status, c.status)) diffs.push('처리여부');
    if (!sameSet(sheetAssets, [...new Set(ours)])) diffs.push('자산번호');
    byConfirm[c.id] = {
      state: diffs.length ? 'diff' : 'same',
      diffs,
      sheetRow: pick.row.sheetRow,
      sheetStatus: pick.row.status.trim().slice(0, 20),
      sheetAssetIds: sheetAssets,
    };
  }

  const dates = confirms.map((c) => c.deliveryDate).filter((d): d is string => !!d).sort();
  const sheetOnly: SheetOnlyRow[] = [];
  if (dates.length) {
    const lo = dates[0];
    const hi = dates[dates.length - 1];
    for (const p of parsed) {
      if (used.has(p.row.sheetRow) || !p.date || p.date < lo || p.date > hi) continue;
      sheetOnly.push({
        sheetRow: p.row.sheetRow,
        deliveryDateText: p.row.deliveryText.trim(),
        receivedText: `${p.row.receivedDate.trim()} ${p.row.receivedTime.trim()}`.trim(),
        status: p.row.status.trim().slice(0, 20),
        type: p.row.type.trim(),
        company: p.row.company.trim(),
        items: p.row.items.trim().slice(0, 60),
        assetIds: splitAssetIds(p.row.assetText),
      });
    }
    sheetOnly.sort((a, b) => a.sheetRow - b.sheetRow);
  }
  return { byConfirm, sheetOnly };
}
