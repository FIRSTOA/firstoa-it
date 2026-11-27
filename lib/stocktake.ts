/**
 * 실재고 조사 — 위치별로 돌아보며 전산 재고(구글시트)와 실물이 맞는지 확인하는 감사 세션.
 * 세션 하나 = 위치 하나를 조사한 기록, results는 시작 시점의 전산 재고 스냅샷 + 조사 결과.
 */

import type { Asset } from './types';

export const STOCKTAKE_ITEM_STATUSES = ['미확인', '확인됨', '목록외발견'] as const;
export type StocktakeItemStatus = (typeof STOCKTAKE_ITEM_STATUSES)[number];

export type StocktakeItem = {
  assetId: string;
  category: string;
  model: string;
  brand: string;
  status: StocktakeItemStatus;
  scannedAt: string | null;
  note: string;
  /**
   * 전산(IT재고)상 원래 위치 이름 — 조사는 선반 단위(shelfKeyOf)라 "B1" 조사에 "B1수리중" 장비도 들어가므로,
   * 선반 이름과 다르면 화면에 작게 보여 줌. 2026-11-27 이후 시작한 조사부터만 있음(옛 기록엔 없음).
   */
  location?: string;
};

export type StocktakeSession = {
  id: string;
  seq: number;
  location: string;
  status: '진행중' | '완료';
  startedBy: string;
  results: StocktakeItem[];
  startedAt: string;
  completedAt: string | null;
};

export type StocktakeSessionRow = {
  id: string;
  seq: number;
  location: string;
  status: string;
  started_by: string;
  results: StocktakeItem[];
  started_at: string;
  completed_at: string | null;
};

export function rowToStocktakeSession(row: StocktakeSessionRow): StocktakeSession {
  return {
    id: row.id,
    seq: row.seq,
    location: row.location,
    status: row.status === '완료' ? '완료' : '진행중',
    startedBy: row.started_by,
    results: Array.isArray(row.results) ? row.results : [],
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/** 그 선반에 있는 자산들로 조사 세션의 초기 results를 만듭니다(원래 위치 이름도 같이 남김). */
export function buildInitialResults(assetsAtLocation: Asset[]): StocktakeItem[] {
  return assetsAtLocation
    // 기타주변기기 중 공유기/케이블류처럼 자산번호 없이 수량으로만 관리되는 소모품은 개별
    // 실재고 확인 대상이 아닙니다 — 자산번호가 없어서 영원히 스캔/확인될 수 없으니 넣으면
    // 끝까지 "미확인"(분실 의심)으로만 남습니다.
    .filter((a) => a.assetId.trim())
    .map((a) => ({
      assetId: a.assetId,
      category: a.category,
      model: a.model,
      brand: a.brand,
      status: '미확인',
      scannedAt: null,
      note: '',
      location: a.location.trim(),
    }));
}

/** 위치 글자 정규화 — 전각→반각(NFKC), 공백 한 칸으로, 앞뒤 공백 제거, 영문 대문자. */
export function normalizeLocationText(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * 선반 열쇠 — 같은 선반이면 같은 값(사용자 결정 2026-11-27: "B1 조사에 B1수리중도 같이 보이기").
 * 선반 코드(영문 1~2자 + 숫자) 바로 뒤가 영문·숫자가 아니면(한글·공백·괄호 등) 그 뒤는 꼬리말이라 같은 선반:
 *   "B1" = "B1수리중" = "B1 (수리중)" = "b1" = "Ｂ１"(전각) → "B1".
 * 영문·숫자가 바로 이어지면 다른 선반: "B10", "B1A". "-"·"_"·"." 바로 뒤에 영문·숫자가 오면 하위 칸으로 보고
 * 다른 선반: "B1-2"(→ "B1-2", "B1-2 수리중"도 "B1-2"). 한 선반에 다른 칸 장비가 섞여 "미확인"으로 뜨는 것보다
 * 따로 남는 편이 안전해서(지금 시트엔 이런 이름이 없음 — 2026-11-27 위치 33곳 중 꼬리말 5곳 모두 "공백+한글").
 * 선반 코드 모양이 아니면("2층 A1", "반출") 정규화한 글자 그대로.
 */
export function shelfKeyOf(raw: string): string {
  const text = normalizeLocationText(raw);
  const m = text.match(/^[A-Z]{1,2}\d+(?:[-_.]?[A-Z0-9])*/);
  return m ? m[0] : text;
}

/** 두 위치 이름이 같은 선반인지(시트에 위치를 고쳐 쓸지 판단할 때 — 같은 선반이면 이름을 안 바꿈). */
export function isSameShelf(a: string, b: string): boolean {
  return shelfKeyOf(a) === shelfKeyOf(b);
}

/**
 * IT재고 위치 이름들 → 조사 대상 선반 목록.
 * shelves = 선반 열쇠(조사 시작·남은 위치·다음 후보), names = 실제 위치 이름 그대로(앞뒤 공백만 뗌 —
 * "✎ 위치 수정"에서 사람이 고를 때 시트에 있는 이름을 그대로 쓰도록). isShelf 는 zoneStatus 의 looksLikeShelfLocation
 * (정규화한 글자로 판단 — 전각 "Ｂ１"도 선반으로).
 */
export function shelfLocationsFrom(
  rawLocations: Iterable<string>,
  isShelf: (normalized: string) => boolean,
): { shelves: string[]; names: string[] } {
  const shelves = new Set<string>();
  const names = new Set<string>();
  for (const raw of rawLocations) {
    const name = raw.trim();
    if (!name || !isShelf(normalizeLocationText(name))) continue;
    names.add(name);
    shelves.add(shelfKeyOf(name));
  }
  return { shelves: [...shelves].sort(), names: [...names].sort() };
}

/**
 * 오늘 남은 선반 — 선반 목록에서 오늘 끝낸 조사의 선반과 지금 조사 중인 선반을 뺌(이름은 선반 열쇠로 비교 —
 * 옛 기록 "B1수리중"을 끝냈어도 B1 선반은 끝난 것으로). 목록 화면 "오늘 남은 선반 위치"와 종료 뒤 다음 후보가 같이 씀.
 */
export function remainingShelves(
  shelves: readonly string[],
  completedTodayLocations: Iterable<string>,
  currentLocation?: string,
): string[] {
  const done = new Set<string>();
  for (const loc of completedTodayLocations) done.add(shelfKeyOf(loc));
  if (currentLocation !== undefined) done.add(shelfKeyOf(currentLocation));
  return shelves.filter((s) => !done.has(shelfKeyOf(s)));
}

/**
 * KST(UTC+9, DST 없음)로 고정 포맷팅합니다. Intl.toLocaleString은 서버(Vercel, 보통 UTC)와
 * 클라이언트(브라우저 로컬 타임존/로케일)가 서로 다른 문자열을 만들어 React 하이드레이션
 * 불일치(#418)를 일으킬 수 있어서, 타임존에 의존하지 않는 수동 포맷을 씁니다.
 */
/** KST 기준 YYYY-MM-DD만 — 날짜별 탭 묶음 키로 씁니다. */
export function toKstDateKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * KST 날짜 키(YYYY-MM-DD)의 [그날 0시, 다음날 0시)를 UTC ISO 로 — DB 에서 "그날 시작한 조사"만 거를 때.
 * toKstDateKey 와 같은 날 경계(KST 는 DST 없음 → 하루 = 24시간).
 */
export function kstDayRangeIso(dateKey: string): { start: string; end: string } {
  const startMs = Date.parse(`${dateKey}T00:00:00+09:00`);
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 24 * 60 * 60 * 1000).toISOString() };
}

export type TabReadFailure = { tab: string; status: number | null; message: string };

/**
 * IT재고 탭별 읽기 결과(Promise.allSettled, tabs 와 같은 순서)를 합치고, 못 읽은 탭은 따로 돌려줍니다.
 * lib/inventory/sheets.ts 의 listAllAssets 는 못 읽은 탭을 빈 목록으로 바꿔 조용히 넘어가는데, 실재고 조사에선
 * 그게 ① 그 탭 장비가 빠진 조사 목록(시작할 때 한 번 만들어 그대로 저장됨) ② "남은 선반 위치"가 빠지거나 텅 빔
 * 이 됐음(2026-11-27 신고). 구글 읽기 한도(서비스계정 분당 60회, 앱 전체가 같이 씀)에 걸리면 429 로 탭 몇 개만
 * 실패하는 일이 실제로 생깁니다. 결과가 없는 탭도 실패로 셉니다(빠졌는데 성공으로 보이지 않게).
 */
export function mergeTabReads<T>(
  tabs: readonly string[],
  settled: readonly PromiseSettledResult<readonly T[]>[],
): { items: T[]; failed: TabReadFailure[] } {
  const items: T[] = [];
  const failed: TabReadFailure[] = [];
  tabs.forEach((tab, i) => {
    const r = settled[i];
    if (!r) failed.push({ tab, status: null, message: '읽기 결과 없음' });
    else if (r.status === 'fulfilled') for (const v of r.value) items.push(v);
    else failed.push({ tab, ...describeSheetReadError(r.reason) });
  });
  return { items, failed };
}

/** 구글 API 오류(GaxiosError: status 또는 response.status)에서 상태 번호와 짧은 문구만 — 로그용, 값은 안 담김. */
export function describeSheetReadError(err: unknown): { status: number | null; message: string } {
  const e = err as { status?: unknown; response?: { status?: unknown }; message?: unknown } | null;
  const raw = e?.status ?? e?.response?.status;
  const status = typeof raw === 'number' ? raw : null;
  const message = typeof e?.message === 'string' ? e.message.slice(0, 200) : String(err).slice(0, 200);
  return { status, message };
}

/** 날짜 탭 라벨 — 오늘/어제는 글자로, 그 외는 "10/7(화)" 형식으로. */
export function formatDateTabLabel(dateKey: string): string {
  const todayKey = toKstDateKey(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toKstDateKey(yesterday.toISOString());
  if (dateKey === todayKey) return '오늘';
  if (dateKey === yesterdayKey) return '어제';
  const [, m, d] = dateKey.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(dateKey).getDay()];
  return `${m}/${d}(${weekday})`;
}

export function formatKstDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
}

/**
 * 사진 스캔으로 뽑힌 문자열이 실제 자산번호 스티커 형식(영문 1~3글자 + 숫자 3~6자리, 예:
 * P1388/X8744)인지 확인합니다. "A3"/"B1" 같은 선반 위치 라벨처럼 숫자가 1~2자리뿐인 짧은
 * 토큰은 자산번호로 보지 않고 걸러내려는 목적 — 실제 자산번호는 항상 숫자 3자리 이상입니다.
 */
export function isLikelyAssetId(value: string): boolean {
  return /^[A-Za-z]{1,3}\d{3,6}$/.test(value.trim());
}

export type StocktakeConfirmation = { scannedAt: string; location: string; sessionId: string; startedBy: string };

/**
 * IT재고 리스트에 "실재고체크완료" 배지를 달기 위한 조회표 — 모든 조사 세션의 결과를
 * 훑어서, 자산번호별로 실제로 눈으로 확인된(확인됨 또는 목록외발견 — 둘 다 그 자리에서
 * 실물을 봤다는 뜻) 가장 최근 시각만 남깁니다. 매일 조사하므로 "최근 1건"이면 충분합니다.
 */
export function buildLatestConfirmationMap(
  sessions: readonly Pick<StocktakeSession, 'id' | 'location' | 'startedBy' | 'results'>[],
): Record<string, StocktakeConfirmation> {
  const map: Record<string, StocktakeConfirmation> = {};
  for (const session of sessions) {
    for (const item of session.results) {
      if (item.status !== '확인됨' && item.status !== '목록외발견') continue;
      if (!item.scannedAt) continue;
      const existing = map[item.assetId];
      if (!existing || item.scannedAt > existing.scannedAt) {
        map[item.assetId] = {
          scannedAt: item.scannedAt,
          location: session.location,
          sessionId: session.id,
          startedBy: session.startedBy,
        };
      }
    }
  }
  return map;
}

/** 실재고체크 조회표(IT재고 배지·재고 현황판)가 읽는 칸 — 예전 select('*') 대신 쓰는 것만. */
export const STOCKTAKE_CONFIRMATION_COLUMNS = 'id,location,started_by,results';
export type StocktakeConfirmationSourceRow = Pick<StocktakeSessionRow, 'id' | 'location' | 'started_by' | 'results'>;

/** DB 줄(필요한 칸만) → buildLatestConfirmationMap. 예전 rowToStocktakeSession 경로와 같은 결과(Node 시험). */
export function buildConfirmationMapFromRows(
  rows: readonly StocktakeConfirmationSourceRow[],
): Record<string, StocktakeConfirmation> {
  return buildLatestConfirmationMap(
    rows.map((r) => ({
      id: r.id,
      location: r.location,
      startedBy: r.started_by,
      results: Array.isArray(r.results) ? r.results : [],
    })),
  );
}

export type StocktakeSummary = { total: number; confirmed: number; missing: number; unexpected: number };

export function stocktakeSummary(results: StocktakeItem[]): StocktakeSummary {
  const confirmed = results.filter((r) => r.status === '확인됨').length;
  const missing = results.filter((r) => r.status === '미확인').length;
  const unexpected = results.filter((r) => r.status === '목록외발견').length;
  return { total: results.length, confirmed, missing, unexpected };
}

// ---------- 목록 화면(/stocktake)용 가벼운 줄 ----------

/** 목록 화면이 읽는 칸 — completed_at 등은 안 씀. results 는 서버에서 요약만 만들고 브라우저로는 안 보냄. */
export const STOCKTAKE_LIST_COLUMNS = 'id,seq,location,status,started_by,started_at,results';
export type StocktakeListSourceRow = Pick<
  StocktakeSessionRow,
  'id' | 'seq' | 'location' | 'status' | 'started_by' | 'started_at' | 'results'
>;

export type StocktakeMissingItem = Pick<StocktakeItem, 'assetId' | 'category' | 'model' | 'brand' | 'location'>;

/**
 * 목록 화면 한 줄 — 예전엔 조사 결과 전체(results)를 브라우저로 보내서 목록 화면이 1.28MB(2026-11-27, 834건)였음.
 * 목록이 쓰는 건 확인 현황(summary)과 "미확인 자산" 모음(missing)뿐이라 그것만 보냄.
 */
export type StocktakeListRow = {
  id: string;
  seq: number;
  location: string;
  status: '진행중' | '완료';
  startedBy: string;
  startedAt: string;
  summary: StocktakeSummary;
  missing: StocktakeMissingItem[];
};

/** DB 줄 → 목록 줄. 같은 id 가 두 번 오면(페이지 사이에 줄이 밀린 경우) 하나만, 순번 큰 것부터(예전 order seq desc). */
export function buildStocktakeListRows(rows: readonly StocktakeListSourceRow[]): StocktakeListRow[] {
  const byId = new Map<string, StocktakeListRow>();
  for (const row of rows) {
    const results: StocktakeItem[] = Array.isArray(row.results) ? row.results : [];
    byId.set(row.id, {
      id: row.id,
      seq: row.seq,
      location: row.location,
      status: row.status === '완료' ? '완료' : '진행중',
      startedBy: row.started_by,
      startedAt: row.started_at,
      summary: stocktakeSummary(results),
      missing: results
        .filter((r) => r.status === '미확인')
        .map((r) => ({
          assetId: r.assetId,
          category: r.category,
          model: r.model,
          brand: r.brand,
          ...(r.location !== undefined ? { location: r.location } : {}),
        })),
    });
  }
  return [...byId.values()].sort((a, b) => b.seq - a.seq);
}

type PageError = { code?: string; message: string };

/**
 * Supabase 는 한 번에 최대 1000줄만 돌려줌(.limit 을 더 크게 줘도) — 끝까지 페이지로 읽음.
 * page 는 반드시 겹치지 않는 고정 순서(.order('seq').order('id'))로 .range(from, to) 해야 함.
 * 오류면 그때까지 읽은 줄과 오류를 같이 돌려줌(호출부가 일부만 쓰지 말고 오류로 다룰 것).
 * 조사 표는 2026-11-27 834건, 하루 약 14건씩 늘어 12월 초에 1000건을 넘음 — 예전 select('*') 는 거기서 잘렸을 것.
 */
export async function readAllStocktakePages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PageError | null }>,
  pageSize = 1000,
  maxPages = 500,
): Promise<{ rows: T[]; error: PageError | null }> {
  const rows: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const from = i * pageSize;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { rows, error };
    const got = data ?? [];
    for (const r of got) rows.push(r);
    if (got.length < pageSize) return { rows, error: null };
  }
  return { rows, error: { message: `조사 기록이 ${maxPages * pageSize}줄을 넘어 끝까지 못 읽었어요.` } };
}
