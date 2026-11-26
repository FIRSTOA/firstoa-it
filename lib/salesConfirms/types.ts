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
 *   ⑤ it_sales_import_state    id text PK ('main' 한 줄, SQL 이 만들어 둠) · last_attempt_at · last_success_at · last_deep_at ·
 *                              last_window_days int · last_error_code · last_error · last_counts jsonb · updated_at
 */

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
}

export interface SalesConfirmSupply {
  name: string;
  qty: number;
  /** '무상' | '청구' | '' */
  charge: string;
  note: string;
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
}

/**
 * importer.ts 가 내보낼 함수(라우트·홈이 부름):
 *   runSalesConfirmImport(opts: { force?: boolean; since?: string; trigger: SalesImportTrigger }): Promise<SalesImportRouteResult>
 *   readSalesImportState(): Promise<SalesImportState | null>   // 표가 없으면 null
 */
export type SalesImportTrigger = 'page' | 'interval' | 'manual' | 'pick-date' | 'home';

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
}

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
