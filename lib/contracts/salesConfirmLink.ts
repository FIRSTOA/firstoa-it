import 'server-only';

/**
 * 영업 확인서 소프트웨어 칸 ↔ 계약관리 소프트웨어 대장(거래처·상품·좌석·라이선스 키) 연결.
 * 설계 docs/tasks/2026-11-26-sales-confirm-import.md §3-11 (D28~D30). 화면 타입은 lib/salesConfirms/types.ts "라이선스 키" 절.
 *
 * - **계약관리 쪽 유일한 새 파일** — 기존 lib/contracts/* 는 import 만(고치지 않음).
 * - 라이선스 키 값은 secrets.ts(writeSecret·readSecretsForOwners)로만 읽고 씀. ④·③·서버 로그·오류 문구에 값을 싣지 않음.
 * - 값을 읽거나 쓰거나 대장에 쓰는 함수는 맨 앞에서 requireUnlock — 있음 표시(confirmLicenseFlags)만 예외.
 * - ④ 는 칸 목록을 읽기만. 쓰기는 work.ts(ensureUnitRow·updateUnitExtra — developer C).
 *   칸 계산(어느 칸이 소프트웨어인지·영업에서 빠진 칸)은 slots.ts 한 곳 것을 그대로 씀.
 * - 대장 열쇠(source 'sales_confirm'): 상품 source_key 'sales_confirm:<확인서 id>:<제품명 정규화>',
 *   좌석 'sales_confirm_unit:<④ id>' — 여러 번 눌러도 상품·좌석 하나(upsert on conflict do nothing).
 * - 대장 덮어쓰기 규칙: 좌석의 설치 PC·사용자, 상품 이름은 "대장의 지금 값 = 지난번 우리가 올린 값(④ extra.ledgerPushed)"일 때만 바꿈
 *   (대장에서 사람이 고친 칸은 안 덮고 '대장에서 바뀜'). 상품 이름은 이 확인서가 만든 상품이고 좌석이 전부 이 확인서 칸이며
 *   그 칸들의 제품명이 모두 같을 때만 바꿈(다른 좌석이 같이 쓰는 상품 이름을 한 칸 때문에 바꾸지 않음).
 * - Supabase 오류는 code 만 로그에 — details 에는 행 값("Failing row contains …")이 들어 있음.
 */

import {
  CONTRACT_CLIENTS_TABLE,
  SALES_CONFIRM_WORK_TABLE,
  SW_CONTRACTS_TABLE,
  SW_SEATS_TABLE,
  createAdminClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  UserError,
  buildContractsOverview,
  createManualClientRow,
  ensureClient,
  loadSavedClients,
  readPages,
} from '@/lib/contracts/clients';
import { nameKey } from '@/lib/contracts/nameKey';
import {
  UnlockRequired,
  logSecretEvent,
  parseSecretOwner,
  readSecretsForOwners,
  readUnlockState,
  requireUnlock,
  secretFlags,
  writeSecret,
} from '@/lib/contracts/secrets';
import { buildSlotLines, findSlotLine, kindOfSlotKey, slotItems } from '@/lib/salesConfirms/slots';
import { ensureUnitRow, readConfirmRecord, readUnit, readUnitsFor, updateUnitExtra } from '@/lib/salesConfirms/work';
import type {
  ConfirmLicenseState,
  LedgerClientCandidate,
  LedgerClientChoice,
  SalesConfirmItem,
  SalesSlotLine,
  SalesUnitExtra,
  SalesUnitRow,
  UnitLicenseState,
} from '@/lib/salesConfirms/types';

// ═══════════════════════ 순수 함수 (PURE-BEGIN — nameKey 말고는 import 없이 돎, Node 로 확인) ═══════════════════════

/** 대장 표(it_sw_contracts·it_sw_seats) source 값 — 계약관리 SQL 블록 B 의 CHECK 목록 */
export const LEDGER_SOURCE = 'sales_confirm';
/** 거래처를 못 정했을 때 — 나중에 계약관리에서 moveSwContract 로 옮김 */
export const UNSORTED_CLIENT_NAME = '미분류(영업 확인서에서)';
/** 확인서·영업 모두 제품명이 비었을 때 상품 이름(시트 옮기기와 같은 글자) */
export const NO_PRODUCT_NAME = '(상품명 미입력)';
/** 라이선스 키 한 칸 최대 길이(secrets.ts 상한 4000 안) */
export const LICENSE_KEY_MAX = 2000;

const CONTRACT_KEY_HEAD = 'sales_confirm:';
const SEAT_KEY_HEAD = 'sales_confirm_unit:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * 확인서 id 모양(영업 id — 실측 16자 글자). 대장 열쇠 안에 그대로 들어가므로 구분자 ':'·LIKE 와일드카드 '%' '*'·
 * 역슬래시·공백·제어 글자는 받지 않음(앞부분 찾기가 다른 확인서 열쇠에 걸리지 않게).
 */
export function isConfirmIdShape(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 100 && !/[\s\u0000-\u001f\u007f\\:%*]/.test(v);
}

/** 제품명 정규화 — 같은 확인서의 같은 제품 줄은 한 상품. 대소문자·공백·흔한 기호 무시('C++'·'C#' 은 남김) */
export function productKey(name: string): string {
  const k = String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·.,\-_/\\()[\]{}'"`:;]+/g, '');
  return k.slice(0, 120) || 'blank';
}

export function contractSourceKey(confirmId: string, product: string): string {
  return `${CONTRACT_KEY_HEAD}${confirmId}:${productKey(product)}`;
}

/** 이 확인서로 만든 상품 열쇠의 앞부분 */
export function confirmContractPrefix(confirmId: string): string {
  return `${CONTRACT_KEY_HEAD}${confirmId}:`;
}

export function seatSourceKey(unitId: string): string {
  return `${SEAT_KEY_HEAD}${String(unitId).toLowerCase()}`;
}

/** 좌석 열쇠 → ④ id(소문자). 우리 열쇠가 아니면 null */
export function unitIdOfSeatKey(key: string | null | undefined): string | null {
  if (typeof key !== 'string' || !key.startsWith(SEAT_KEY_HEAD)) return null;
  const id = key.slice(SEAT_KEY_HEAD.length);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** 영업 상호 = "상호-현장명" → '-' 앞 부분(새 거래처 이름). 앞이 비면 전체 */
export function companyBaseName(company: string): string {
  const c = String(company ?? '').replace(/\s+/g, ' ').trim();
  const first = (c.split(/\s*[-–—]\s*/)[0] ?? '').trim();
  return first || c;
}

/** 거래처 추천용 이름 키 — 상호 전체 · 첫 '-' 앞 · 마지막 '-' 앞(상호에 '-' 가 들어 있는 경우) */
export function companyNameKeys(company: string): string[] {
  const c = String(company ?? '').replace(/\s+/g, ' ').trim();
  const parts = c.split(/\s*[-–—]\s*/).filter((p) => p.trim() !== '');
  const names = [c, parts[0] ?? '', parts.length > 2 ? parts.slice(0, -1).join('-') : ''];
  return [...new Set(names.map((n) => nameKey(n)).filter((k) => k !== ''))];
}

/** 설치 PC 자산번호 — 대장 규칙(saveSwSeat): 공백 제거·대문자, 50자 */
export function normPc(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 50);
}

export function cleanUserName(v: unknown): string {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** 칸의 제품명 = 출고 제품명(④ actual_model), 없으면 영업 모델명. 상품 이름 칸 한도 200자 */
export function productOf(unit: { actualModel?: string | null }, item: { model?: string | null } | null): string {
  const own = String(unit.actualModel ?? '').trim();
  const sales = String(item?.model ?? '').trim();
  return (own || sales).slice(0, 200);
}

/** timestamptz → 한국 날짜 'YYYY-MM-DD' */
export function kstDateOf(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
}

export function ymdOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * 대장 칸 하나 비교: same = 확인서 값과 같음 / push = 대장 값이 지난번 우리가 올린 값 그대로라 덮어도 됨 /
 * changed = 대장에서 사람이 고침(안 덮음). 올린 기록이 없으면 대장 칸이 빈 칸일 때만 push.
 */
export type FieldSync = 'same' | 'push' | 'changed';
export function fieldSync(ledger: string, want: string, pushed: string | undefined): FieldSync {
  if (ledger === want) return 'same';
  if (pushed !== undefined ? ledger === pushed : ledger === '') return 'push';
  return 'changed';
}

/** 라이선스 키 입력 정리 — 앞뒤 공백·줄바꿈만 뗌. 빈 값 = 지우기. 값은 오류 문구에 안 넣음 */
export function cleanLicenseKey(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: '라이선스 키 값이 올바르지 않아요.' };
  const v = raw.replace(/\r\n?/g, '\n').trim();
  if (v.length > LICENSE_KEY_MAX) return { ok: false, error: `라이선스 키가 너무 길어요(${LICENSE_KEY_MAX}자까지).` };
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)) return { ok: false, error: '라이선스 키에 쓸 수 없는 글자가 있어요.' };
  return { ok: true, value: v };
}

export function cleanActorName(raw: unknown): string {
  return typeof raw === 'string'
    ? raw
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40)
    : '';
}

// ═══════════════════════ PURE-END ═══════════════════════

// ───────────── 오류 ─────────────

/** 화면에 그대로 보여 줘도 되는 쉬운 말 오류(값 없음) */
export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkError';
  }
}

/** 이 확인서로 만든 대장 거래처가 아직 없음 → 거래처 고르기 창 */
export class NeedClientError extends Error {
  readonly candidates: LedgerClientCandidate[];
  constructor(candidates: LedgerClientCandidate[]) {
    super('이 확인서의 소프트웨어를 둘 대장 거래처를 먼저 골라 주세요.');
    this.name = 'NeedClientError';
    this.candidates = candidates;
  }
}

/** 계약관리 SQL 블록 B(출처 'sales_confirm') 전 */
export class NeedContractsSqlError extends Error {
  constructor() {
    super(
      '계약관리 SQL 추가 블록(supabase/contracts_schema.sql 맨 끝 — 출처 sales_confirm)을 먼저 실행해 주세요. 라이선스 키는 저장되지 않았어요(확인서의 다른 칸은 그대로 저장돼요).',
    );
    this.name = 'NeedContractsSqlError';
  }
}

const SQL_A_MSG =
  '영업 확인서 SQL 추가 블록(supabase/sales_confirms_schema.sql 맨 끝)을 먼저 실행해 주세요 — 그 전엔 라이선스 키를 넣거나 대장에 올릴 수 없어요.';
const CONTRACT_SQL_FIRST = '계약 관리 표가 아직 없어요 — supabase/contracts_schema.sql 을 먼저 실행해 주세요.';
const NOT_SOFTWARE = '소프트웨어 칸이 아니에요 — 라이선스 키는 소프트웨어 품목 칸에만 넣을 수 있어요.';
const ORPHAN_UNIT = '영업에서 빠진 칸이에요 — 다른 칸으로 옮긴 뒤 넣어 주세요(이미 넣은 키는 계약관리에서 고칠 수 있어요).';
const UNIT_GONE = '그 칸을 못 찾았어요 — 영업이 품목을 바꿨을 수 있어요. 화면을 새로 고쳐 주세요.';
const BAD_CHOICE = '거래처 고르기 값이 올바르지 않아요. 다시 골라 주세요.';
/** 한 번에 대장에 올리는 칸 수 상한 */
const MAX_PUSH_UNITS = 200;

type Db = ReturnType<typeof createAdminClient>;

function db(): Db {
  if (!isSupabaseConfigured()) throw new LinkError('Supabase 설정이 필요해요.');
  return createAdminClient();
}

function codeOf(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code?: unknown }).code ?? '') : '';
}
/** 판정용으로만(로그·화면에 안 씀). details 는 아예 안 읽음 — 행 값이 들어 있음 */
function messageOf(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message ?? '') : '';
}

/** 계약관리 SQL 블록 B 전 — 23514 이면서 문구에 출처 CHECK 이름이 있을 때만(다른 23514 는 그대로 오류) */
function isSourceCheckMissing(e: unknown): boolean {
  return codeOf(e) === '23514' && /it_sw_contracts_source_check|it_sw_seats_source_check/.test(messageOf(e));
}

const lc = (s: string) => String(s).toLowerCase();
const sameId = (a: string, b: string) => lc(a) === lc(b);

function chunk<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ───────────── 확인서 읽기(①③④ — 읽기만) ─────────────

export type ConfirmCtx = {
  confirmId: string;
  docNo: string;
  ver: number;
  company: string;
  deliveryDate: string | null;
  /** ③ shipped_at(좌석 설치일) */
  shippedAt: string | null;
  items: SalesConfirmItem[];
  /** slots.ts buildSlotLines — 지금 영업 품목의 칸 + 붙은 ④ */
  lines: SalesSlotLine[];
  /** 영업에서 빠진 칸(뭐라도 적은 것) */
  orphans: SalesUnitRow[];
  /** 이 확인서의 ④ 전부 */
  units: SalesUnitRow[];
  /** SQL 블록 A(④ extra) 실행됨 */
  schemaReady: boolean;
};

/** ①③④ 읽기 — ①·④ 는 상세와 같은 함수(work.ts: 원문을 지금 normalize 로 다시 읽음, 블록 A 전이면 schemaReady false) */
export async function loadConfirmCtx(confirmId: unknown): Promise<ConfirmCtx> {
  if (!isConfirmIdShape(confirmId)) throw new LinkError('확인서 주소가 올바르지 않아요. 목록에서 다시 열어 주세요.');
  const supabase = db();
  const [rec, workRes, unitRes] = await Promise.all([
    readConfirmRecord(supabase, confirmId),
    supabase.from(SALES_CONFIRM_WORK_TABLE).select('shipped_at').eq('confirm_id', confirmId).maybeSingle(),
    readUnitsFor(supabase, confirmId),
  ]);
  if (workRes.error) throw workRes.error;
  if (!rec) throw new LinkError('확인서를 못 찾았어요. 목록을 새로고침해 주세요.');

  const items = slotItems(rec.confirm);
  const units = unitRes.units.filter((u) => isUuid(u.id));
  const { lines, orphans } = buildSlotLines(items, units);
  const work = workRes.data as { shipped_at: string | null } | null;
  return {
    confirmId,
    docNo: rec.confirm.docNo,
    ver: rec.ver,
    company: rec.confirm.company,
    deliveryDate: ymdOrNull(rec.confirm.deliveryDate),
    shippedAt: work?.shipped_at ?? null,
    items,
    lines,
    orphans,
    units,
    schemaReady: unitRes.schemaReady,
  };
}

const docLabel = (ctx: ConfirmCtx) => ctx.docNo || ctx.confirmId;

/** 지금 소프트웨어 품목 칸에 붙은 ④ */
function placedSoftware(ctx: ConfirmCtx): { line: SalesSlotLine; unit: SalesUnitRow }[] {
  const out: { line: SalesSlotLine; unit: SalesUnitRow }[] = [];
  for (const line of ctx.lines) {
    if (line.kind !== 'software') continue;
    for (const s of line.slots) if (s.unit) out.push({ line, unit: s.unit });
  }
  return out;
}

function placeOf(ctx: ConfirmCtx, unitId: string): { line: SalesSlotLine; unit: SalesUnitRow } | null {
  for (const line of ctx.lines) {
    for (const s of line.slots) if (s.unit && sameId(s.unit.id, unitId)) return { line, unit: s.unit };
  }
  return null;
}

/** 대장 상태를 보여 줄 칸 = 소프트웨어 품목 칸 + 영업에서 빠진 소프트웨어 칸(또는 대장에 올린 적 있는 칸) */
function relevantUnits(ctx: ConfirmCtx): SalesUnitRow[] {
  const out = placedSoftware(ctx).map((p) => p.unit);
  for (const o of ctx.orphans) if (kindOfSlotKey(o.slotKey) === 'software' || o.extra.ledgerPushed) out.push(o);
  return out;
}

/**
 * 칸 자리(slot_key·unit_no)의 지금 소프트웨어 품목 — 영업에서 빠진 칸이거나 다른 종류면 null.
 * id 가 아니라 자리로 찾음(방금 만든 ④ 는 ctx 에 없으므로).
 */
function softwareItemAt(ctx: ConfirmCtx, unit: Pick<SalesUnitRow, 'slotKey' | 'unitNo'>): SalesConfirmItem | null {
  const hit = findSlotLine(ctx.lines, unit.slotKey, unit.unitNo);
  return hit && hit.line.kind === 'software' ? hit.line.item : null;
}

function wantProduct(ctx: ConfirmCtx, unit: SalesUnitRow): string {
  return productOf(unit, softwareItemAt(ctx, unit));
}

// ───────────── 대장 읽기 ─────────────

type SeatRow = { id: string; contract_id: string; user_name: string; pc_asset_code: string; status: string; source_key: string | null };
type ContractRow = { id: string; client_id: string; product: string; source: string; source_key: string | null; updated_at: string };
const SEAT_COLS = 'id, contract_id, user_name, pc_asset_code, status, source_key';
const CONTRACT_COLS = 'id, client_id, product, source, source_key, updated_at';

export type Ledger = {
  /** ④ id(소문자) → 좌석 */
  seatByUnit: Map<string, SeatRow>;
  /** 좌석의 상품 + 이 확인서로 만든 상품 */
  contracts: Map<string, ContractRow>;
  /** 이 확인서로 만든 상품(source_key 앞부분) */
  confirmContracts: ContractRow[];
  clientNames: Map<string, string>;
  /** 이 확인서로 만든 상품의 좌석 전부(상품 이름 바꾸기 판단용) */
  seatsOfContract: Map<string, { id: string; source_key: string | null }[]>;
};

async function loadLedger(supabase: Db, ctx: ConfirmCtx, units: readonly SalesUnitRow[]): Promise<Ledger> {
  const seatByUnit = new Map<string, SeatRow>();
  const keys = [...new Set(units.map((u) => seatSourceKey(u.id)))];
  for (const part of chunk(keys, 100)) {
    const { data, error } = await supabase.from(SW_SEATS_TABLE).select(SEAT_COLS).in('source_key', part);
    if (error) throw error;
    for (const s of (data ?? []) as SeatRow[]) {
      const uid = unitIdOfSeatKey(s.source_key);
      if (uid) seatByUnit.set(uid, s);
    }
  }

  // 이 확인서로 만든 상품 — LIKE 는 넓게 걸릴 수 있어('_') 앞부분을 다시 정확히 비교
  const prefix = confirmContractPrefix(ctx.confirmId);
  const confirmContracts = (
    await readPages<ContractRow>((from, to) =>
      supabase
        .from(SW_CONTRACTS_TABLE)
        .select(CONTRACT_COLS)
        .like('source_key', `${prefix}%`)
        .order('id', { ascending: true })
        .range(from, to),
    )
  ).filter((c) => typeof c.source_key === 'string' && c.source_key.startsWith(prefix));

  const contracts = new Map<string, ContractRow>(confirmContracts.map((c) => [c.id, c]));
  const missing = [...new Set([...seatByUnit.values()].map((s) => s.contract_id))].filter((id) => !contracts.has(id));
  for (const part of chunk(missing, 100)) {
    const { data, error } = await supabase.from(SW_CONTRACTS_TABLE).select(CONTRACT_COLS).in('id', part);
    if (error) throw error;
    for (const c of (data ?? []) as ContractRow[]) contracts.set(c.id, c);
  }

  const clientNames = new Map<string, string>();
  const clientIds = [...new Set([...contracts.values()].map((c) => c.client_id))];
  for (const part of chunk(clientIds, 100)) {
    const { data, error } = await supabase.from(CONTRACT_CLIENTS_TABLE).select('id, name').in('id', part);
    if (error) throw error;
    for (const c of (data ?? []) as { id: string; name: string }[]) clientNames.set(c.id, String(c.name ?? ''));
  }

  const seatsOfContract = new Map<string, { id: string; source_key: string | null }[]>();
  for (const part of chunk(confirmContracts.map((c) => c.id), 50)) {
    const rows = await readPages<{ id: string; contract_id: string; source_key: string | null }>((from, to) =>
      supabase
        .from(SW_SEATS_TABLE)
        .select('id, contract_id, source_key')
        .in('contract_id', part)
        .order('id', { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const list = seatsOfContract.get(r.contract_id) ?? [];
      list.push({ id: r.id, source_key: r.source_key });
      seatsOfContract.set(r.contract_id, list);
    }
  }
  return { seatByUnit, contracts, confirmContracts, clientNames, seatsOfContract };
}

/** 이 확인서의 대장 거래처 — 이 확인서로 만든 상품의 거래처(미분류가 아닌 쪽 → 최근에 고친 상품 쪽) */
function ownClientId(ledger: Ledger): string | null {
  if (ledger.confirmContracts.length === 0) return null;
  const unsorted = nameKey(UNSORTED_CLIENT_NAME);
  const named = ledger.confirmContracts.map((c) => ({ c, key: nameKey(ledger.clientNames.get(c.client_id) ?? '') }));
  const preferred = named.filter((x) => x.key !== unsorted);
  const pool = preferred.length ? preferred : named;
  pool.sort((a, b) => String(b.c.updated_at).localeCompare(String(a.c.updated_at)));
  return pool[0].c.client_id;
}

async function clientNameOf(supabase: Db, ledger: Ledger, clientId: string): Promise<string> {
  const known = ledger.clientNames.get(clientId);
  if (known !== undefined || !isUuid(clientId)) return known ?? '';
  const { data, error } = await supabase.from(CONTRACT_CLIENTS_TABLE).select('name').eq('id', clientId).maybeSingle();
  if (error || !data) return ''; // 기록용 이름일 뿐 — 못 읽으면 빈 이름으로 기록
  return String((data as { name: string }).name ?? '');
}

/**
 * 상품 이름을 확인서 제품명으로 바꿔도 되는지 → 바꿀 이름(안 되면 null).
 * 이 확인서가 만든 상품 · 좌석이 전부 이 확인서 칸 · 그 칸들의 제품명이 모두 같음 · 그 칸들이 지난번 올린 이름 = 대장의 지금 이름.
 */
function renameTarget(ctx: ConfirmCtx, ledger: Ledger, contract: ContractRow): string | null {
  if (contract.source !== LEDGER_SOURCE || !String(contract.source_key ?? '').startsWith(confirmContractPrefix(ctx.confirmId))) return null;
  const seats = ledger.seatsOfContract.get(contract.id) ?? [];
  if (seats.length === 0) return null;
  const byId = new Map(ctx.units.map((u) => [lc(u.id), u] as const));
  const units: SalesUnitRow[] = [];
  for (const s of seats) {
    const uid = unitIdOfSeatKey(s.source_key);
    const u = uid ? byId.get(uid) : undefined;
    if (!u) return null;
    units.push(u);
  }
  const wants = new Set(units.map((u) => wantProduct(ctx, u)));
  if (wants.size !== 1) return null;
  const want = [...wants][0];
  if (!want || want === contract.product) return null;
  return units.every((u) => u.extra.ledgerPushed?.product === contract.product) ? want : null;
}

type SyncView = { state: UnitLicenseState['ledger']; notes: string[] };
const shown = (v: string) => v || '(빈칸)';

/** 칸 하나의 대장 상태(쓰기 없음) */
function syncOf(ctx: ConfirmCtx, ledger: Ledger, unit: SalesUnitRow): SyncView {
  const seat = ledger.seatByUnit.get(lc(unit.id));
  const pushed = unit.extra.ledgerPushed;
  if (!seat) return { state: pushed ? 'deleted' : 'none', notes: [] };
  const notes: string[] = [];
  let changed = false;
  let pending = false;

  const pc = fieldSync(seat.pc_asset_code, normPc(unit.extra.pc), pushed?.pc);
  if (pc === 'changed') {
    changed = true;
    notes.push(`설치 PC: 대장 ${shown(seat.pc_asset_code)}`);
  } else if (pc === 'push') pending = true;

  const user = fieldSync(seat.user_name, cleanUserName(unit.extra.user), pushed?.user);
  if (user === 'changed') {
    changed = true;
    notes.push(`사용자: 대장 ${shown(seat.user_name)}`);
  } else if (user === 'push') pending = true;

  const contract = ledger.contracts.get(seat.contract_id);
  const want = wantProduct(ctx, unit);
  if (contract && want && contract.product !== want) {
    if (fieldSync(contract.product, want, pushed?.product) === 'changed') {
      changed = true;
      notes.push(`제품명: 대장 ${contract.product}`);
    } else if (renameTarget(ctx, ledger, contract) === want) {
      pending = true;
    } else {
      notes.push(`제품명이 대장 상품(${contract.product})과 달라요 — 상품 이름은 계약관리에서 고쳐 주세요`);
    }
  }
  return { state: changed ? 'changed' : pending ? 'pending' : 'linked', notes };
}

/** 키가 든 좌석 id(소문자) — 값은 안 읽음, 잠금 필요 없음 */
async function keyFlags(ledger: Ledger): Promise<Set<string>> {
  const seatIds = [...ledger.seatByUnit.values()].map((s) => s.id);
  if (seatIds.length === 0) return new Set();
  const flags = await secretFlags({ contractIds: [], seatIds });
  const out = new Set<string>();
  for (const [owner, fields] of flags) if (fields.includes('license_key')) out.add(lc(owner));
  return out;
}

/**
 * 칸들의 키 값(④ id 그대로 → 키). readSecretsForOwners 가 안에서 잠금 해제를 다시 확인함.
 * 부르는 exported 함수가 먼저 requireUnlock 을 함.
 */
async function keysFor(ledger: Ledger, units: readonly SalesUnitRow[]): Promise<Map<string, string>> {
  const unitOfSeat = new Map<string, string>();
  for (const u of units) {
    const seat = ledger.seatByUnit.get(lc(u.id));
    if (seat) unitOfSeat.set(lc(seat.id), u.id);
  }
  const out = new Map<string, string>();
  if (unitOfSeat.size === 0) return out;
  const { seat } = await readSecretsForOwners({ contractIds: [], seatIds: [...unitOfSeat.keys()] });
  for (const [seatId, unitId] of unitOfSeat) {
    const v = seat.get(seatId)?.license_key;
    if (v) out.set(unitId, v);
  }
  return out;
}

function buildState(
  ctx: ConfirmCtx,
  ledger: Ledger,
  units: readonly SalesUnitRow[],
  o: { unlocked: boolean; minutesLeft: number | null; flags: Set<string>; keys: Map<string, string> | null },
): ConfirmLicenseState {
  const own = ownClientId(ledger);
  return {
    unlocked: o.unlocked,
    unlockMinutesLeft: o.unlocked ? o.minutesLeft : null,
    // 잠겨 있으면 대장 정보는 있음/없음·키 있음/없음·반영 대기만(거래처 이름·대장 값 안 보임 — §3-11)
    clientName: o.unlocked && own ? ledger.clientNames.get(own) ?? null : null,
    units: units.map((u): UnitLicenseState => {
      const seat = ledger.seatByUnit.get(lc(u.id));
      const sync = syncOf(ctx, ledger, u);
      return {
        unitId: u.id,
        ledger: sync.state,
        ledgerNote: o.unlocked ? sync.notes.join(' · ') : '',
        hasKey: !!seat && o.flags.has(lc(seat.id)),
        key: o.unlocked && o.keys ? o.keys.get(u.id) ?? null : null,
      };
    }),
    needContractsSql: false,
  };
}

/** 상태 한 번(잠금이 풀려 있으면 키 값까지). logView 면 키를 읽었을 때 view_bulk 기록 */
async function stateFor(ctx: ConfirmCtx, opts: { logView: boolean }): Promise<ConfirmLicenseState> {
  const supabase = db();
  const units = relevantUnits(ctx);
  const ledger = await loadLedger(supabase, ctx, units);
  const flags = await keyFlags(ledger);

  let unlocked = false;
  let minutesLeft: number | null = null;
  try {
    const s = await readUnlockState();
    if (s.unlocked) {
      unlocked = true;
      const exp = s.expiresAt ? Date.parse(s.expiresAt) : NaN;
      minutesLeft = Number.isFinite(exp) ? Math.max(0, Math.ceil((exp - Date.now()) / 60_000)) : null;
    }
  } catch (e) {
    console.warn('[sales-license] 잠금 상태 확인 실패', codeOf(e) || 'unknown');
  }

  let keys: Map<string, string> | null = null;
  let viewer = '';
  if (unlocked) {
    try {
      viewer = (await requireUnlock()).name;
      keys = await keysFor(ledger, units);
    } catch (e) {
      if (!(e instanceof UnlockRequired)) throw e;
      unlocked = false; // 그 사이 시간이 끝남 — 있음 표시만
      minutesLeft = null;
      keys = null;
    }
  }
  if (opts.logView && keys && keys.size > 0) {
    const own = ownClientId(ledger);
    await logSecretEvent({
      action: 'view_bulk',
      actor: viewer,
      clientId: own ?? undefined,
      clientName: own ? ledger.clientNames.get(own) : undefined,
      field: 'license_key',
      count: keys.size,
      note: `영업 확인서 ${docLabel(ctx)} 상세`,
    });
  }
  return buildState(ctx, ledger, units, { unlocked, minutesLeft, flags, keys });
}

// ───────────── 거래처 고르기 ─────────────

function labelOf(c: { id: string | null; name: string; worksName: string; state: string }): string {
  const parts = [c.name || c.worksName || '(이름 없음)'];
  if (!c.id) parts.push('works — 처음 저장');
  if (c.state === 'ended') parts.push('계약 종료');
  return parts.join(' · ');
}

/** 후보 순서: 이름이 맞는 거래처(하나면 "추천") → 새 거래처 → 미분류 → 나머지(이름순, 검색용) */
async function candidatesFor(ctx: ConfirmCtx): Promise<LedgerClientCandidate[]> {
  const ov = await buildContractsOverview('sw');
  if (ov.tablesMissing) throw new LinkError(CONTRACT_SQL_FIRST);
  const saved = await loadSavedClients(db());
  const aliasOf = new Map(saved.map((s) => [s.id, s.aliasKeys] as const));
  const keys = new Set(companyNameKeys(ctx.company));
  const unsortedKey = nameKey(UNSORTED_CLIENT_NAME);
  const base = companyBaseName(ctx.company).slice(0, 200);
  const baseKey = nameKey(base);

  const matches: LedgerClientCandidate[] = [];
  const others: LedgerClientCandidate[] = [];
  let baseTaken = false;
  for (const c of ov.clients) {
    if (c.id && nameKey(c.name) === unsortedKey) continue; // 아래 '미분류' 하나로
    const ks = [nameKey(c.name), nameKey(c.worksName), ...(c.id ? aliasOf.get(c.id) ?? [] : [])].filter((k) => k !== '');
    const cand: LedgerClientCandidate = {
      choice: c.id ? { type: 'existing', clientId: c.id } : { type: 'works', groupKey: c.key },
      label: labelOf(c),
      recommended: false,
    };
    if (ks.some((k) => keys.has(k))) {
      matches.push(cand);
      if (baseKey && ks.includes(baseKey)) baseTaken = true;
    } else others.push(cand);
  }
  if (matches.length === 1) matches[0].recommended = true;
  const out: LedgerClientCandidate[] = [...matches];
  if (base && baseKey && !baseTaken) {
    out.push({ choice: { type: 'new', name: base }, label: `새 거래처로 만들기: ${base}`, recommended: matches.length === 0 });
  }
  out.push({ choice: { type: 'unsorted' }, label: `${UNSORTED_CLIENT_NAME} — 나중에 계약관리에서 옮기기`, recommended: false });
  others.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  return [...out, ...others];
}

/** 고른 값 → 거래처 id(필요하면 만듦 — 계약관리 규칙 그대로: ensureClient·createManualClientRow) */
async function clientFromChoice(choice: LedgerClientChoice, ctx: ConfirmCtx, actor: string): Promise<string> {
  if (!choice || typeof choice !== 'object') throw new LinkError(BAD_CHOICE);
  try {
    switch (choice.type) {
      case 'existing': {
        if (!isUuid(choice.clientId)) throw new LinkError(BAD_CHOICE);
        const { data, error } = await db().from(CONTRACT_CLIENTS_TABLE).select('id').eq('id', lc(choice.clientId)).maybeSingle();
        if (error) throw error;
        if (!data) throw new LinkError('고른 거래처를 못 찾았어요 — 다시 골라 주세요.');
        return String((data as { id: string }).id);
      }
      case 'works': {
        const g = typeof choice.groupKey === 'string' ? choice.groupKey.trim() : '';
        if (!g || g.length > 300) throw new LinkError(BAD_CHOICE);
        // ensureClient 는 'new:' 가 아니면 받은 글자를 id 로 그대로 돌려주므로 꼭 'new:' 로
        const id = await ensureClient(g.startsWith('new:') ? g : `new:${g}`, actor);
        if (!isUuid(id)) throw new LinkError(BAD_CHOICE);
        return id;
      }
      case 'new': {
        const typed = cleanUserName(typeof choice.name === 'string' ? choice.name : '').slice(0, 200);
        const name = typed || companyBaseName(ctx.company).slice(0, 200);
        if (!name) throw new LinkError('새 거래처 이름을 적어 주세요.');
        return await createManualClientRow(name, actor);
      }
      case 'unsorted':
        return await createManualClientRow(UNSORTED_CLIENT_NAME, actor);
      default:
        throw new LinkError(BAD_CHOICE);
    }
  } catch (e) {
    if (e instanceof UserError) throw new LinkError(e.message);
    throw e;
  }
}

/** 거래처 정하기(한 액션 안에서 한 번만 — 처음 정한 id 를 계속 씀) */
function clientResolver(ctx: ConfirmCtx, ledger: Ledger, choice: LedgerClientChoice | undefined, actor: string): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () =>
    (pending ??= (async () => {
      const own = ownClientId(ledger);
      if (own) return own;
      if (!choice) throw new NeedClientError(await candidatesFor(ctx));
      return clientFromChoice(choice, ctx, actor);
    })());
}

/** 거래처 고르기 창 후보 — 잠금 해제 필요(소프트웨어 대장 거래처 목록) */
export async function clientCandidatesForConfirm(confirmId: unknown): Promise<LedgerClientCandidate[]> {
  await requireUnlock();
  const ctx = await loadConfirmCtx(confirmId);
  return candidatesFor(ctx);
}

// ───────────── 대장 만들기·반영 ─────────────

async function seatByKey(supabase: Db, key: string): Promise<SeatRow | null> {
  const { data, error } = await supabase.from(SW_SEATS_TABLE).select(SEAT_COLS).eq('source_key', key).maybeSingle();
  if (error) throw error;
  return (data as SeatRow | null) ?? null;
}

async function contractByKey(supabase: Db, key: string): Promise<ContractRow | null> {
  const { data, error } = await supabase.from(SW_CONTRACTS_TABLE).select(CONTRACT_COLS).eq('source_key', key).maybeSingle();
  if (error) throw error;
  return (data as ContractRow | null) ?? null;
}

async function contractById(supabase: Db, id: string): Promise<ContractRow | null> {
  const { data, error } = await supabase.from(SW_CONTRACTS_TABLE).select(CONTRACT_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as ContractRow | null) ?? null;
}

/**
 * ④ extra.ledgerPushed 기록(키 없음) — updateUnitExtra 는 넘긴 칸만 합쳐 쓰므로 ledgerPushed 만 넘김
 * (설치 PC·사용자는 화면 저장이 쓴 지금 값 그대로).
 */
async function recordPushed(unitId: string, pushed: { product?: string; pc?: string; user?: string }, actor: string): Promise<void> {
  const ledgerPushed: NonNullable<SalesUnitExtra['ledgerPushed']> = { at: new Date().toISOString() };
  if (pushed.product !== undefined) ledgerPushed.product = pushed.product;
  if (pushed.pc !== undefined) ledgerPushed.pc = pushed.pc;
  if (pushed.user !== undefined) ledgerPushed.user = pushed.user;
  await updateUnitExtra(unitId, { ledgerPushed }, actor);
}

export type SeatLink = { seatId: string; contractId: string; clientId: string; createdContract: boolean; createdSeat: boolean };

/**
 * 칸 하나의 대장 좌석 보장: 거래처 → 상품 → 좌석. 앞 단계가 이미 있으면(source_key) 그대로 씀 — 여러 번 불러도 하나.
 * 좌석이 이미 있으면 상품·거래처는 좌석 것(제품명을 나중에 고쳐도 새 상품을 안 만듦).
 * 잠금 해제 필요. 계약관리 SQL 블록 B 전이면 NeedContractsSqlError, 거래처를 못 정했으면 getClient 가 NeedClientError.
 */
export async function ensureLedgerForUnit(
  ctx: ConfirmCtx,
  unit: SalesUnitRow,
  getClient: () => Promise<string>,
  actor: string,
): Promise<SeatLink> {
  await requireUnlock();
  if (!isUuid(unit.id)) throw new LinkError(UNIT_GONE);
  const supabase = db();
  const seatKey = seatSourceKey(unit.id);

  const existing = await seatByKey(supabase, seatKey);
  if (existing) {
    const contract = await contractById(supabase, existing.contract_id);
    // 만든 뒤 기록이 실패했던 칸 — 지금 대장 값을 "올린 값"으로 남겨 덮어쓰기 규칙이 돌게
    if (!unit.extra.ledgerPushed && ctx.schemaReady) {
      await recordPushed(unit.id, { product: contract?.product, pc: existing.pc_asset_code, user: existing.user_name }, actor);
    }
    return { seatId: existing.id, contractId: existing.contract_id, clientId: contract?.client_id ?? '', createdContract: false, createdSeat: false };
  }
  if (!ctx.schemaReady) throw new LinkError(SQL_A_MSG);

  const item = softwareItemAt(ctx, unit);
  const product = productOf(unit, item) || NO_PRODUCT_NAME;
  const cKey = contractSourceKey(ctx.confirmId, product);
  let contract = await contractByKey(supabase, cKey);
  let createdContract = false;
  if (!contract) {
    const clientId = await getClient();
    const { data, error } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .upsert(
        {
          client_id: clientId,
          product,
          license_type: 'unknown', // 대장에서 고침
          status: '사용중',
          starts_on: ctx.deliveryDate,
          memo: `영업 확인서 ${docLabel(ctx)}에서`,
          source: LEDGER_SOURCE,
          source_key: cKey,
          created_by: actor,
          updated_by: actor,
        },
        { onConflict: 'source_key', ignoreDuplicates: true },
      )
      .select('id');
    if (error) {
      if (isSourceCheckMissing(error)) throw new NeedContractsSqlError();
      throw error;
    }
    createdContract = (data ?? []).length > 0;
    contract = await contractByKey(supabase, cKey);
    if (!contract) throw new LinkError('대장 상품을 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  const pc = normPc(unit.extra.pc);
  const user = cleanUserName(unit.extra.user);
  const { data: seatIns, error: seatErr } = await supabase
    .from(SW_SEATS_TABLE)
    .upsert(
      {
        contract_id: contract.id,
        user_name: user,
        pc_asset_code: pc,
        installed_on: kstDateOf(ctx.shippedAt) ?? ctx.deliveryDate,
        status: pc ? '사용중' : '미배정',
        source: LEDGER_SOURCE,
        source_key: seatKey,
        // 비밀 없음 — 어디서 왔는지만
        source_raw: {
          '확인서 순번': docLabel(ctx),
          판: `v${ctx.ver}`,
          품목: item?.cat ?? '',
          '영업 모델': item?.model ?? '',
        },
        created_by: actor,
        updated_by: actor,
      },
      { onConflict: 'source_key', ignoreDuplicates: true },
    )
    .select('id');
  if (seatErr) {
    if (isSourceCheckMissing(seatErr)) throw new NeedContractsSqlError();
    throw seatErr;
  }
  const seat = await seatByKey(supabase, seatKey);
  if (!seat) throw new LinkError('대장 좌석을 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
  const seatContract = seat.contract_id === contract.id ? contract : await contractById(supabase, seat.contract_id);
  await recordPushed(unit.id, { product: seatContract?.product, pc: seat.pc_asset_code, user: seat.user_name }, actor);
  return {
    seatId: seat.id,
    contractId: seat.contract_id,
    clientId: seatContract?.client_id ?? '',
    createdContract,
    createdSeat: (seatIns ?? []).length > 0,
  };
}

/** 좌석의 설치 PC·사용자 반영(덮어쓰기 규칙). 돌려주는 값 = 이번 뒤 "올린 값"으로 남길 것(대장에서 바뀐 칸은 예전 기록 유지) */
async function syncSeatFields(
  supabase: Db,
  unit: SalesUnitRow,
  seat: SeatRow,
  actor: string,
): Promise<{ pc: string | undefined; user: string | undefined }> {
  const pushed = unit.extra.ledgerPushed;
  const wantPc = normPc(unit.extra.pc);
  const wantUser = cleanUserName(unit.extra.user);
  const pcS = fieldSync(seat.pc_asset_code, wantPc, pushed?.pc);
  const userS = fieldSync(seat.user_name, wantUser, pushed?.user);
  const patch: Record<string, string> = {};
  if (pcS === 'push') {
    patch.pc_asset_code = wantPc;
    // 사람이 정한 상태(회수·해지·만료)는 그대로
    if (seat.status === '사용중' || seat.status === '미배정') patch.status = wantPc ? '사용중' : '미배정';
  }
  if (userS === 'push') patch.user_name = wantUser;
  let pcNow = seat.pc_asset_code;
  let userNow = seat.user_name;
  if (Object.keys(patch).length > 0) {
    // 읽은 값 그대로일 때만 — 그 사이 대장에서 고쳤으면 0줄(이번엔 안 씀, 다음 상태가 '대장에서 바뀜')
    const { data, error } = await supabase
      .from(SW_SEATS_TABLE)
      .update({ ...patch, updated_by: actor })
      .eq('id', seat.id)
      .eq('pc_asset_code', seat.pc_asset_code)
      .eq('user_name', seat.user_name)
      .select(SEAT_COLS);
    if (error) throw error;
    const row = (data ?? [])[0] as SeatRow | undefined;
    if (!row) return { pc: pushed?.pc, user: pushed?.user };
    pcNow = row.pc_asset_code;
    userNow = row.user_name;
  }
  return { pc: pcS === 'changed' ? pushed?.pc : pcNow, user: userS === 'changed' ? pushed?.user : userNow };
}

/** 대장 좌석이 있는 칸들의 일반 칸 반영 — 상품 이름(안전할 때만) → 좌석 칸 → ledgerPushed */
async function syncUnits(supabase: Db, ctx: ConfirmCtx, ledger: Ledger, targets: readonly SalesUnitRow[], actor: string): Promise<void> {
  const renamed = new Map<string, string>();
  const contractIds = [
    ...new Set(targets.map((t) => ledger.seatByUnit.get(lc(t.id))?.contract_id).filter((v): v is string => !!v)),
  ];
  for (const cid of contractIds) {
    const c = ledger.contracts.get(cid);
    if (!c) continue;
    const to = renameTarget(ctx, ledger, c);
    if (!to) continue;
    const { data, error } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .update({ product: to, updated_by: actor })
      .eq('id', c.id)
      .eq('product', c.product) // 그 사이 대장에서 고쳤으면 0줄
      .select('id');
    if (error) throw error;
    if ((data ?? []).length > 0) renamed.set(c.id, to);
  }

  // 이름을 바꾼 상품의 다른 칸도 "올린 이름"을 같이 갱신(아니면 다음에 '대장에서 바뀜'으로 보임)
  const byId = new Map(ctx.units.map((u) => [lc(u.id), u] as const));
  const all = new Map<string, { unit: SalesUnitRow; target: boolean }>();
  for (const t of targets) all.set(lc(t.id), { unit: t, target: true });
  for (const cid of renamed.keys()) {
    for (const s of ledger.seatsOfContract.get(cid) ?? []) {
      const uid = unitIdOfSeatKey(s.source_key);
      const u = uid ? byId.get(uid) : undefined;
      if (u && !all.has(lc(u.id))) all.set(lc(u.id), { unit: u, target: false });
    }
  }

  for (const { unit, target } of all.values()) {
    const seat = ledger.seatByUnit.get(lc(unit.id));
    if (!seat) continue;
    const prev = unit.extra.ledgerPushed;
    const fields = target ? await syncSeatFields(supabase, unit, seat, actor) : { pc: prev?.pc, user: prev?.user };
    const contract = ledger.contracts.get(seat.contract_id);
    let product = prev?.product;
    const renamedTo = renamed.get(seat.contract_id);
    if (renamedTo !== undefined) product = renamedTo;
    else if (contract && contract.product === wantProduct(ctx, unit)) product = contract.product;
    if (prev?.pc !== fields.pc || prev?.user !== fields.user || prev?.product !== product) {
      await recordPushed(unit.id, { product, pc: fields.pc, user: fields.user }, actor);
    }
  }
}

// ───────────── 칸 찾기(서버 검사) ─────────────

/** 화면이 준 칸 → 지금 소프트웨어 품목 칸(④ 가 있으면 그 행). 그 확인서의 것·소프트웨어 칸·영업에서 안 빠진 칸만 */
function locateSlot(
  ctx: ConfirmCtx,
  input: { slotKey?: unknown; unitNo?: unknown; unitId?: unknown },
): { slotKey: string; unitNo: number; unit: SalesUnitRow | null } {
  const unitId = input.unitId;
  if (unitId !== null && unitId !== undefined && unitId !== '') {
    if (!isUuid(unitId)) throw new LinkError(UNIT_GONE);
    const p = placeOf(ctx, unitId);
    if (p) {
      if (p.line.kind !== 'software') throw new LinkError(NOT_SOFTWARE);
      return { slotKey: p.line.slotKey, unitNo: p.unit.unitNo, unit: p.unit };
    }
    const own = ctx.units.find((u) => sameId(u.id, unitId));
    if (!own) throw new LinkError(UNIT_GONE); // 다른 확인서의 칸이거나 없는 칸
    throw new LinkError(kindOfSlotKey(own.slotKey) === 'software' ? ORPHAN_UNIT : NOT_SOFTWARE);
  }
  const slotKey = typeof input.slotKey === 'string' ? input.slotKey : '';
  const unitNo = Number(input.unitNo);
  if (!slotKey || slotKey.length > 200 || !Number.isInteger(unitNo) || unitNo < 1) throw new LinkError(UNIT_GONE);
  const found = findSlotLine(ctx.lines, slotKey, unitNo);
  if (!found) throw new LinkError(UNIT_GONE);
  if (found.line.kind !== 'software') throw new LinkError(NOT_SOFTWARE);
  return { slotKey, unitNo, unit: found.slot.unit };
}

/**
 * ④ 행이 없으면 만들고(work.ts), work.ts 가 보는 칸도 같은지 다시 확인 — 그 확인서의 같은 칸(slot_key·unit_no)이고 종류가 소프트웨어.
 * (readUnit 은 영업에서 빠진 칸에도 item_snapshot 을 item 으로 주므로 자리로 확인)
 */
async function ensureSoftwareUnit(ctx: ConfirmCtx, slotKey: string, unitNo: number, actor: string): Promise<SalesUnitRow> {
  const row = await ensureUnitRow(ctx.confirmId, slotKey, unitNo, actor);
  const check = await readUnit(ctx.confirmId, row.id);
  if (!check || check.unit.slotKey !== slotKey || check.unit.unitNo !== unitNo) throw new LinkError(UNIT_GONE);
  if (check.kind !== 'software') throw new LinkError(NOT_SOFTWARE);
  return check.unit;
}

function keyOrThrow(raw: unknown): string {
  const k = cleanLicenseKey(raw);
  if (!k.ok) throw new LinkError(k.error);
  return k.value;
}

// ───────────── 밖에서 부르는 것(액션 app/confirm-form/salesLicenseActions.ts) ─────────────

/** 있음 표시만 — 잠금 없이(키 값은 안 읽음, 대장 값·거래처 이름도 안 보냄) */
export async function confirmLicenseFlags(confirmId: unknown): Promise<ConfirmLicenseState> {
  const ctx = await loadConfirmCtx(confirmId);
  const units = relevantUnits(ctx);
  const ledger = await loadLedger(db(), ctx, units);
  const flags = await keyFlags(ledger);
  return buildState(ctx, ledger, units, { unlocked: false, minutesLeft: null, flags, keys: null });
}

/** 상세를 열 때 — 잠겨 있으면 있음 표시만, 풀려 있으면 키 값까지(+ view_bulk 기록, 값 없이 개수·순번) */
export async function getLicenseState(confirmId: unknown, opts: { logView?: boolean } = {}): Promise<ConfirmLicenseState> {
  const ctx = await loadConfirmCtx(confirmId);
  return stateFor(ctx, { logView: opts.logView ?? false });
}

/** 잠금 해제 상태에서 이 확인서 칸들의 키(④ id → 키) — 기록은 부르는 쪽이 */
export async function readConfirmLicenseKeys(confirmId: unknown): Promise<Map<string, string>> {
  await requireUnlock();
  const ctx = await loadConfirmCtx(confirmId);
  const units = relevantUnits(ctx);
  const ledger = await loadLedger(db(), ctx, units);
  return keysFor(ledger, units);
}

/** 출력 창 — 지금 소프트웨어 품목 칸의 키만(④ id → 키) + view_bulk('영업 확인서 <순번> 출력') */
export async function getPrintKeys(confirmId: unknown): Promise<Record<string, string>> {
  const who = await requireUnlock();
  const ctx = await loadConfirmCtx(confirmId);
  const units = placedSoftware(ctx).map((p) => p.unit);
  const ledger = await loadLedger(db(), ctx, units);
  const keys = await keysFor(ledger, units);
  if (keys.size > 0) {
    const own = ownClientId(ledger);
    await logSecretEvent({
      action: 'view_bulk',
      actor: who.name,
      clientId: own ?? undefined,
      clientName: own ? ledger.clientNames.get(own) : undefined,
      field: 'license_key',
      count: keys.size,
      note: `영업 확인서 ${docLabel(ctx)} 출력`,
    });
  }
  return Object.fromEntries(keys);
}

/**
 * 칸 하나 키 저장(빈 값 = 지우기). 처음이면 거래처 → 상품 → 좌석을 만든 뒤 키.
 * 지울 키가 없으면(좌석 없음) 아무것도 안 씀. 거래처가 아직 없고 client 도 없으면 쓰기 전에 NeedClientError.
 */
export async function saveUnitLicenseKey(input: {
  confirmId: unknown;
  slotKey?: unknown;
  unitNo?: unknown;
  unitId?: unknown;
  key: unknown;
  client?: LedgerClientChoice | null;
  actor?: unknown;
}): Promise<ConfirmLicenseState> {
  const who = await requireUnlock();
  const key = keyOrThrow(input.key);
  const actor = cleanActorName(input.actor) || who.name;
  const logActor = who.name || actor;
  const ctx = await loadConfirmCtx(input.confirmId);
  const target = locateSlot(ctx, input);
  const supabase = db();
  const ledger = await loadLedger(supabase, ctx, relevantUnits(ctx));
  const seat0 = target.unit ? ledger.seatByUnit.get(lc(target.unit.id)) : undefined;

  if (key === '') {
    if (seat0) {
      const owner = parseSecretOwner({ seatId: lc(seat0.id) });
      if (!owner) throw new LinkError(UNIT_GONE);
      const res = await writeSecret(owner, 'license_key', '', logActor);
      if (res === 'deleted') {
        const contract = ledger.contracts.get(seat0.contract_id);
        await logSecretEvent({
          action: 'delete',
          actor: logActor,
          field: 'license_key',
          seatId: seat0.id,
          contractId: seat0.contract_id,
          clientId: contract?.client_id,
          clientName: contract ? ledger.clientNames.get(contract.client_id) : undefined,
          note: `영업 확인서 ${docLabel(ctx)}`,
        });
      }
    }
    return stateFor(await loadConfirmCtx(ctx.confirmId), { logView: false });
  }

  if (!ctx.schemaReady) throw new LinkError(SQL_A_MSG);
  // 거래처가 필요한데 못 정했으면 ④·대장에 쓰기 전에 고르기 창
  if (!seat0 && !ownClientId(ledger) && !input.client) throw new NeedClientError(await candidatesFor(ctx));

  const unit = target.unit ?? (await ensureSoftwareUnit(ctx, target.slotKey, target.unitNo, actor));
  const getClient = clientResolver(ctx, ledger, input.client ?? undefined, actor);
  const link = await ensureLedgerForUnit(ctx, unit, getClient, actor);
  const owner = parseSecretOwner({ seatId: lc(link.seatId) });
  if (!owner) throw new LinkError(UNIT_GONE);
  const res = await writeSecret(owner, 'license_key', key, logActor);
  if (res !== 'nothing') {
    await logSecretEvent({
      action: res === 'deleted' ? 'delete' : 'edit',
      actor: logActor,
      field: 'license_key',
      seatId: link.seatId,
      contractId: link.contractId,
      clientId: link.clientId || undefined,
      clientName: link.clientId ? await clientNameOf(supabase, ledger, link.clientId) : undefined,
      note: `영업 확인서 ${docLabel(ctx)}`,
    });
  }
  return stateFor(await loadConfirmCtx(ctx.confirmId), { logView: false });
}

/**
 * [같은 키를 모든 칸에] — 소프트웨어 품목 줄의 칸마다 같은 값(볼륨 라이선스). 좌석이 없는 칸은 만들고 넣음.
 * 빈 값 = 그 줄 칸들의 키 지우기(좌석이 있는 칸만). 기록은 칸 수만큼이 아니라 한 줄(event_count = 칸 수).
 * 중간에 멈추면 그때까지 넣은 칸은 남고(기록도 남김) 오류를 그대로 돌려줌 — 화면은 상태를 다시 읽음.
 */
export async function saveLineLicenseKey(input: {
  confirmId: unknown;
  itemIndex: unknown;
  key: unknown;
  client?: LedgerClientChoice | null;
  actor?: unknown;
}): Promise<ConfirmLicenseState> {
  const who = await requireUnlock();
  const key = keyOrThrow(input.key);
  const actor = cleanActorName(input.actor) || who.name;
  const logActor = who.name || actor;
  const ctx = await loadConfirmCtx(input.confirmId);
  const idx = Number(input.itemIndex);
  const line = Number.isInteger(idx) ? ctx.lines.find((l) => l.itemIndex === idx) : undefined;
  if (!line) throw new LinkError('그 품목 줄을 못 찾았어요 — 영업이 품목을 바꿨을 수 있어요. 화면을 새로 고쳐 주세요.');
  if (line.kind !== 'software') throw new LinkError(NOT_SOFTWARE);
  const supabase = db();
  const ledger = await loadLedger(supabase, ctx, relevantUnits(ctx));
  const own = ownClientId(ledger);

  if (key === '') {
    let deleted = 0;
    const contractIds = new Set<string>();
    try {
      for (const s of line.slots) {
        const seat = s.unit ? ledger.seatByUnit.get(lc(s.unit.id)) : undefined;
        if (!seat) continue;
        const owner = parseSecretOwner({ seatId: lc(seat.id) });
        if (!owner) continue;
        if ((await writeSecret(owner, 'license_key', '', logActor)) === 'deleted') {
          deleted++;
          contractIds.add(seat.contract_id);
        }
      }
    } finally {
      if (deleted > 0) {
        const cid = contractIds.size === 1 ? [...contractIds][0] : undefined;
        const clientId = cid ? ledger.contracts.get(cid)?.client_id : own ?? undefined;
        await logSecretEvent({
          action: 'delete',
          actor: logActor,
          field: 'license_key',
          contractId: cid,
          clientId,
          clientName: clientId ? ledger.clientNames.get(clientId) : undefined,
          count: deleted,
          note: `영업 확인서 ${docLabel(ctx)} · 줄 전체 키 지우기 ${deleted}칸`,
        });
      }
    }
    return stateFor(await loadConfirmCtx(ctx.confirmId), { logView: false });
  }

  if (!ctx.schemaReady) throw new LinkError(SQL_A_MSG);
  const needSeat = line.slots.some((s) => !s.unit || !ledger.seatByUnit.has(lc(s.unit.id)));
  if (needSeat && !own && !input.client) throw new NeedClientError(await candidatesFor(ctx));

  const getClient = clientResolver(ctx, ledger, input.client ?? undefined, actor);
  let saved = 0;
  const contractIds = new Set<string>();
  let clientId = '';
  try {
    for (const s of line.slots) {
      const unit = s.unit ?? (await ensureSoftwareUnit(ctx, line.slotKey, s.unitNo, actor));
      const link = await ensureLedgerForUnit(ctx, unit, getClient, actor);
      const owner = parseSecretOwner({ seatId: lc(link.seatId) });
      if (!owner) throw new LinkError(UNIT_GONE);
      await writeSecret(owner, 'license_key', key, logActor);
      saved++;
      contractIds.add(link.contractId);
      if (link.clientId) clientId = link.clientId;
    }
  } finally {
    if (saved > 0) {
      await logSecretEvent({
        action: 'edit',
        actor: logActor,
        field: 'license_key',
        contractId: contractIds.size === 1 ? [...contractIds][0] : undefined,
        clientId: clientId || undefined,
        clientName: clientId ? await clientNameOf(supabase, ledger, clientId) : undefined,
        count: saved,
        note: `영업 확인서 ${docLabel(ctx)} · 같은 키 ${saved}칸${saved < line.slots.length ? `(${line.slots.length}칸 중)` : ''}`,
      });
    }
  }
  return stateFor(await loadConfirmCtx(ctx.confirmId), { logView: false });
}

/**
 * [대장에 올리기] / [다시 올리기] — 칸들의 일반 칸(설치 PC·사용자·제품명)을 대장에 반영. 좌석이 없으면(처음·대장에서 지워짐) 만듦.
 * unitIds 를 안 주면 지금 소프트웨어 품목 칸에 붙은 ④ 전부. 대장에서 사람이 고친 칸은 안 덮음(fieldSync).
 * 칸 하나·여러 개 모두 이 함수.
 */
export async function pushUnitToLedger(input: {
  confirmId: unknown;
  unitIds?: unknown;
  client?: LedgerClientChoice | null;
  actor?: unknown;
}): Promise<ConfirmLicenseState> {
  const who = await requireUnlock();
  const actor = cleanActorName(input.actor) || who.name;
  let ctx = await loadConfirmCtx(input.confirmId);
  if (!ctx.schemaReady) throw new LinkError(SQL_A_MSG);

  const placed = placedSoftware(ctx).map((p) => p.unit);
  let targetIds: string[];
  if (input.unitIds === undefined || input.unitIds === null) {
    targetIds = placed.map((u) => lc(u.id));
  } else {
    if (!Array.isArray(input.unitIds)) throw new LinkError('대장에 올릴 칸 목록이 올바르지 않아요. 화면을 새로 고쳐 주세요.');
    const raw: unknown[] = input.unitIds;
    if (!raw.every(isUuid)) throw new LinkError(UNIT_GONE);
    targetIds = [...new Set(raw.map((x) => lc(x as string)))];
    // 그 확인서의 것 · 지금 소프트웨어 품목 칸만(영업에서 빠진 칸·다른 종류 칸은 이유를 알려 주고 거절)
    for (const id of targetIds) {
      if (placed.some((u) => sameId(u.id, id))) continue;
      locateSlot(ctx, { unitId: id }); // 이유별로 던짐
      throw new LinkError(UNIT_GONE);
    }
  }
  if (targetIds.length > MAX_PUSH_UNITS) throw new LinkError(`한 번에 ${MAX_PUSH_UNITS}칸까지 올릴 수 있어요.`);
  if (targetIds.length === 0) return stateFor(ctx, { logView: false });

  const supabase = db();
  let ledger = await loadLedger(supabase, ctx, relevantUnits(ctx));
  const missing = placed.filter((u) => targetIds.includes(lc(u.id)) && !ledger.seatByUnit.has(lc(u.id)));
  if (missing.length > 0) {
    if (!ownClientId(ledger) && !input.client) throw new NeedClientError(await candidatesFor(ctx));
    const getClient = clientResolver(ctx, ledger, input.client ?? undefined, actor);
    for (const u of missing) await ensureLedgerForUnit(ctx, u, getClient, actor);
    // 새로 만든 좌석·ledgerPushed 를 반영해 다시 읽음
    ctx = await loadConfirmCtx(ctx.confirmId);
    ledger = await loadLedger(supabase, ctx, relevantUnits(ctx));
  }
  const targets = placedSoftware(ctx)
    .map((p) => p.unit)
    .filter((u) => targetIds.includes(lc(u.id)));
  await syncUnits(supabase, ctx, ledger, targets, actor);
  return stateFor(await loadConfirmCtx(ctx.confirmId), { logView: false });
}
