/**
 * 영업 확인서 가져오기 — 공용 타입·상수 (server-only 아님: 화면·서버 둘 다 import).
 * 설계: docs/tasks/2026-11-26-sales-confirm-import.md (맨 위 D1~D14 결정이 우선)
 *
 * 흐름: 영업 웹앱 읽기 전용 API → (가져오기 importer.ts) → ① it_sales_confirms / ② versions
 *       IT가 화면에서 쓰는 값 → ③ it_sales_confirm_work / ④ it_sales_confirm_units  (가져오기 코드는 ③④를 import 도 안 함 — D3)
 *
 * 파일·담당(1단계):
 *   lib/salesConfirms/normalize.ts  (순수, import 없음)   developer A — 원문 1건 → NormalizedSalesConfirm | 건너뛸 이유, hash 용 정렬 문자열
 *   lib/salesConfirms/source.ts     (server-only)         developer A — fetchSalesConfirms(since) : 키·시간 제한·오류 분류
 *   lib/salesConfirms/importer.ts   (server-only)         developer A — runSalesConfirmImport(opts) : since(D14)·겹침 막기·①② 반영·⑤ 기록
 *   app/api/sales-confirms/import/route.ts                developer A — POST { force?, since? } → SalesImportRouteResult (원문 없음)
 *   lib/salesConfirms/listQuery.ts  (server-only)         developer B — loadSalesConfirmList() → SalesConfirmListResult
 *   app/confirm-form/salesActions.ts ('use server')       developer B — 아래 "서버 액션" 주석
 *   lib/salesConfirms/sheetMatch.ts (순수) · sheetCompare.ts (server-only, 시트 읽기만)  developer B
 *   components/salesConfirms/*                            ui-designer — ConfirmViewChips · SalesConfirmListPage · SalesConfirmTable · ImportStatusBar · SalesConfirmPreview
 *   app/confirm-form/page.tsx                             팀장
 *
 * 개인정보(D7): 지금은 화면에 그냥 보임(로그인 붙일 때 막음). 그래도 원문(payload)·연락처를
 *   서버 로그·오류 문구·⑤ 상태·라우트 응답에 넣지 말 것.
 *
 * 표 칸 이름(supabase/sales_confirms_schema.sql — db-schema 가 이 이름 그대로 만듦, 코드도 이 이름으로 읽고 씀):
 *   ① it_sales_confirms        id text PK · doc_no · ver int · type · term · saved_at timestamptz · first_saved_at timestamptz ·
 *                              saved_by · sales_rep · company · address · region · delivery_date date · contacts jsonb ·
 *                              items jsonb · supplies jsonb · replace_info jsonb null · special · doc_url · payload jsonb · payload_hash ·
 *                              sales_state text default '' · first_seen_at · changed_at · fetched_at
 *   ② it_sales_confirm_versions id bigint identity · confirm_id → ① (cascade) · ver · payload_hash · payload jsonb · fetched_at
 *                              unique (confirm_id, ver, payload_hash)
 *   ③ it_sales_confirm_work    confirm_id PK → ① (restrict) · status default '접수' · processors text[] · started_at · finished_at · shipped_at ·
 *                              note · seen_ver int · seen_hash · first_opened_at · first_opened_by · checks jsonb default '{}' ·
 *                              prep_event_id uuid null → it_calendar_events (set null, 4단계용 — 1~3단계 코드는 안 씀) · link_source ·
 *                              printed_at · created_at · updated_at · updated_by
 *   ④ it_sales_confirm_units   id uuid PK · confirm_id → ① (restrict) · slot_key · unit_no int · item_snapshot jsonb · asset_id · serial ·
 *                              actual_maker · actual_model · spec_override jsonb default '{}' · checks jsonb default '{}' · note ·
 *                              created_at · updated_at · updated_by      unique (confirm_id, slot_key, unit_no)
 *                              + (2+3단계 블록 A) extra jsonb default '{}'(pc·user·ledgerPushed — 키 없음) · diff_ack jsonb default '{}'('spec:RAM' 꼴 키)
 *   ③ (2+3단계 블록 A)        + printed_ver int null · printed_by text default ''
 *   ⑤ it_sales_import_state    id text PK ('main' 한 줄, SQL 이 만들어 둠) · last_attempt_at · last_success_at · last_deep_at ·
 *                              last_window_days int · last_error_code · last_error · last_counts jsonb · updated_at
 */

import type { ItemKind } from './itemKind';
import type { PrepUnit } from '@/lib/shipmentPrep'; // 4-2 절(타입만 — 실행 때 지워짐)

// ───────────────────────── 영업 원문(지침 기준 — 키 받은 뒤 1회 실측으로 확정, §3-6) ─────────────────────────

/** 사양 칸 이름 — 영업 원문 spec 의 키 그대로(화면 표시 순서) */
export const SALES_SPEC_KEYS = ['CPU', 'RAM', 'SSD', 'HDD', '그래픽', 'OS', '인치'] as const;
export type SalesSpecKey = (typeof SALES_SPEC_KEYS)[number];
/** 빈 칸은 키가 없거나 '' */
export type SalesSpec = Partial<Record<SalesSpecKey, string>>;

export interface SalesConfirmItem {
  /** '데스크탑' | '노트북' | '모니터' | … (비면 '기타'로 정규화) */
  cat: string;
  model: string;
  maker: string;
  /** '새기기' | '중고기' | '' */
  state: string;
  /** 0 이상 정수(정규화에서 숫자로, 이상하면 0) */
  qty: number;
  spec: SalesSpec;
  /** SALES_SPEC_KEYS 밖의 사양 칸(영업 웹앱이 더 보내는 것 — 칸 이름 그대로, 값 있는 것만). 화면에 그대로 보여 줌 */
  specExtra?: Record<string, string>;
  /** 설치장소·요청사항 */
  place: string;
  /** (출력용, 2+3단계) 월 렌탈료 — 영업 가져오기에 칸이 없으면 null(= 안 옴 → 종이에 ₩0 대신 빈칸, D17) */
  rent?: number | null;
}

export interface SalesConfirmSupply {
  name: string;
  qty: number;
  /** '무상' | '청구' | '' */
  charge: string;
  note: string;
  /** (출력용) 단가 원문 — 안 오면 null */
  price?: string | null;
}

/**
 * (출력용, 2+3단계) 영업 양식 1면 계약·청구 요약에 쓰는 칸 — 지금 영업 가져오기에 없음(영업 쪽에 추가 요청함).
 * 각 칸: null = 응답에 칸이 없음(안 옴 → 빈칸, 가짜 ₩0·자동 체크 안 찍음 — D17), '' = 영업이 비워서 보냄(영업 출력과 같게).
 * normalize.ts 가 채움(developer D). 원문 hash 와는 무관.
 */
export interface SalesPrintExtra {
  /** 'it' | 'mfp' | null */
  kind: string | null;
  months: string | null;
  deposit: string | null;
  payNote: string | null;
  extra: string | null;
  orderDate: string | null;
  industry: string | null;
  statusNo: string | null;
  fax: string | null;
  taxMail: string | null;
  contractMail: string | null;
}

/**
 * 실측(2026-11-26): 영업 웹앱의 phone 은 회사 대표번호 칸이고, 담당자 연락처는 manager(IT담당)·contractor(계약담당)·
 * resident(현장상주)·payer(결제담당)에 이름과 같이 적힘 → 목록 "연락처"는 phone 없으면 IT담당 → 계약담당 → 현장상주 순.
 */
export interface SalesConfirmContacts {
  /** IT담당 */
  manager: string;
  /** 현장 상주 */
  resident: string;
  /** 결제담당 */
  payer: string;
  /** 계약담당 */
  contractor: string;
  /** 회사 대표번호 */
  phone: string;
}

/** normalize.ts 가 원문 1건을 바꾼 모양 — ① 표의 칸과 1:1 (payload 는 원문 그대로 따로 저장) */
export interface NormalizedSalesConfirm {
  id: string;
  /** 영업 no (예: D-261124-04) — 목록의 "순번" */
  docNo: string;
  ver: number;
  /** '납품' | '교체' | '유지보수' (그 밖의 값도 그대로 둠) */
  type: string;
  /** '일반/장기' | '현장/단기' | '' */
  term: string;
  /** ISO 시각 또는 null */
  savedAt: string | null;
  /** 접수자 */
  savedBy: string;
  /** 영업담당 */
  salesRep: string;
  company: string;
  address: string;
  region: string;
  /** 'YYYY-MM-DD' 또는 null */
  deliveryDate: string | null;
  contacts: SalesConfirmContacts;
  /** 특이사항 */
  special: string;
  items: SalesConfirmItem[];
  supplies: SalesConfirmSupply[];
  /** 교체일 때 before/after 원문(모양은 실측 뒤) — 없으면 null */
  replaceInfo: { before: unknown; after: unknown } | null;
  /** 영업 웹앱 확인서 보기 링크(검사 전 원문) — 화면은 safeDocUrl() 을 거쳐서만 링크로 */
  docUrl: string;
  /** 실측에서 더 있던 칸(2026-11-26): 유입담당 · 임대 번호 · 사유(교체 등). ① 표에 칸은 없고 payload 에서 읽음 */
  inflow: string;
  leaseNo: string;
  reason: string;
  /** (출력용) 계약·청구 요약 칸 — 없으면(예전 정규화로 만든 값) 전부 안 옴으로 봄 */
  print?: SalesPrintExtra;

  // ── 영업 b33a4c3(2026-11-27) export 새 칸 — 설계 docs/tasks/2026-11-27-sales-export-b33a4c3.md E24·E25 ──
  // normalize 는 늘 채움. 선택(?)인 건 저장 칸으로 만드는 confirmFromStored(원문이 이상할 때만)가 안 채워도 되게.
  /** 영업 출력 함수 종류 — 옛 원문(b33a4c3 전)이면 null → 출력 막음("다시 가져오기"). 따로 보는 종류(판매·철수·이전)는 null + otherRenderer */
  renderer?: SalesRenderer | null;
  /** 따로 보는 종류의 출력 함수(sale·pull·move) — 원본 보기(영업 실시간 HTML)만 씀. 그 밖이면 null */
  otherRenderer?: SalesOtherRenderer | null;
  /**
   * 영업 출력 함수(renderConfirm·renderSwap·renderSvc)에 그대로 넣는 확인서 전체 = export `doc` 얕은 복사.
   * svc 면 items[].cost(매입가)를 뺀 사본 — 이 값은 상세 데이터로 **브라우저까지 감**. 옛 원문이면 null.
   */
  formDoc?: Record<string, unknown> | null;
  /** export status 그대로('deleted' = 영업 지운 목록에 있음). 진짜 지움 판정은 salesDeleted */
  salesStatus?: 'active' | 'deleted';
  /** 진짜 지움 = status 'deleted' 이고 savedAt ≤ deletedAt(둘 중 하나 모르면 지움) — 영업 납품·교체 저장이 지움 표시를 안 지움(G4) */
  salesDeleted?: boolean;
  /** 지운 시각(ISO — 영업 값은 시간대 없는 한국 시각이라 +09:00 으로 읽음, E24)·지운 사람 */
  deletedAt?: string | null;
  deletedBy?: string;
  /** 처음 저장 시각(ISO, 첫 판 savedAt)·처음 만든 사람 — 접수일시 */
  createdAt?: string | null;
  createdBy?: string;
}

/** 영업 출력 함수 종류(export renderer) — confirm = 납품, swap = 교체, svc = 유지보수·소프트웨어 */
export type SalesRenderer = 'confirm' | 'swap' | 'svc';

// ───────── 따로 보는 종류(2026-11-27 사용자: 판매·철수·이전도 받되 "출고 준비가 아니니 별도 항목으로만 우선 보이게") ─────────
// 영업 export 에 아직 없음 — 영업에 추가 요청(type '판매'|'철수'|'이전', renderer 'sale'|'pull'|'move'). 오면 목록의 따로 보기 칩에만 나옴.
// 기기 칸·IT 기재 출력·홈 숫자 없음, 상세는 영업 값 보기 + `영업 원본 보기`(영업 실시간 HTML — 사본 없음)만.

/** 출고 준비(기기 칸·출력)를 하는 종류. 빈 값('')은 옛 원문 = 납품으로 봄 */
export const SALES_SHIP_TYPES = ['납품', '교체', '유지보수', '소프트웨어'] as const;

/** 따로 보는 종류의 출력 함수(영업 pullDoc·moveDoc·saleDoc — 우리 사본 없음) */
export type SalesOtherRenderer = 'sale' | 'pull' | 'move';

/** 출고 준비 종류가 아니면 true(판매·철수·이전과 앞으로 생길 모르는 종류 전부) — 목록·홈·상세가 이 함수 하나로 가름 */
export function isOtherSalesType(type: string | null | undefined): boolean {
  const t = String(type ?? '').trim();
  if (!t) return false;
  return !(SALES_SHIP_TYPES as readonly string[]).includes(t);
}

// ───────── 영업에서 지운 확인서(2차 — 설계 docs/tasks/2026-11-27-sales-export-b33a4c3.md E26~E28) ─────────

/** ① sales_state 값 — 영업에서 지움(진짜 지움 = normalize salesDeleted). 되살아나면 '' */
export const SALES_STATE_DELETED = '지움';

/**
 * 영업 시각 글자 → ISO(normalize.ts toIso 와 같은 규칙 — 바꾸면 같이). 영업 값은 시간대 없는 한국 시각 'YYYY-MM-DD HH:mm(:ss)'(E24)
 * → +09:00 으로 읽음. 시간대가 붙은 값은 그대로. 이상하면 null. (목록처럼 payload 를 normalize 하지 않고 칸 하나만 읽을 때)
 */
export function salesTimeToIso(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const kst = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/);
  const t = kst ? Date.parse(`${kst[1]}T${kst[2]}${kst[3] ?? ':00'}${kst[4] ?? ''}+09:00`) : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** IT가 손댄 처리여부(지웠어도 목록에 빨갛게 남김 — E27) */
const TOUCHED_STATUSES: readonly string[] = ['준비중', '준비완료', '출고', '보류'];

/**
 * 목록 기본 보기에서 숨길지(E27·E28) — 목록 화면이 이 함수 하나로(칩 '전체'·처리여부 칩을 고르면 안 씀).
 *  - 영업에서 지움: 숨김. 단 IT가 손댄 건(준비중·준비완료·출고·보류)은 남김(빨간 "영업에서 지움").
 *  - 지우지 않음: 끝난 건(출고·취소)은 숨김. 단 납품일이 지난 7일 안(앞으로 올 것 포함)이거나 "영업에서 수정됨"이면 남김
 *    (1단계부터 쓰던 "끝난 건 중 납품일 7일 안은 보임" 그대로).
 * today = 한국 날짜 'YYYY-MM-DD'.
 */
export function isHiddenByDefault(
  row: { status: string; salesState: string; salesChanged: { fromVer: number; toVer: number } | null; deliveryDate: string | null },
  today: string,
): boolean {
  if (row.salesState === SALES_STATE_DELETED) return !TOUCHED_STATUSES.includes(row.status);
  if (row.status === '출고' || row.status === '취소') {
    if (row.salesChanged) return false;
    const t = Date.parse(`${today}T00:00:00Z`);
    const weekAgo = Number.isFinite(t) ? new Date(t - 7 * 86_400_000).toISOString().slice(0, 10) : today;
    return !(row.deliveryDate && row.deliveryDate >= weekAgo);
  }
  return false;
}

/** 목록 "연락처" 칸 — 대표번호가 없으면 IT담당 → 계약담당 → 현장상주(이름과 같이 적힌 값 그대로) */
export function contactLine(c: Partial<SalesConfirmContacts> | null | undefined): string {
  if (!c) return '';
  if (c.phone) return c.phone;
  if (c.manager) return `IT담당 ${c.manager}`;
  if (c.contractor) return `계약 ${c.contractor}`;
  if (c.resident) return `현장 ${c.resident}`;
  return '';
}

/** 영업 웹앱 주소 — docUrl 은 https + 이 호스트일 때만 링크로(D7 유지 규칙) */
export const SALES_WEBAPP_HOST = 'firstoa-smart-sales-os.vercel.app';

/** docUrl 검사: https + 영업 웹앱 호스트면 그 주소, 아니면 null (javascript: 등 막기) */
export function safeDocUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.hostname !== SALES_WEBAPP_HOST) return null;
    // 영업 커밋 b33a4c3(2026-11-27)부터 docUrl = /api/export/it-confirms?…&html=1 — 키 없이 열면 401.
    // 키를 주소에 붙이는 건 금지(브라우저 기록·로그에 남음) → 이런 주소는 링크로 안 보여 줌.
    if (u.pathname.startsWith('/api/export/') || u.searchParams.has('key')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ───────────────────────── IT 처리 상태(D13) ─────────────────────────

/** 처리여부 6단계 — 접수 → 준비중 → 준비완료 → 출고, 그리고 보류·취소. ③ 행이 없으면 '접수' */
export const SALES_CONFIRM_STATUSES = ['접수', '준비중', '준비완료', '출고', '보류', '취소'] as const;
export type SalesConfirmStatus = (typeof SALES_CONFIRM_STATUSES)[number];
/** "끝난 건" — 목록 기본 보기(안 끝난 건 + 지난 7일)에서 씀 */
export const SALES_CONFIRM_DONE_STATUSES: readonly SalesConfirmStatus[] = ['출고', '취소'];

export function isSalesConfirmStatus(v: unknown): v is SalesConfirmStatus {
  return typeof v === 'string' && (SALES_CONFIRM_STATUSES as readonly string[]).includes(v);
}

/** 출고 체크리스트 묶음(D11 — it_prep_photo_items.grp 값). 앞 둘은 기기마다, '기타'는 건마다 */
export const CHECK_GROUP_PER_UNIT = ['데스크탑&노트북', '모니터'] as const;
export const CHECK_GROUP_PER_CONFIRM = '기타';

/** 화면에서 적는 사람 이름을 브라우저에 기억하는 열쇠(로그인 전 — 다른 화면과 같은 방식) */
export const SALES_CONFIRM_ACTOR_KEY = 'firstoa-it.sales-confirm-name';

// ───────────────────────── 주소 ─────────────────────────

/** 보기: 기본 = 영업 확인서 목록, legacy = 예전 화면(시트 기재·간단 등록·정식 납품확인서) 그대로 (D10) */
export type ConfirmFormView = 'sales' | 'legacy';

export function confirmFormViewHref(view: ConfirmFormView): string {
  return view === 'legacy' ? '/confirm-form?view=legacy' : '/confirm-form';
}

/**
 * 상세 주소는 이 함수로만 만듦(2단계부터 쓰임). 영업 id 형식을 몰라서 encodeURIComponent.
 * app/confirm-form/ 아래에 다른 정적 하위 폴더를 만들지 말 것 — 같은 이름의 id 를 가림(§4-2).
 */
export function salesConfirmHref(id: string): string {
  return `/confirm-form/${encodeURIComponent(id)}`;
}

/**
 * "영업에서 수정됨" 판정 — 목록·상세·미리보기·홈이 모두 이 함수 하나로(2026-11-27).
 * 영업 판(ver)이 IT가 마지막으로 확인한 판(③ seen_ver)보다 클 때만.
 * 영업 웹앱은 저장할 때마다 새 판을 쌓음(ver = 판 개수 + 1, 영업 커밋 b33a4c3 의 confirm·swap·svc 저장 코드) → 내용이 바뀌면 ver 가 반드시 오름.
 * 같은 ver 인데 hash 만 다른 건 영업이 export 모양을 넓힌 것(2026-11-27 칸 추가 때 9건 전부 "v1→v1" 로 잘못 뜸)이라 수정이 아님.
 * hash 는 ② 판 원문 구분·바뀐 원문 저장과 "무엇이 바뀌었나"의 기준 판 찾기에만 씀.
 */
export function salesChangedSince(
  seenVer: number | null | undefined,
  ver: number,
): { fromVer: number; toVer: number } | null {
  if (seenVer === null || seenVer === undefined || !Number.isFinite(seenVer)) return null;
  return ver > seenVer ? { fromVer: seenVer, toVer: ver } : null;
}

// ───────────────────────── 가져오기 상태(⑤ it_sales_import_state) ─────────────────────────

export type SalesImportErrorCode =
  | 'no_key' // SALES_EXPORT_KEY 환경값 없음 → 회색 띠
  | 'unauthorized' // 401·403
  | 'not_found' // 404 (주소가 바뀜)
  | 'unreachable' // 시간 초과·5xx·연결 실패
  | 'bad_shape' // 응답 모양이 다름(전부 다르면 하나도 안 씀)
  | 'no_table' // SQL 전(42P01/PGRST205만)
  | 'db_error'; // 그 밖의 DB 오류

export interface SalesImportCounts {
  received: number;
  new: number;
  updated: number;
  unchanged: number;
  older: number;
  skipped: number;
  // (2차 — 설계 E29·E30, 없으면 안 셈) 칸 다시 맞춘 줄 · 같은 판인데 hash 다름 · 받은 기간 안인데 이번에 없음 · 받은 크기 · 걸린 ms
  repaired?: number;
  sameVer?: number;
  missing?: number;
  bytes?: number;
  ms?: number;
}

export interface SalesImportState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** 90일을 받은 날(D14 — 그날 첫 한 번) */
  lastDeepAt: string | null;
  lastWindowDays: number | null;
  lastErrorCode: SalesImportErrorCode | null;
  /** 쉬운 말 이유만(원문·연락처·키 없음) */
  lastError: string;
  lastCounts: SalesImportCounts | null;
}

/** ⑤ 한 줄을 select('*') 로 읽은 모양 */
export interface SalesImportStateRow {
  id: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_deep_at: string | null;
  last_window_days: number | null;
  last_error_code: string | null;
  last_error: string | null;
  last_counts: Partial<SalesImportCounts> | null;
}

const IMPORT_ERROR_CODES: readonly SalesImportErrorCode[] = [
  'no_key',
  'unauthorized',
  'not_found',
  'unreachable',
  'bad_shape',
  'no_table',
  'db_error',
];

/** ⑤ 줄 → 화면용 상태(importer 와 목록 읽기가 같이 씀) */
export function importStateFromRow(row: SalesImportStateRow | null | undefined): SalesImportState | null {
  if (!row) return null;
  const code = IMPORT_ERROR_CODES.includes(row.last_error_code as SalesImportErrorCode)
    ? (row.last_error_code as SalesImportErrorCode)
    : null;
  const c = row.last_counts;
  return {
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastDeepAt: row.last_deep_at,
    lastWindowDays: row.last_window_days,
    lastErrorCode: code,
    lastError: row.last_error ?? '',
    lastCounts: c
      ? {
          received: Number(c.received) || 0,
          new: Number(c.new) || 0,
          updated: Number(c.updated) || 0,
          unchanged: Number(c.unchanged) || 0,
          older: Number(c.older) || 0,
          skipped: Number(c.skipped) || 0,
          // 2차 선택 칸 — 저장된 것만 옮김(없으면 안 셈)
          ...(['repaired', 'sameVer', 'missing', 'bytes', 'ms'] as const).reduce<Partial<SalesImportCounts>>((acc, k) => {
            const v = Number(c[k]);
            if (c[k] !== undefined && c[k] !== null && Number.isFinite(v)) acc[k] = v;
            return acc;
          }, {}),
        }
      : null,
  };
}

/**
 * POST /api/sales-confirms/import 응답 = runSalesConfirmImport 결과 (원문 없음).
 * 일부만 모양이 다르면: ok true · errorCode 'bad_shape' · error "n건은 모양이 달라 건너뛰었어요"(나머지는 반영) → 화면 주황 띠.
 * 전부 다르면: ok false · 'bad_shape' · 하나도 안 씀.
 */
export interface SalesImportRouteResult {
  ok: boolean;
  /** 겹침 막기로 이번엔 안 받음(60초, 강제는 10초 안에 누가 받았음) — 오류 아님 */
  skippedRecent: boolean;
  /** 이번에 ①에 새로 넣거나 바꾼 건수(new + updated) — 0 보다 크면 화면이 목록을 다시 읽음 */
  changed: number;
  /** 이번 시도의 오류(성공·skippedRecent 면 null) */
  errorCode: SalesImportErrorCode | null;
  /** 쉬운 말 이유(화면 띠에 그대로) */
  error: string;
  /** 시도 뒤 ⑤ 상태(표가 없으면 null) */
  state: SalesImportState | null;
  /** 진단(diag: true 로 부를 때만) — 받은 응답의 칸 이름·종류·건수 요약(값 없음, normalize.ts describeShape) */
  shape?: string;
  /** 이번에 받은 기간이 90일(그날 첫 번·autoDeep)이었는지 — 목록 받기일 때만 */
  deep?: boolean;
  /**
   * 한 건 받기({ id })일 때만(설계 E1) — 원문 없음. changed 는 위 숫자(0|1).
   * notFound = 영업이 404(종류가 바뀜 등 — 아무것도 안 씀), ver = 받은 판(못 받았으면 null), salesDeleted = 받은 판이 진짜 지움인지.
   */
  one?: { ver: number | null; notFound: boolean; salesDeleted: boolean };
}

/**
 * importer.ts 가 내보낼 함수(라우트·홈이 부름):
 *   runSalesConfirmImport(opts: { force?: boolean; since?: string; trigger: SalesImportTrigger; diag?: boolean; id?: string }): Promise<SalesImportRouteResult>
 *     id 가 있으면 한 건 받기(E1): ① 의 type 으로 `?id=&type=`(헤더 키, 4초), ⑤ 'one' 줄 3초 간격, 쓰기 규칙은 목록과 같음(①② 만).
 *   readSalesImportState(): Promise<SalesImportState | null>   // 표가 없으면 null
 * 'detail' = 상세 화면(열 때·60초·탭 복귀), 'print' = 출력 창 열 때 — 둘 다 한 건 받기.
 */
export type SalesImportTrigger = 'page' | 'interval' | 'manual' | 'pick-date' | 'home' | 'detail' | 'print';

/**
 * 중계 라우트 POST /api/sales-confirms/form-html { id } 응답(설계 E8) — 영업 html=1(그 순간 영업 최신 양식)을 **JSON 으로만** 감싸 줌.
 * text/html 로 절대 안 내보냄(우리 주소에서 영업 HTML 이 페이지로 열리면 안 됨). 키는 헤더로만(주소에 안 붙임).
 *   copy_only    = 환경값 SALES_FORM_SOURCE=copy(끄는 스위치) — 화면은 사본으로
 *   busy         = ⑤ 'html' 줄 2초 간격에 걸림 — 화면은 사본으로(또는 잠시 뒤 다시)
 *   not_found    = ① 에 없는 id 이거나 영업 404
 *   too_big      = 2MB 넘음
 *   그 밖 = SalesImportErrorCode 와 같은 뜻(no_key·unauthorized·unreachable·db_error)
 */
export type SalesFormHtmlResult =
  | { ok: true; html: string }
  | {
      ok: false;
      reason: 'copy_only' | 'busy' | 'not_found' | 'too_big' | 'no_key' | 'unauthorized' | 'unreachable' | 'bad_request' | 'db_error';
      /** 쉬운 말(출력 창 위 한 줄에 그대로) */
      message: string;
    };

// ───────────────────────── 목록(1단계) ─────────────────────────

export interface SalesConfirmListRow {
  id: string;
  docNo: string;
  ver: number;
  /** 'YYYY-MM-DD' | null */
  deliveryDate: string | null;
  /** 접수일시 = ① first_saved_at (없으면 first_seen_at) ISO */
  receivedAt: string | null;
  status: SalesConfirmStatus;
  /** 접수자 */
  savedBy: string;
  /** 처리자(③ processors) */
  processors: string[];
  salesRep: string;
  type: string;
  term: string;
  company: string;
  region: string;
  /** contacts.phone — D7 지금은 그냥 보임 */
  phone: string;
  /** "데스크탑 3 · 모니터 3" */
  itemSummary: string;
  /** "I5/16/512 · 24인치" 꼴(IT 고친 값 우선) */
  specSummary: string;
  /** IT가 고친 사양이 하나라도 있음 */
  specEdited: boolean;
  /** ④ 자산번호(입력된 것만, 칸 순서) */
  assetIds: string[];
  serials: string[];
  /** 자산번호가 들어간 칸 수 / 전체 칸 수(품목 qty 합) */
  unitsFilled: number;
  unitsTotal: number;
  /** 소모품 요약 "키보드 3(무상) · 랜선 2" */
  suppliesSummary: string;
  special: string;
  /** ③ note (비고) */
  note: string;
  /** 아무도 상세를 안 열어 봄(③ first_opened_at 없음) */
  isNew: boolean;
  /** IT가 마지막으로 확인한 뒤 영업이 고침 — { fromVer: seen_ver, toVer: ver } */
  salesChanged: { fromVer: number; toVer: number } | null;
  /** 영업에서 취소·삭제 신호(있으면) — 없으면 '' */
  salesState: string;
  /** safeDocUrl 을 거친 값 */
  docUrl: string | null;
  /** ③ updated_at(동시 수정 확인용) — ③ 행이 없으면 null */
  workUpdatedAt: string | null;
  /** ① first_seen_at ISO */
  firstSeenAt: string;
  // ── 2+3단계(developer C 가 listQuery 에서 채움) ──
  /** 영업 지역이 비어 주소로 추정한 값이면 true(region 에 추정값이 들어 있음) */
  regionGuessed?: boolean;
  /** 영업 요청이 바뀌어 차이 확인이 풀린 칸 수(D27 "다시 확인 필요") */
  recheckCount?: number;
  /** 마지막으로 출력한 영업 판(③ printed_ver) — 없으면 null */
  printedVer?: number | null;
  /** 출력 뒤 영업이 고쳤거나(ver > printedVer) IT 값이 바뀜 → "다시 뽑기" */
  printStale?: boolean;
  // ── 2차(2026-11-27) — salesState 가 SALES_STATE_DELETED 일 때만 뜻 있음 ──
  /** 영업에서 지운 시각(ISO)·지운 사람(① payload 의 deletedAt·deletedBy, normalize 로) */
  salesDeletedAt?: string | null;
  salesDeletedBy?: string;
  /** 따로 보는 종류(판매·철수·이전 — isOtherSalesType(type)) — 목록이 칩으로 나눔 */
  other?: boolean;
  // ── 4-0(2026-11-27 사용자: 오늘 준비할 것 · 직송 따로 — 설계 docs/tasks/2026-11-27-sales-confirm-prep-merge.md F25~F30) ──
  /** 직송(매입처 → 고객사, 우리를 안 거침) — deliveryMode.isDirectShip(영업 consign·shipType·head). 목록 '직송' 항목, 오늘 준비할 것·숫자 카드·홈에서 빠짐 */
  directShip?: boolean;
  /** 위탁사(매입처) 이름 — 직송·위탁 건만, 아니면 '' */
  consignName?: string;
  // ── 4-1(출고 준비 짝짓기 — 이 파일 맨 아래 4-1 절) ──
  /** 출고 준비 칸(목록 보이는 줄만 따로 읽음 — listConfirmPrepBadges). 안 읽었으면 없음 */
  prepBadge?: PrepLinkState;
}

/** 목록 위 항목(F29) — 출고 준비 확인서 · 직송 · 철수·이전·판매 */
export type SalesListGroup = 'ship' | 'direct' | 'other';

export interface SalesConfirmListData {
  rows: SalesConfirmListRow[];
  importState: SalesImportState | null;
  /** 처리자 고르기 명단(it_prep_people 중 is_active, 순서대로) */
  people: string[];
  /** 서버가 읽은 범위 설명(예: "최근 90일 + 안 끝난 건") */
  rangeLabel: string;
  /** 키 환경값이 있는지(값은 안 보냄) — false 면 회색 띠 */
  hasKey: boolean;
}

export type SalesConfirmListResult =
  | { ok: true; data: SalesConfirmListData }
  | { ok: false; missingTable: true }
  | { ok: false; missingTable?: false; error: string };

/** 1단계 읽기 전용 미리보기 창(줄을 누르면) — 2단계부터는 상세 주소로 바뀜 */
export interface SalesConfirmPreviewData {
  confirm: NormalizedSalesConfirm;
  status: SalesConfirmStatus;
  processors: string[];
  note: string;
  firstSeenAt: string;
  changedAt: string | null;
  fetchedAt: string;
  /** 받아 둔 버전 수(② 행 수) */
  versionCount: number;
  /** safeDocUrl 을 거친 값 */
  docUrl: string | null;
  /** IT가 마지막으로 확인한 뒤 영업이 고침 — 미리보기의 [확인함] 버튼이 보임 */
  salesChanged: { fromVer: number; toVer: number } | null;
  /** 지금 ① payload_hash — [확인함] 때 그대로 돌려보냄 */
  payloadHash: string;
  /** ③ updated_at(없으면 null) */
  workUpdatedAt: string | null;
}

// ───────────────────────── 시트와 비교(전환 기간, 읽기만 §3-8) ─────────────────────────

export type SheetMatchState = 'same' | 'diff' | 'missing';

export interface SheetCompareEntry {
  state: SheetMatchState;
  /** 다른 칸 이름(예: ['처리여부', '자산번호']) */
  diffs: string[];
  /** 맞은 시트 줄 번호(1부터, 머리줄 포함) */
  sheetRow: number | null;
  /** 맞은 줄의 시트 값 요약(표시용 — 연락처 N칸은 읽지도 않음) */
  sheetStatus: string;
  sheetAssetIds: string[];
}

/** 시트에만 있는 줄(영업 웹앱 밖에서 들어온 건 확인용) — 연락처 없음 */
export interface SheetOnlyRow {
  sheetRow: number;
  deliveryDateText: string; // 시트 그대로 '11월27일'
  receivedText: string; // '11.25 16:32'
  status: string;
  type: string;
  company: string;
  items: string;
  assetIds: string[];
}

export type SheetCompareResult =
  | { ok: true; byConfirm: Record<string, SheetCompareEntry>; sheetOnly: SheetOnlyRow[]; readAt: string }
  | { ok: false; error: string };

// ───────────────────────── 서버 액션(app/confirm-form/salesActions.ts — developer B) ─────────────────────────
/*
 *   listSalesConfirms(): Promise<SalesConfirmListResult>
 *       가져오기 뒤(changed > 0) 화면이 다시 부름. loadSalesConfirmList 와 같은 결과.
 *   setSalesConfirmStatus(input: { id: string; status: SalesConfirmStatus; actor: string; expectedUpdatedAt: string | null })
 *       : Promise<SalesWorkSaveResult>
 *   setSalesConfirmProcessors(input: { id: string; processors: string[]; actor: string; expectedUpdatedAt: string | null })
 *       : Promise<SalesWorkSaveResult>
 *       ↑ 둘 다 ③ 행이 없으면 만듦(expectedUpdatedAt null). 상태를 바꿀 때 비어 있으면 시각도 채움:
 *         준비중 → started_at, 준비완료 → finished_at, 출고 → shipped_at (덮어쓰지 않음).
 *   openSalesConfirmPreview(input: { id: string; actor: string })
 *       : Promise<{ ok: true; data: SalesConfirmPreviewData } | { ok: false; error: string }>
 *       줄을 누르면 부름. ③ first_opened_at 이 비었으면 지금·actor 로 채우고("새로" 표시 끝),
 *       seen_ver 가 비었으면 지금 ver·hash 로 채움(처음 본 판 = 확인한 판).
 *   acknowledgeSalesConfirmChange(input: { id: string; ver: number; payloadHash: string; actor: string })
 *       : Promise<SalesWorkSaveResult>      ← "영업에서 수정됨" [확인함] — seen_ver·seen_hash 를 그 값으로
 *   compareSalesConfirmsWithSheet(ids: string[]): Promise<SheetCompareResult>
 *
 * 가져오기는 서버 액션이 아니라 라우트(POST /api/sales-confirms/import) — 서버 액션은 한 화면에서 차례로 돌아 버튼을 붙잡음.
 */
export type SalesWorkSaveResult =
  | { ok: true; workUpdatedAt: string }
  /** expectedUpdatedAt 이 DB 와 달라 저장 안 함 → 화면은 목록을 다시 읽음 */
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; error: string };

// =====================================================================================
// 2+3단계 — 상세(기기 칸 입력·차이 확인·라이선스 키) + 출력(영업 양식 그대로). 설계 §3-4·§3-9~§3-11·§4-2·§4-3, D15~D30
// 파일·담당:
//   lib/salesConfirms/itemKind.ts (팀장, 순수)             — 품목 종류·종류별 칸 규칙
//   lib/salesConfirms/salesForm/confirm.ts (팀장, 영업 사본) — ConfDoc·hasSpec·specKeys·regionOf …
//   developer C: slots.ts·specCompare.ts·diff.ts·prepMatch.ts(순수), work.ts(server-only), app/confirm-form/[id]/page.tsx,
//                app/confirm-form/salesDetailActions.ts('use server'), listQuery.ts 고침
//   developer E: lib/contracts/salesConfirmLink.ts(server-only), app/confirm-form/salesLicenseActions.ts('use server')
//   developer D: salesForm/confirmDoc.ts(영업 사본 + P1~P6), printFill.ts(순수), public/confirm/rabbit.png, normalize.ts(출력용 칸)
//   ui-designer: components/salesConfirms/* 상세·출력 화면
// =====================================================================================

/** 차이 확인 칸 이름 — 'maker' · 'model' · 'spec:<사양 칸>' (예: 'spec:RAM') */
export type DiffField = 'maker' | 'model' | `spec:${SalesSpecKey}`;

/** 영업 요청과 출고 값이 다른 칸 하나 */
export interface DiffItem {
  field: DiffField;
  /** 영업 요청 값(비어 있지 않음 — 빈 요청은 비교 안 함) */
  sales: string;
  /** 출고 값(IT 입력) */
  actual: string;
}

/** ④ diff_ack — 칸마다 "이 (영업 값, 출고 값) 쌍을 누가 언제 확인함". 지금 쌍이 기록과 다르면 확인 안 된 것(다시 물음) */
export type DiffAckMap = Partial<Record<DiffField, { sales: string; actual: string; at: string; by: string }>>;

/** ④ extra — 키는 절대 안 넣음 */
export interface SalesUnitExtra {
  /** 소프트웨어: 설치 PC 자산번호 */
  pc?: string;
  /** 소프트웨어: 사용자 */
  user?: string;
  /** 소프트웨어: 지난번 대장에 올린 값(대장에서 사람이 고친 칸은 안 덮기 위한 비교용 — §3-11) */
  ledgerPushed?: { product?: string; pc?: string; user?: string; at?: string };
  /**
   * `＋ 줄 추가`로 만든 줄(2026-11-27 사용자 결정 — 영업 수량보다 더 내보내는 기기). slots.ts 가 영업 수량 칸 뒤에 정상 칸으로 붙임
   * (표시 없는 넘는 칸은 지금처럼 "영업에서 빠진 칸"). 종이엔 '추가 출고 기기' 장, 완료 보고·카톡·IT재고엔 다른 칸과 같이 감.
   */
  added?: boolean;
}

/** ④ 한 줄 화면 모양 */
export interface SalesUnitRow {
  id: string;
  slotKey: string;
  unitNo: number;
  /** 이 칸을 채울 때의 영업 품목 — 영업이 품목을 바꾸면 비교해 경고 */
  itemSnapshot: SalesConfirmItem | null;
  assetId: string;
  serial: string;
  actualMaker: string;
  actualModel: string;
  specOverride: SalesSpec;
  checks: Record<string, { at: string; by: string }>;
  note: string;
  extra: SalesUnitExtra;
  diffAck: DiffAckMap;
  /** 동시 수정 확인용 — DB 문자열 그대로(µs) */
  updatedAt: string;
  updatedBy: string;
}

/** 칸 계산 결과 하나(slots.ts) — unit 이 null 이면 아직 아무것도 안 적은 칸 */
export interface SalesSlot {
  slotKey: string;
  unitNo: number;
  unit: SalesUnitRow | null;
  /** 영업 요청과 다른데 확인 안 된 칸(영업 요청이 바뀌어 풀린 것 포함) — 없으면 [] */
  unackedDiffs: DiffItem[];
  /** `＋ 줄 추가`로 영업 수량 뒤에 붙은 칸(④ extra.added, unit_no > 영업 수량) — 영업 수량 안 칸은 없음(undefined) */
  added?: boolean;
}

/** 품목 줄 하나 + 그 줄의 기기 칸 */
export interface SalesSlotLine {
  /** 영업 items 배열 안 순서(0부터) */
  itemIndex: number;
  item: SalesConfirmItem;
  kind: ItemKind;
  /** '데스크탑#1' 꼴(종류 + 같은 종류 안 순서) */
  slotKey: string;
  slots: SalesSlot[];
  /** 이 품목의 영업 요청이 칸을 채울 때와 달라짐(item_snapshot 비교) — 경고·[확인함] */
  snapshotChanged: boolean;
}

/** 상세 화면 데이터(openSalesConfirm) */
export interface SalesConfirmDetailData {
  /** 저장된 payload 를 지금 normalize 로 다시 읽은 것 */
  confirm: NormalizedSalesConfirm;
  /** 영업 지역이 비어 주소로 추정했으면 그 값(화면 "(추정)") — 아니면 null */
  regionGuess: string | null;
  lines: SalesSlotLine[];
  /** 영업에서 빠진 칸(갈 곳 없는 ④ 중 뭐라도 적은 것) */
  orphans: SalesUnitRow[];
  work: {
    status: SalesConfirmStatus;
    processors: string[];
    startedAt: string | null;
    finishedAt: string | null;
    shippedAt: string | null;
    note: string;
    checks: Record<string, { at: string; by: string }>;
    firstOpenedAt: string | null;
    printedAt: string | null;
    printedVer: number | null;
    printedBy: string;
    /** ③ updated_at — 없으면 null(아직 행 없음) */
    updatedAt: string | null;
  };
  salesChanged: { fromVer: number; toVer: number } | null;
  /** 영업에서 수정됨일 때 무엇이 바뀌었나(쉬운 말 목록, diff.ts — 마지막 확인한 판 ↔ 지금). 없으면 [] */
  changes: string[];
  payloadHash: string;
  versionCount: number;
  docUrl: string | null;
  firstSeenAt: string;
  changedAt: string | null;
  fetchedAt: string;
  /** 처리자 명단(it_prep_people) */
  people: string[];
  /** 출고 체크리스트 항목(it_prep_photo_items — 읽기만) */
  checklist: { label: string; grp: string }[];
  /**
   * @deprecated 4-1 부터 `prepLink` 를 쓸 것 — 화면(PrepHintBox)이 PrepLinkPanel 로 바뀌면 지움.
   * 지금은 prepLink 의 연결·자동 일정 + 후보(최대 5)를 옛 모양으로 옮겨 담음(따로 보는 종류는 []).
   */
  prepHints: { eventId: string; date: string; title: string; prepState: string; reportSent: boolean }[];
  /** 4-1: 출고 준비 일정 연결 상태 + 후보(§4-C). null = 못 읽음(notices 에 쉬운 말). 연결 쓰기의 기준 시각은 work.updatedAt(늘 최신)을 쓸 것 */
  prepLink: PrepLinkState | null;
  /** SQL 블록 A(④ extra·diff_ack, ③ printed_ver·printed_by) 실행 여부 — false 면 기기 칸 저장을 막고 "SQL 실행 필요" */
  schemaReady: boolean;
  /** 진행(장비·모니터·유지보수만 셈 — itemKind countsProgress) */
  progress?: { filled: number; total: number };
  /** 이 확인서 자산번호 중 다른 확인서 ④ 에도 있는 것: 자산번호 → 다른 확인서들(취소 건 제외, 최대 5) */
  assetElsewhere?: Record<string, { confirmId: string; docNo: string; company: string }[]>;
  /** 일부를 못 읽었을 때의 쉬운 말(처리자 명단·체크리스트·출고 준비 후보·같은 자산번호·판 비교) — 화면은 주황 한 줄씩(실패를 삼키지 않음) */
  notices?: string[];
  /** 4-0: 직송(F28 — formDoc 으로 같은 판정)·위탁사 이름. 상세는 그대로 열림(사용자 결정 Q5), 위에 "직송 — 매입처 ○○" 띠 */
  directShip?: boolean;
  consignName?: string;
}

/** 기기 칸 저장 결과(saveSalesUnit·applyLineValues·ackUnitDiffs·ackDiffsForPrint·moveOrphanUnit·deleteOrphanUnit·addSalesUnit·removeAddedSalesUnit) */
export type SalesUnitSaveResult =
  | { ok: true; units: SalesUnitRow[] }
  /**
   * 확인 기록을 남기려는데 지금 확인 안 된 차이가 acks 에 다 없음 → 아무것도 안 씀(ackUnitDiffs·ackDiffsForPrint — 그 사이 값이 바뀜).
   * 2026-11-27 사용자 결정으로 **저장(saveSalesUnit·applyLineValues)은 이걸 안 돌려줌** — 차이는 노란 표시, 확인은 인쇄 때 한 번에.
   */
  | { ok: false; needAck: DiffItem[]; error: string }
  /** updated_at 이 달라 저장 안 함 → 상세를 다시 읽음 */
  | { ok: false; conflict: true; error: string }
  /** SQL 블록 A 전 */
  | { ok: false; needSql: true; error: string }
  | { ok: false; error: string };

/*
 * 서버 액션 — app/confirm-form/salesDetailActions.ts (developer C):
 *   openSalesConfirm(input: { id: string; actor: string }): Promise<{ ok: true; data: SalesConfirmDetailData } | { ok: false; notFound?: true; error: string }>
 *       (처음 열람·seen_ver 채우기는 1단계 openSalesConfirmPreview 와 같은 규칙)
 *   saveSalesUnit(input: { confirmId: string; slotKey: string; unitNo: number; unitId: string | null; expectedUpdatedAt: string | null;
 *                          patch: { assetId?; serial?; actualMaker?; actualModel?; specOverride?: SalesSpec; note?; extra?: SalesUnitExtra;
 *                                   checks?: { label: string; on: boolean }[] };
 *                          acks: DiffItem[]; actor: string }): Promise<SalesUnitSaveResult>
 *   applyLineValues(input: { confirmId; itemIndex; values: { specOverride?: SalesSpec; actualModel?: string; actualMaker?: string }; acks: DiffItem[]; actor })
 *       : Promise<SalesUnitSaveResult>
 *   ackUnitDiffs(input: { confirmId; unitId; acks: DiffItem[]; actor }): Promise<SalesUnitSaveResult>        ← 칸의 "요청과 다름" [확인]
 *   ackDiffsForPrint(input: { confirmId; acks: { unitId; diffs: DiffItem[] }[]; actor }): Promise<SalesUnitSaveResult>
 *       ← 출력 창 [인쇄](IT 기재) 전 "영업 요청과 다른 칸 n개" [맞아요, 인쇄] — 종이에 나가는 칸 전부를 한 번에 확인 기록(diff_ack)
 *   addSalesUnit(input: { confirmId; itemIndex; actor }) / removeAddedSalesUnit(input: { confirmId; unitId; expectedUpdatedAt; actor })
 *       ← `＋ 줄 추가`·`✕ 줄 빼기`(납품 확인서의 장비·모니터·기타 줄만 — slots.addLineAllowed)
 *   moveOrphanUnit(input: { confirmId; unitId; toSlotKey; toUnitNo; actor }) / deleteOrphanUnit(input: { confirmId; unitId; actor })
 *       : Promise<SalesUnitSaveResult>
 *   saveSalesWork(input: { confirmId; expectedUpdatedAt: string | null;
 *                          patch: { status?; processors?; startedAt?; finishedAt?; shippedAt?; note?; checks?: { label: string; on: boolean }[] }; actor })
 *       : Promise<SalesWorkSaveResult>
 *   lookupSalesUnitAsset(input: { assetId: string; hint?: string; confirmId?: string })
 *       : Promise<{ ok: true; maker: string; model: string; serials: string[]; specHint: string;
 *                   dupes: { confirmId: string; docNo: string; company: string }[] }   // 다른 확인서 ④ 에 같은 자산번호(이 확인서 빼고)
 *                 | { ok: false; error: string }>
 *   ackSnapshot(input: { confirmId; itemIndex; actor }): Promise<SalesUnitSaveResult>   // "영업 품목이 바뀌었어요" [확인함] — 그 줄 칸들의 item_snapshot 을 지금 영업 품목으로
 *   markSalesConfirmPrinted(input: { confirmId: string; ver: number; actor: string }): Promise<SalesWorkSaveResult>
 *
 * work.ts (developer C, server-only) — developer E 가 import:
 *   ensureUnitRow(confirmId: string, slotKey: string, unitNo: number, actor: string): Promise<SalesUnitRow>   // ④ 행이 없으면 만듦(item_snapshot 포함)
 *   readUnit(confirmId: string, unitId: string): Promise<{ unit: SalesUnitRow; kind: ItemKind; item: SalesConfirmItem | null } | null>
 *   updateUnitExtra(unitId: string, extra: SalesUnitExtra, actor: string)   // 넘긴 칸만 extra 에 합치고 새 줄을 돌려줌 — ledgerPushed 기록(키 없음).
 *       ※ ④ updated_at 이 바뀌므로 키 저장·대장 올리기 뒤 화면은 상세를 다시 읽어야 가짜 충돌이 안 남
 */

// ───────────────────────── 라이선스 키(developer E — §3-11, D28~D30) ─────────────────────────

/** 칸 하나의 대장·키 상태(키 값은 잠금이 풀렸을 때만) */
export interface UnitLicenseState {
  unitId: string;
  /** none = 대장에 아직 없음 · linked = 좌석 있음 · pending = 일반 칸이 바뀌어 대장 반영 대기 · changed = 대장에서 사람이 고침 · deleted = 대장에서 좌석이 지워짐 */
  ledger: 'none' | 'linked' | 'pending' | 'changed' | 'deleted';
  /** 대장에서 바뀐 칸 설명(예: "설치 PC: 대장 A0123") */
  ledgerNote: string;
  hasKey: boolean;
  /** 잠금이 풀렸을 때만 값, 아니면 null */
  key: string | null;
}

export interface ConfirmLicenseState {
  unlocked: boolean;
  /** 잠금이 풀려 있으면 남은 분 */
  unlockMinutesLeft: number | null;
  /** 이 확인서로 만든 대장 거래처 이름(없으면 null — 처음 키 저장 때 고름) */
  clientName: string | null;
  units: UnitLicenseState[];
  /** 계약관리 SQL(블록 B — source 'sales_confirm') 전이면 true → 키 저장만 안내 */
  needContractsSql: boolean;
}

/** 대장 거래처 고르기 */
export type LedgerClientChoice =
  | { type: 'existing'; clientId: string }
  /** works 실시간 묶음(아직 저장 안 된 거래처) — 계약관리 ensureClient 규칙 */
  | { type: 'works'; groupKey: string }
  /** 상호('-현장명' 뗀 것)로 새 거래처 */
  | { type: 'new'; name: string }
  /** '미분류(영업 확인서에서)' */
  | { type: 'unsorted' };

export interface LedgerClientCandidate {
  choice: LedgerClientChoice;
  label: string;
  recommended: boolean;
}

export type LicenseActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; needUnlock: true; error: string }
  /** 이 확인서로 만든 거래처가 아직 없음 → 거래처 고르기 창 */
  | { ok: false; needClient: true; candidates: LedgerClientCandidate[]; error: string }
  | { ok: false; needContractsSql: true; error: string }
  | { ok: false; error: string };

/*
 * 서버 액션 — app/confirm-form/salesLicenseActions.ts (developer E). 키·대장 쓰기는 전부 requireUnlock(있음 표시만 예외):
 *   getConfirmLicenseState(input: { confirmId: string }): Promise<LicenseActionResult<ConfirmLicenseState>>   // 잠겨 있어도 ok(키 값만 null)
 *   listLedgerClientCandidates(input: { confirmId: string }): Promise<LicenseActionResult<LedgerClientCandidate[]>>
 *   saveUnitLicenseKey(input: { confirmId; slotKey; unitNo; unitId: string | null; key: string; client?: LedgerClientChoice; actor })
 *       : Promise<LicenseActionResult<ConfirmLicenseState>>
 *   saveLineLicenseKey(input: { confirmId; itemIndex; key: string; client?: LedgerClientChoice; actor })
 *       : Promise<LicenseActionResult<ConfirmLicenseState>>                                           // [같은 키를 모든 칸에]
 *   pushUnitsToLedger(input: { confirmId; unitIds?: string[]; client?: LedgerClientChoice; actor }): Promise<LicenseActionResult<ConfirmLicenseState>>
 *   getSalesPrintKeys(input: { confirmId: string }): Promise<LicenseActionResult<Record<string, string>>>   // ④ id → 키, view_bulk 기록
 * 잠금 해제는 계약관리 그대로 — app/contracts/secretActions.ts 의 해제 액션·components/contracts/PasswordGate.tsx(import 만, 안 고침).
 */

// ───────────────────────── 출력(developer D — §3-9, D15~D18·D21~D23·D25·D30) ─────────────────────────

// ── 1차(2026-11-27, 설계 docs/tasks/2026-11-27-sales-export-b33a4c3.md E4~E23) — 옛 P1·P2·P3(납품)·출고 명세 옵션·D22 한도 폐기 ──
// 흐름(출력 창): ① 한 건 받기(import { id, trigger:'print' }) → ② 중계 form-html → 영업 실시간 HTML
//   → DOMParser(스크립트 안 도는 빈 문서) → body data-it-spec 확인 → ③ 안 되면 사본 renderCopy(…, marks=true) 를 DOMParser
//   → ④ itFill.applyFillPlan(doc, plan) → '<!doctype html>' + outerHTML → sandbox iframe(allow-same-origin 금지).
// 채우기는 한 길: printFill.buildFillPlan(순수) = "어느 표시 칸에 무슨 값", itFill.applyFillPlan(DOM) = 넣기. 정규식으로 HTML 고치기 금지.
//
// printFill.ts(developer D) 가 내보낼 것:
//   buildFillPlan(input: SalesPrintInput): SalesFillPlan                                     — 순수, 브라우저·Node 어디서나
//   renderCopy(doc: Record<string, unknown>, renderer: SalesRenderer, origin: string, withBack: boolean, marks: boolean, regionFill?: string | null): string
//                                                                                             — 사본(b33a4c3) 그리기. marks=false 면 영업 원본과 글자까지 같음
//   SALES_FORM_COPY_LABEL: string                                                             — 출력 창 "받아 둔 양식(○○판)" 글자
//   SALES_PRINT_MSG_SOURCE / _PRINT / _OVERFLOW / _SIZE                                       — iframe 신호 이름(지금 그대로)
// salesForm/itFill.ts(developer D) 가 내보낼 것:
//   IT_MARK(표시 이름 상수) · fillKey(mark, item?, unit?) · readFormMarks(doc: Document): SalesFormMarks
//   applyFillPlan(doc: Document, plan: SalesFillPlan, renderer: SalesRenderer): SalesFillApplyResult   — textContent·createElement 로만
//   serializeFilled(doc: Document): string                                                    — '<!doctype html>' + documentElement.outerHTML

export interface SalesPrintOptions {
  /** 2면(출고·설치 확인) 포함 — 기본 false(영업 b33a4c3 이 기본으로 안 냄, E18). 납품만 뜻 있음 */
  withBack: boolean;
  /** 라이선스 키 — 'shown' = licenseKeys 의 값을 찍음, 'blank' = 그 자리 빈칸(D30) */
  keys: 'shown' | 'blank';
  /** 'fill' = IT 기재 넣음(출력 기록 남김) · 'original' = 영업 원본 그대로(채우기 없음·기록 안 남김, E22) */
  mode: SalesPrintMode;
}

export type SalesPrintMode = 'fill' | 'original';

export interface SalesPrintNote {
  tone: 'info' | 'warn';
  text: string;
}

/** buildFillPlan 입력 — 화면(상세 데이터)에서 바로 만듦, 서버 안 부름(키만 따로) */
export interface SalesPrintInput {
  detail: SalesConfirmDetailData;
  /** ④ id → 라이선스 키(잠금이 풀렸을 때 getSalesPrintKeys 로 받은 것 — 출력 창 메모리에만) */
  licenseKeys: Record<string, string>;
  options: SalesPrintOptions;
  nowIso: string;
  /** 출력하는 사람(꼬리 "IT 기재") */
  actor: string;
}

/** 칸에 넣을 글자 한 토막 — emph = 영업 요청과 다름(굵게+밑줄, 흑백 인쇄라 색 안 씀, E14) */
export interface SalesFillPart {
  text: string;
  emph: boolean;
}

/** 표시 칸 하나에 넣을 값 */
export interface SalesFillCell {
  parts: SalesFillPart[];
  /** 칸 아래 작은 굵은 줄(교체 "출고 ○○" — E19) — 없으면 '' */
  sub: string;
}

/** 유지보수·소프트웨어 'IT 기재 명세' 장(E20) — 영업 고객 서명 장 뒤에 같은 틀·색으로 붙음 */
export interface SalesSvcSheet {
  /** 'IT 기재 명세 — 유지보수 대상 기기' | 'IT 기재 명세 — 소프트웨어 라이선스' */
  title: string;
  /** 작은 머리(영업 값 그대로) */
  company: string;
  startDate: string;
  docNo: string;
  /** 머리줄(순 포함) — 유지보수: 순·품목·자산번호·S/N / 소프트웨어: 순·제품·설치 PC·사용자·라이선스 키 */
  columns: string[];
  /** 줄마다 칸 글자(순 포함). 안 채운 대수는 빈 글자 줄 */
  rows: string[][];
}

/**
 * 납품 '추가 출고 기기' 장 — `＋ 줄 추가`로 영업 수량보다 더 적은 기기(SalesSlot.added). 영업 종이엔 그 줄이 없으니
 * 마지막 영업 장 뒤(2면이 있으면 그 앞)에 같은 틀·색으로 붙임(itFill.applyFillPlan — DOM 으로만). 칸 값은 SalesFillCell(요청과 다른 토막 강조).
 */
export interface SalesExtraSheet {
  title: string;
  company: string;
  deliveryDate: string;
  docNo: string;
  /** 순 · 품목 · 제조사 · 모델명 · 자산번호 · S/N · 출고 사양 */
  columns: string[];
  /** 대마다 한 줄(품목 순서 → 칸 번호 순), 칸 수 = columns 수. 빈 칸 = parts [] (손으로 적기) */
  rows: SalesFillCell[][];
}

/** printFill.buildFillPlan 결과 — 값은 전부 그냥 글자(넣는 쪽이 textContent 로) */
export interface SalesFillPlan {
  /** itFill.fillKey(mark, item, unit) 열쇠 → 칸 값. 원본 모드면 {} */
  cells: Record<string, SalesFillCell>;
  /** 2면 칸(withBack 이고 납품일 때만) */
  back: { preparer: string; shipDate: string } | null;
  /** 꼬리 끝 " · IT 기재 MM-DD HH:mm 이름" — 원본 모드면 '' */
  stamp: string;
  /** svc 일 때만 */
  svcSheet: SalesSvcSheet | null;
  /** 납품에 추가한 줄(SalesSlot.added)이 있을 때만 — 그 칸들은 cells 에 안 들어감(실시간 HTML 에 칸이 없는 게 정상 → missing 아님) */
  extraSheet: SalesExtraSheet | null;
  /** 사본으로 그릴 때 doc 복사본 region 이 비면 넣을 추정 지역(D21) — 영업 실시간 HTML 엔 안 씀 */
  regionFill: string | null;
  notes: SalesPrintNote[];
  /** 출력을 막는 이유(옛 원문이라 formDoc·renderer 없음 등) — 없으면 null */
  blocked: string | null;
}

/** <body> 표시(영업이 붙이거나 사본이 marks=true 로 붙임) — 없으면 spec null */
export interface SalesFormMarks {
  spec: string | null;
  form: SalesRenderer | null;
  ver: number | null;
  id: string | null;
}

/** applyFillPlan 결과 */
export interface SalesFillApplyResult {
  /** 넣을 값이 있는데 갈 칸을 못 찾은 열쇠들(값 없음) — 실시간 HTML 에서 1개라도 있으면 E7 고르기 */
  missing: string[];
  /** 실제로 값을 넣은 칸 수 */
  filled: number;
}

/** 출력 창이 그린 결과(화면 상태) */
export interface SalesPrintBuild {
  html: string;
  /** 'live' = 영업 실시간 HTML · 'copy' = 받아 둔 사본(SALES_FORM_COPY_LABEL) */
  source: 'live' | 'copy';
  /** copy 일 때 쉬운 말 이유(예: "영업 양식에 아직 IT 칸 표시가 없어요") — live 면 '' */
  sourceReason: string;
  missing: string[];
  notes: SalesPrintNote[];
  blocked: string | null;
}

// =====================================================================================
// 4단계 4-1 — 영업 확인서 ↔ 출고 준비 일정 짝짓기·서로 보이기
// 설계 docs/tasks/2026-11-27-sales-confirm-prep-merge.md F1~F8 · §4-A~§4-C (사용자 답 Q4 = 제목·날짜가 다 같을 때만 자동).
// 파일·담당:
//   lib/salesConfirms/prepLinkRules.ts (순수 — developer A)  짝 등급·제목 열쇠·상호·구분·상태 판정(resolvePrepLinks) 한 곳
//   lib/salesConfirms/prepLink.ts (server-only — developer A) 읽기(확인서 쪽·일정 쪽·목록 줄)·연결 쓰기(③ prep_event_id·link_source 만)
//   app/confirm-form/prepLinkActions.ts ('use server' — developer B) 아래 액션 주석
//   components/salesConfirms/PrepLinkPanel.tsx · components/shipmentPrep/PrepConfirmBadge.tsx (ui-designer)
// 원칙: 화면 열기만으로는 아무것도 안 씀(F4) · 네이버·카톡·시트·it_prep_* 표엔 안 씀(읽기만) · 가져오기 코드는 prepLink 를 import 도 안 함.
// =====================================================================================

/**
 * ③ link_source 값(F2·§4-A) — DB CHECK 없음(앱이 검사, status 처럼).
 *   ''       아무도 안 정함(prep_event_id null) — 확실한 짝이 있으면 화면 계산으로 "자동 연결"
 *   'auto'   확실한 짝을 저장함(사람이 그 건으로 무언가 할 때 — 4-2·4-3)
 *   'manual' 사람이 고름
 *   'none'   사람이 "출고 일정과 연결 안 함"(풀기·출고 일정 없음으로 두기 — prep_event_id null)
 *   'auto'·'manual' 인데 prep_event_id 가 null = 연결했던 일정이 지워짐(FK set null — F8)
 */
export const PREP_LINK_SOURCES = ['', 'auto', 'manual', 'none'] as const;
export type PrepLinkSource = (typeof PREP_LINK_SOURCES)[number];

export function isPrepLinkSource(v: unknown): v is PrepLinkSource {
  return typeof v === 'string' && (PREP_LINK_SOURCES as readonly string[]).includes(v);
}

/**
 * 짝 등급(F3·§4-B):
 *   sure   = 영업 확인서 제목(confTitle 로 만든 것)과 일정 제목의 `IT/` 뒤가 같고 날짜가 같음
 *   strong = 상호(제목 '/' 칸 어디든) + 날짜 ±1일 + 구분 + 지역(둘 다 알 때)
 *   weak   = 상호 + ±3일 + 구분(지역이 둘 다 있고 다르면 뺌)
 */
export const PREP_LINK_GRADES = ['sure', 'strong', 'weak'] as const;
export type PrepLinkGrade = (typeof PREP_LINK_GRADES)[number];

/** 확인서 쪽에서 본 일정 하나(연결된 일정·후보 둘 다 이 모양) — 연락처·주소 없음 */
export interface PrepLinkCandidate {
  eventId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM' | ''(종일) */
  time: string;
  /** 네이버 일정 제목 그대로(출고 준비 리스트에 보이는 글자) */
  title: string;
  /** 일정 시각으로 본 지역(9시 A·12시 B·15시 C·18시 D·21시 E, 그 밖 null — regionSlot) */
  regionOfEvent: string | null;
  /** ★(네이버)·⭐(앱) 없음 → 출고 준비 리스트엔 안 보임(H10) — "영업에 별표 부탁" */
  notPrepTarget: boolean;
  /** 짝 등급. candidates 안에선 늘 있음. 저장된 연결 일정이 규칙에 안 맞으면(날짜를 옮김 등) null */
  grade: PrepLinkGrade | null;
  /** 납품일과 날짜 차(절댓값, 일). 납품일이 없거나 계산 못 하면 null */
  dayDiff: number | null;
  /** 상호가 제목 칸과 통째로 같음(false = '-' 앞 상호만 같음 또는 상호 안 맞음) */
  exactCompany: boolean;
  /** 준비 단추 기록이나 완료 보고가 있음 — 같은 제목 일정 여럿(복사본)일 때 이쪽을 위로. 상세에서만 채움(목록·배지는 false) */
  hasPrepRecord: boolean;
  /** "홍길동 준비완료 · 김철수 준비중" / "준비 전" — 상세에서만(목록·배지는 '') */
  prepState: string;
  /** 완료 보고 카톡 보냄 — 상세에서만(목록·배지는 false) */
  reportSent: boolean;
  /** 이 일정에 이미 저장 연결된 **다른** 확인서(일정 1 → 확인서 여럿 허용 — F2). 없으면 [] */
  linkedConfirms: { confirmId: string; docNo: string }[];
}

/**
 * 확인서 하나의 연결 상태(§4-C — 위에서부터 첫 번째):
 *   linked     ① 저장됨('manual'·'auto') + 일정 있음 → "연결됨" / "연결됨(자동)"  [바꾸기] [풀기]
 *   off        ② 'none' → 자동·"일정 없음" 알림 안 함, 후보는 접어서
 *   broken     ③ 'manual'·'auto' 인데 일정이 지워짐(F8) → 주황 "연결했던 일정이 없어졌어요 — 다시 골라 주세요" + 후보
 *   auto       ④ 화면 계산 자동 연결(아직 저장 안 함 — F4): sure 일정이 딱 하나 · 그 일정의 sure 확인서도 딱 하나 ·
 *                그 일정에 다른 확인서의 저장 연결 없음 · 이 확인서 link_source '' · 지움·취소·직송·따로 보기 아님
 *   candidates ⑤ 후보 있음 → [연결]
 *   notTarget  ⑥ 직송(F28·F29)·따로 보는 종류(철수·이전·판매) — 출고 준비 대상 아님, 알림 없음, 후보 계산 안 함
 *                (저장된 연결은 ①~③ 으로 그대로 보임 — 출고 준비 쪽 배지에서 연결할 수 있음 F7)
 *   noEvent    ⑦ 납품일 있음 + 일정 없음 → "출고 일정 없음"(주황 — 알림은 alertNoEvent 로)
 *   unknown    ⑦ 납품일 없음
 */
export type PrepLinkKind = 'linked' | 'off' | 'broken' | 'auto' | 'candidates' | 'notTarget' | 'noEvent' | 'unknown';

export interface PrepLinkState {
  kind: PrepLinkKind;
  /** ③ 에 저장된 값 그대로(③ 줄이 없으면 '' · null) */
  savedSource: PrepLinkSource;
  savedEventId: string | null;
  /** linked = 저장된 일정 · auto = 계산한 짝. 그 밖 null */
  event: PrepLinkCandidate | null;
  /** event 를 뺀 후보(sure → strong → weak, 그 안에서 기록 있음·상호 통째·날짜 가까움·시각 순). notTarget·unknown 은 [] */
  candidates: PrepLinkCandidate[];
  /** sure(제목·날짜 같음) 일정 수 — 2 이상이면 "같은 제목 일정 n개 — 복사본일 수 있어요" */
  sureCount: number;
  /**
   * sure 일정이 있는데 자동이 안 된 이유(화면 안내용) — 없으면 null
   *   copies   같은 제목 일정이 둘 이상(복사본)
   *   shared   그 일정에 제목이 같은 다른 확인서도 있음
   *   taken    그 일정에 다른 확인서가 이미 저장 연결됨
   *   excluded 이 확인서가 영업에서 지움·처리여부 취소(후보로만)
   */
  autoBlocked: 'copies' | 'shared' | 'taken' | 'excluded' | null;
  /** notTarget 일 때만 — 'direct' 직송 · 'other' 따로 보는 종류 */
  notTargetReason: 'direct' | 'other' | null;
  /**
   * "출고 일정 없음" 알림에 셀지(목록 칩·홈 — F5·F18) = noEvent 이고 영업에서 지움·처리여부 취소가 아님.
   * 날짜 거르기(내일 납품 등)는 부르는 쪽이. 직송·'none'·따로 보기는 kind 가 달라 처음부터 false
   */
  alertNoEvent: boolean;
  /** 읽은 때의 ③ updated_at(DB 문자열 그대로, ③ 줄 없으면 null) — 목록·배지에서 연결할 때 expectedUpdatedAt. 상세는 work.updatedAt 을 쓸 것 */
  workUpdatedAt: string | null;
}

/** 일정 쪽에서 본 확인서 하나(출고 준비 리스트 배지 — F6·F7·F30). 연락처·주소 없음 */
export interface PrepConfirmBadgeItem {
  confirmId: string;
  docNo: string;
  /** 영업 상호(상호-현장) */
  company: string;
  /** 영업 구분('납품'|'교체'|'유지보수'|'소프트웨어'|'철수'…) */
  type: string;
  deliveryDate: string | null;
  status: SalesConfirmStatus;
  /** 'manual'·'auto' = ③ 에 저장 · 'computed' = 화면 계산 자동(F4, 아직 저장 안 함) · null = 후보 */
  link: 'manual' | 'auto' | 'computed' | null;
  /** 이 일정과의 짝 등급(저장 연결인데 규칙에 안 맞으면 null) */
  grade: PrepLinkGrade | null;
  dayDiff: number | null;
  exactCompany: boolean;
  /** 확인서 지역(영업 값, 비면 주소 추정 — 없으면 '') */
  region: string;
  /** F30 "확인서는 직송" */
  directShip: boolean;
  salesDeleted: boolean;
  /** 따로 보는 종류(철수·이전·판매 — F7 보기용 연결) */
  other: boolean;
  /** 후보인데 이 확인서가 이미 **다른** 일정에 저장 연결됨 → "같은 확인서가 다른 일정에 연결돼 있어요" — 그 일정 id, 아니면 null */
  linkedElsewhere: string | null;
  /** ③ updated_at(없으면 null) — 여기서 [연결]할 때 expectedUpdatedAt */
  workUpdatedAt: string | null;
}

/** 출고 준비 일정 하나의 확인서 배지 — linked(저장 + 계산 자동) · candidates(등급 순) */
export interface PrepConfirmBadge {
  eventId: string;
  /** 'linked' 연결된 확인서 있음 · 'candidates' 후보만 · 'none' 확인서 없음(흐리게 — F6) */
  kind: 'linked' | 'candidates' | 'none';
  linked: PrepConfirmBadgeItem[];
  candidates: PrepConfirmBadgeItem[];
}

/** 연결 쓰기 결과 — ③ updated_at 이 바뀌므로 화면은 workUpdatedAt 으로 갱신(H16) */
export type PrepLinkSaveResult =
  | { ok: true; workUpdatedAt: string; prepEventId: string | null; linkSource: PrepLinkSource }
  /** expectedUpdatedAt 이 DB 와 다름(그 사이 누가 ③ 을 고침) → 화면은 다시 읽음 */
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; error: string };

/** 연결 읽기 결과 — 확인서 표가 없으면(42P01/PGRST205 — listQuery.isMissingSalesTable) missingTable(출고 준비 쪽은 배지 없이 그대로 — §4-G) */
export type PrepLinkReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; missingTable: true; error: string }
  | { ok: false; missingTable?: false; error: string };

/*
 * 서버 액션 — app/confirm-form/prepLinkActions.ts ('use server' — developer B, async 함수만 export). 전부 lib/salesConfirms/prepLink.ts 를 부르기만:
 *   getConfirmPrepLink(input: { confirmId: string }): Promise<PrepLinkReadResult<PrepLinkState>>
 *       → readPrepLinkForConfirm(confirmId, { withRecords: true }) — null 이면 { ok:false, error:'확인서를 못 찾았어요…' }. 연결·풀기 뒤 상자 다시 그리기용
 *   linkConfirmPrepEvent(input: { confirmId: string; eventId: string; expectedUpdatedAt: string | null; actor: string }): Promise<PrepLinkSaveResult>
 *       → writeConfirmLink({ confirmId, eventId, source: 'manual', expectedUpdatedAt, actor })   // [연결]·[바꾸기]·자동 짝 [이걸로 확정]
 *   unlinkConfirmPrepEvent(input: { confirmId: string; expectedUpdatedAt: string | null; actor: string }): Promise<PrepLinkSaveResult>
 *       → writeConfirmLink({ …, eventId: null, source: 'none' })                                  // [풀기]·[출고 일정 없음으로 두기]
 *   resetConfirmPrepLink(input: { confirmId: string; expectedUpdatedAt: string | null; actor: string }): Promise<PrepLinkSaveResult>
 *       → writeConfirmLink({ …, eventId: null, source: '' })                                      // 'none' 되돌리기 = 다시 자동으로 찾기
 *   listConfirmPrepBadges(input: { confirmIds: string[] }): Promise<PrepLinkReadResult<Record<string, PrepLinkState>>>
 *       → readConfirmPrepBadges(ids) — 목록 보이는 줄(최대 500). 목록 60초 가져오기 고리에 넣지 말 것(열 때·5분마다 — §9-11)
 *   listEventConfirmBadges(input: { eventIds: string[] }): Promise<PrepLinkReadResult<Record<string, PrepConfirmBadge>>>
 *       → readEventConfirmBadges(ids) — 출고 준비 리스트에 보이는 일정(최대 300). listPrepEvents 모양은 안 바꿈(H14)
 *   ※ 표 없음 판정은 listQuery.isMissingSalesTable(err) → missingTable. 그 밖 오류는 로그 code 만(work.logSalesFail) + 쉬운 말.
 *   ※ 자산 n/m·출력함 같은 목록 요약이 배지에 필요하면 listQuery.loadListRowsByIds(연결된 id) 로(H19) — prepLink 는 안 읽음.
 *
 * prepLink.ts 가 내보내는 것(server-only):
 *   readPrepLinkForConfirm(confirmId: string, opts?: { withRecords?: boolean }): Promise<PrepLinkState | null>   // 확인서 없으면 null, DB 오류는 던짐
 *   readConfirmPrepBadges(confirmIds: string[]): Promise<Record<string, PrepLinkState>>      // 없는 id 는 빠짐
 *   readEventConfirmBadges(eventIds: string[]): Promise<Record<string, PrepConfirmBadge>>   // 없는 일정 id 는 빠짐
 *   writeConfirmLink(input: { confirmId: string; eventId: string | null; source: 'manual' | 'none' | ''; expectedUpdatedAt: string | null; actor: string })
 *       : Promise<PrepLinkSaveResult>        // ③ 줄 없으면(expectedUpdatedAt null) 만듦 — first_opened_at·seen_ver 는 안 채움("새로" 유지)
 *   saveComputedAutoLink(confirmId: string, eventId: string, actor: string)
 *       : Promise<{ saved: boolean; workUpdatedAt: string | null }>   // 4-2·4-3(보고 저장·발송·준비 단추)에서: 지금도 그 일정이 자동 짝이고
 *                                                                      // ③ 이 prep_event_id null + link_source '' 일 때만 'auto' 로(사람이 정한 것 안 덮음)
 */

// =====================================================================================
// 4단계 4-2 — 기기 한 번만 적기(연결된 건의 완료 보고 기기 = 확인서 ④ 기기 칸)
// 설계 docs/tasks/2026-11-27-sales-confirm-prep-merge.md F9~F14 · F22 · F23 · §4-D · §8 "4-2 연동 규칙 기준"(이 기준이 우선).
// 파일·담당(developer C):
//   lib/salesConfirms/prepLinkRules.ts (순수)   prepUnitsFromLines · planReportUnitMove · droppedReportUnits · sameReportUnitSet · reportSpecLine
//   lib/salesConfirms/prepLink.ts (server-only) linkedReportSource(eventId, opts) — 연결 판정 + ④ 칸 → 보고 기기(IT재고 색인 1회) · readAssetBriefs
//   app/shipment-prep/reportActions.ts          getPrepReport·savePrepReport·sendPrepReport 확장(아래 주석)
//   app/shipment-prep/actions.ts                getPrepEventRow(eventId) — 확인서 상세에서 완료 보고 창을 열 때
//   app/confirm-form/prepLinkActions.ts         getConfirmPrepReport · importReportUnitsToConfirm
//   app/confirm-form/[id]/page.tsx              maxDuration 60 → 300(상세에서 보낸 보고의 IT재고 반영이 응답 뒤 1분 넘게 돎 — F22)
//   화면(ui-designer): PrepReportModal(확인서 모드) · PrepLinkPanel(📷 완료 보고·보고 상태) · SalesConfirmDetail
// 바뀌지 않는 것: 카톡 문구(buildPrepMessage — units 값만 다름)·방(KAKAO_ROOM)·outbox(enqueueOutbox), stockTargetIds·applyStockUnit·
//   recordStockOutcome·retryPrepStock·getAlbum, 저장 → after() 재고 순서, savePrepReport 의 after(syncPrepToConfirm)·lib/confirmLink.ts.
// 보고 기기를 바꿔 넣는 곳 = reportActions 의 저장(update 직전) 한 곳 — 발송은 저장 뒤 DB 를 다시 읽으므로 카톡·재고·앨범·예전 시트 채우기가 같은 사본을 씀.
// =====================================================================================

/** 보고 기기 하나를 가리키는 두 값(자산번호는 대문자) — "보고에만 있는 기기"·"빠지는 기기" 목록 */
export interface PrepUnitRef {
  assetId: string;
  serial: string;
}

/** 이 일정의 보고 기기 출처 확인서 하나 */
export interface LinkedReportConfirm {
  confirmId: string;
  docNo: string;
  /** 영업 상호(상호-현장) — 연락처·주소 없음 */
  company: string;
  type: string;
  deliveryDate: string | null;
  /** 'manual'·'auto' = ③ 에 저장 · 'computed' = 화면 계산 자동(보고 저장·발송 때 서버가 'auto' 로 굳힘 — F4) */
  link: 'manual' | 'auto' | 'computed';
  status: SalesConfirmStatus;
  directShip: boolean;
  /** 이 확인서의 장비·모니터·기타 칸 수(채웠든 안 채웠든) */
  deviceSlots: number;
  /** 그중 보고로 간 기기 수(자산번호나 시리얼 있음, 같은 번호 1번) */
  unitCount: number;
}

/** 연결됐지만 보고 기기에서 뺀 확인서 — deleted 영업에서 지움 · cancelled 처리여부 취소 · other 따로 보는 종류(철수·이전·판매 — 보고 창에서 직접, F7) */
export interface LinkedReportExcluded {
  confirmId: string;
  docNo: string;
  reason: 'deleted' | 'cancelled' | 'other';
}

/**
 * 출고 일정 하나의 완료 보고 기기 출처(§4-D) — prepLink.linkedReportSource 결과.
 *   mode 'confirm' = 연결된 확인서(저장 연결 또는 확실 자동 — 후보는 안 셈)에 장비·모니터·기타 칸이 하나라도 있음 →
 *                    보고 창의 기기는 보기만 + [확인서에서 고치기], 저장·발송 때 서버가 확인서에서 다시 만듦(화면이 보낸 units 는 무시 — F9)
 *   mode 'legacy'  = 연결 없음 · 유지보수·소프트웨어만 · 따로 보는 종류 → 지금처럼 보고 창에서 직접(F10)
 */
export interface LinkedReportSource {
  mode: 'confirm' | 'legacy';
  /** 보고 기기 출처 확인서(문서번호 순). legacy 여도 연결된 확인서는 여기(유지보수만 있는 확인서 등) */
  confirms: LinkedReportConfirm[];
  excluded: LinkedReportExcluded[];
  /**
   * 확인서 칸 → 보고 기기(F10·F11): 장비·모니터·기타 칸 중 자산번호나 시리얼이 있는 것(교체 건은 칸이 곧 교체 후 기기), 같은 자산번호 1번.
   * assetId = ④ 자산번호(대문자) · serial = ④ 시리얼 · model = [출고 제조사 || 영업 제조사, 출고 모델 || 영업 모델] ·
   * gubun = IT재고 구분 · spec = IT가 고친 출고사양이 있으면 그 요약(목록 사양 요약과 같은 꼴), 없으면 IT재고 사양 ·
   * category = IT재고 품목 || 영업 품목구분 · grade = 지금 보고의 같은 기기 값.
   * IT재고에 없거나 못 읽으면(inventoryWarning) 구분·사양은 지금 보고의 같은 기기 값. legacy 면 [].
   */
  units: PrepUnit[];
  skipped: {
    /** 유지보수·소프트웨어 칸 중 자산번호·시리얼 있는 것(보고에 안 넣음 — F10) */
    svc: number;
    /** "영업에서 빠진 칸" 중 자산번호·시리얼 있는 것(안 넣음 — 창에 "n칸은 영업에서 빠져 안 넣었어요") */
    orphan: number;
    /** 장비·모니터·기타 칸 중 아직 자산번호·시리얼이 빈 칸 */
    empty: number;
    /** 같은 자산번호(자산번호 없으면 시리얼)가 두 번 — 한 번만 넣음 */
    dupe: number;
  };
  /** 지금 보고에만 있는 기기(확인서에 없음 — F12 [확인서 빈 칸으로 옮기기]). confirm 모드에서만, 아니면 [] */
  reportOnly: PrepUnitRef[];
  /** 보낸 보고(sent_at)의 기기(자산번호·시리얼 묶음) ≠ 지금 확인서에서 만든 기기 → "보고 뒤 바뀜"(표시만 — 자동 재발송·재반영 없음, F13) */
  changedSinceSent: boolean;
  /** 같은 확인서의 다른 일정(제목·날짜가 같은 복사본)에서 이미 보낸 보고 — 보고 창 경고(F14). 없으면 [] */
  copyReports: { eventId: string; date: string; title: string; sentAt: string }[];
  /** IT재고 색인을 못 읽음(구글시트) — 쉬운 말, 아니면 null(색인을 안 읽은 요약 읽기도 null) */
  inventoryWarning: string | null;
}

/** 보고에만 있는 기기 → 확인서 빈 칸 옮기기 결과(F12 — 자산번호·시리얼만, 제조사·모델·사양은 안 옮김) */
export type ReportUnitsImportResult =
  | {
      ok: true;
      /** 옮긴 것(칸 위치) */
      moved: (PrepUnitRef & { slotKey: string; unitNo: number })[];
      /** 못 옮긴 것 — noCategory IT재고에서 품목을 못 찾음 · noSlot 같은 종류 빈 칸 없음 · conflict 그 사이 누가 그 칸을 고침(멈춤) */
      left: (PrepUnitRef & { reason: 'noCategory' | 'noSlot' | 'conflict' })[];
      /** 하나라도 옮겼으면 ④ updated_at 이 바뀜 → 화면은 상세를 다시 읽을 것(가짜 충돌 방지) */
      changed: boolean;
    }
  | { ok: false; error: string };

/*
 * 4-2 서버 액션 — 화면(ui-designer)이 부르는 것. 실패 문구는 쉬운 말, 로그는 code 만(payload·연락처·Supabase details 없음).
 *
 * app/shipment-prep/reportActions.ts ('use server' — 이름·앞 인자는 예전 그대로, 뒤에 opts 만 더함):
 *   getPrepReport(eventId: string)
 *     : Promise<{ ok: true; report: PrepReport | null; photoItems: CheckItem[];
 *                 linked: LinkedReportSource | null;   // null = 확인서 표 없음(예전처럼, 안내 없음) 또는 못 읽음(linkWarning 있음)
 *                 linkWarning?: string }                // 확인서를 못 읽음 → 주황 알림, 창은 예전 모드(직접 적기)
 *               | { ok: false; error: string }>
 *       → linked?.mode === 'confirm' 이면 기기 칸은 linked.units 보기만 + [확인서에서 고치기](salesConfirmHref(confirms[0].confirmId)),
 *         linked.reportOnly(보고에만 있는 기기 n대 + [확인서 빈 칸으로 옮기기] — 확인서가 둘 이상이면 고르게), skipped(빠진 칸 안내),
 *         copyReports(복사본 일정에서 이미 보냄 경고), changedSinceSent("보고 뒤 바뀜"), inventoryWarning, excluded(뺀 확인서 안내).
 *         맨 위 "확인서 D-… 기기 n대를 보내요"(설계 위험 1). 확인서 모드에서도 draft.units 에는 linked.units 를 그대로 넣어 보낼 것
 *         (서버가 확인서를 못 읽으면 그 목록으로 저장·발송 — F23).
 *       ※ linked 는 report 와 따로(보고 줄이 아직 없어도 확인서 기기를 보여 줘야 해서 — 설계의 "PrepReport.linked?" 대신).
 *   savePrepReport(eventId: string, draft: ReportDraft, opts?: PrepReportSaveOptions)
 *     : Promise<({ ok: true } & PrepReportSaved) | PrepReportFail>
 *   sendPrepReport(eventId: string, draft: ReportDraft, photoItemCount: number, mode: 'send' | 'resend' | 'fix' = 'send', opts?: PrepReportSaveOptions)
 *     : Promise<({ ok: true; message: string; stockPending: number } & PrepReportSaved) | PrepReportFail>
 *       (PrepReportSaveOptions·PrepReportSaved·PrepReportFail·PrepReportAckKind 는 lib/shipmentPrep.ts)
 *       - 확인서 모드: 서버가 확인서에서 기기를 다시 만들어 저장(unitsFrom 'confirm', units = 저장한 기기 → 창 갱신)
 *       - needAck(PrepReportFail) = 저장 안 함 → 화면이 확인 창(error 문구 그대로 + dropped 목록)을 띄우고 "예"면 같은 호출에 opts.ack 로 다시:
 *           'noUnits'   확인서 모드인데 자산번호·시리얼 있는 칸 0대(send·resend 만) — "확인서에 기기가 없어요. 기기 없이 보낼까요?"(§4-D)
 *           'dropUnits' 지금 보고에 있던 기기가 이번 저장에서 빠짐(확인서에 없음 — 확인서 모드의 모든 저장·발송) — 보고에만 있는 기기를 조용히 지우지 않게
 *       - alreadySent(PrepReportFail) = 처음 발송(send)인데 이미 보낸 보고(F14 — 서버가 막음) → "수정해서 다시 보내기"로 안내, 창은 다시 읽기
 *       - linkWarning(성공) = 확인서를 못 읽어 창에 보이던 기기로 저장·발송함 → 주황 알림(toast-warn, 저절로 안 닫힘 — F23).
 *         확인서를 못 읽었는데 보낸 기기가 0대면 send·resend 는 거절(쉬운 말 error)
 *       - inventoryWarning(성공) = IT재고를 못 읽어 구분·사양은 예전 보고 값 → 주황 알림
 *       - autoLinked(성공) = 이번 저장으로 'auto' 로 굳힌 확인서와 새 ③ updated_at → 열린 확인서 상세는 work.updatedAt 갱신(H16)
 *
 * app/shipment-prep/actions.ts ('use server'):
 *   getPrepEventRow(eventId: string): Promise<{ ok: true; event: PrepEventRow } | { ok: false; error: string }>
 *       → listPrepEvents 한 줄과 같은 모양·계산(reportSent·photoCount·stockProblem). ★·IT 거르기 없음(★ 없는 일정도 연결돼 있으면 보고는 열림 — 위험 10).
 *         확인서 상세에서 <PrepReportModal event={…} people={data.people} /> 를 열 때.
 *
 * app/confirm-form/prepLinkActions.ts ('use server'):
 *   getConfirmPrepReport(input: { confirmId: string; eventId: string })
 *     : Promise<PrepLinkReadResult<{ event: PrepEventRow; linked: LinkedReportSource; role: 'source' | 'excluded' | 'notLinked' }>>
 *       → 출고 준비 상자의 보고 상태(보냄·사진 n장·재고 문제 n대 = event, 보고 뒤 바뀜·보고에만 있는 기기 = linked) + 창 열기용 event.
 *         IT재고 색인은 안 읽음(linked.units 의 구분·사양은 비어 있을 수 있음 — 숫자·묶음 비교용). role = 이 확인서가 보고 기기 출처인지.
 *   importReportUnitsToConfirm(input: { confirmId: string; eventId: string; actor: string }): Promise<ReportUnitsImportResult>
 *       → F12 [확인서 빈 칸으로 옮기기]. 이 확인서가 그 일정에 연결(저장·자동)돼 있을 때만. 보고 기기 중 확인서에 없는 것을
 *         IT재고 품목(노트북·데스크탑 → 장비, 모니터 → 모니터, 나머지 → 기타)으로 같은 종류 빈 칸에 차례로(자산번호·시리얼만,
 *         ④ 줄 없으면 item_snapshot = 지금 영업 품목으로 만듦, 칸마다 updated_at 조건부 — 그 사이 누가 고치면 멈춤). 보고는 안 고침.
 *         뒤에 화면은 상세를 다시 읽고(④ updated_at), 완료 보고 창을 다시 열면 기기가 확인서 기준으로 보임.
 */
