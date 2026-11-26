import 'server-only';

/**
 * 영업 확인서 목록 읽기(①③④⑤) — payload 칸은 읽지 않음(목록엔 contacts·items·supplies 로 충분).
 * 범위: ① 최근 120일(처음 받은 날 또는 납품일 기준) + ③ 상태가 출고·취소가 아닌 더 옛날 건.
 * Supabase 는 한 번에 1000줄까지 → 페이지로 끝까지, ③④ 는 id 200개씩 .in (④ 는 그 안에서도 페이지).
 * 쓰기 없음.
 */
import {
  SALES_CONFIRMS_TABLE,
  SALES_CONFIRM_UNITS_TABLE,
  SALES_CONFIRM_WORK_TABLE,
  SALES_IMPORT_STATE_TABLE,
  createAdminClient,
} from '@/lib/supabase/server';
import {
  SALES_CONFIRM_DONE_STATUSES,
  contactLine,
  importStateFromRow,
  isSalesConfirmStatus,
  safeDocUrl,
  type SalesConfirmContacts,
  type SalesConfirmListResult,
  type SalesConfirmListRow,
  type SalesImportStateRow,
} from './types';

const PREP_PEOPLE_TABLE = 'it_prep_people'; // app/shipment-prep/actions.ts 와 같은 표(그 파일은 상수를 안 내보냄)
const WINDOW_DAYS = 120;
const CHUNK = 200;
const MAX_QTY = 50;

type Supa = ReturnType<typeof createAdminClient>;
type Json = Record<string, unknown>;

/** 표 없음 판정 — 42P01/PGRST205 또는 "does not exist" 류 문구만(권한 오류를 "없음"으로 보지 않음) */
export function isMissingSalesTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /does not exist|could not find the table|schema cache/i.test(e.message ?? '');
}

export function kstTodayYmd(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 페이지로 끝까지(1000줄 잘림 방지) */
async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// ───────────── 원본 줄 모양 ─────────────

interface ConfirmDbRow {
  id: string;
  doc_no: string | null;
  ver: number | null;
  type: string | null;
  term: string | null;
  first_saved_at: string | null;
  saved_by: string | null;
  sales_rep: string | null;
  company: string | null;
  region: string | null;
  delivery_date: string | null;
  contacts: unknown;
  items: unknown;
  supplies: unknown;
  special: string | null;
  doc_url: string | null;
  payload_hash: string | null;
  sales_state: string | null;
  first_seen_at: string;
}
const CONFIRM_COLS =
  'id,doc_no,ver,type,term,first_saved_at,saved_by,sales_rep,company,region,delivery_date,contacts,items,supplies,special,doc_url,payload_hash,sales_state,first_seen_at';

interface WorkDbRow {
  confirm_id: string;
  status: string | null;
  processors: string[] | null;
  note: string | null;
  seen_ver: number | null;
  seen_hash: string | null;
  first_opened_at: string | null;
  updated_at: string | null;
}
const WORK_COLS = 'confirm_id,status,processors,note,seen_ver,seen_hash,first_opened_at,updated_at';

interface UnitDbRow {
  confirm_id: string;
  slot_key: string;
  unit_no: number;
  asset_id: string | null;
  serial: string | null;
  spec_override: unknown;
}
const UNIT_COLS = 'confirm_id,slot_key,unit_no,asset_id,serial,spec_override';

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clampQty = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_QTY, n)) : 0;
};

// ───────────── 요약 계산 ─────────────

/** CPU 문구를 짧게: i5-12400 → i5, Ryzen 5 → R5, 그 밖엔 앞 10자 */
export function shortCpu(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const i = /\bi([3579])\b|\bi([3579])[-\s]?\d{3,5}/i.exec(s);
  if (i) return `i${i[1] ?? i[2]}`;
  const r = /ryzen\s*([3579])/i.exec(s);
  if (r) return `R${r[1]}`;
  const w = /(celeron|pentium|xeon|core\s*ultra)/i.exec(s);
  if (w) return w[1].replace(/\s+/g, '');
  return s.replace(/\s+/g, '').slice(0, 10);
}

function specLine(cat: string, spec: Json): string {
  const g = (k: string) => asStr(spec[k]).replace(/\s+/g, '');
  const inch = g('인치');
  if (!g('CPU') && !g('RAM') && !g('SSD') && !g('HDD')) {
    return inch ? (/\D/.test(inch) ? inch : `${inch}인치`) : '';
  }
  const parts = [shortCpu(asStr(spec.CPU)), g('RAM'), g('SSD') || g('HDD')].filter(Boolean);
  if (inch && /모니터/.test(cat)) parts.push(/\D/.test(inch) ? inch : `${inch}인치`);
  return parts.join('/');
}

/** 품목 줄마다 slot_key = 종류#같은 종류 안 순서 (types 주석·설계 §3-4) */
function slotKeys(items: Json[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const cat = asStr(it.cat) || '기타';
    const n = (seen.get(cat) ?? 0) + 1;
    seen.set(cat, n);
    return `${cat}#${n}`;
  });
}

function buildRow(c: ConfirmDbRow, work: WorkDbRow | undefined, units: UnitDbRow[]): SalesConfirmListRow {
  const items = asArr(c.items).map(asObj);
  const keys = slotKeys(items);
  const order = new Map(keys.map((k, i) => [k, i] as const));
  const sortedUnits = [...units].sort(
    (a, b) => (order.get(a.slot_key) ?? 999) - (order.get(b.slot_key) ?? 999) || a.slot_key.localeCompare(b.slot_key) || a.unit_no - b.unit_no,
  );

  // 품목 요약: 같은 종류끼리 합침
  const byCat = new Map<string, number>();
  let unitsTotal = 0;
  for (const it of items) {
    const q = clampQty(it.qty);
    unitsTotal += q;
    if (q > 0) byCat.set(asStr(it.cat) || '기타', (byCat.get(asStr(it.cat) || '기타') ?? 0) + q);
  }
  const itemSummary = [...byCat].map(([cat, q]) => `${cat} ${q}`).join(' · ');

  // 사양 요약: ④ spec_override(IT가 고친 칸)가 있으면 그 값 우선
  let specEdited = false;
  const specParts: string[] = [];
  items.forEach((it, i) => {
    const spec: Json = { ...asObj(it.spec) };
    for (const u of sortedUnits.filter((x) => x.slot_key === keys[i])) {
      for (const [k, v] of Object.entries(asObj(u.spec_override))) {
        const val = asStr(v);
        if (val) {
          spec[k] = val;
          specEdited = true;
        }
      }
    }
    const line = specLine(asStr(it.cat), spec);
    if (line && !specParts.includes(line)) specParts.push(line);
  });

  const filled = sortedUnits.filter((u) => asStr(u.asset_id));
  const supplies = asArr(c.supplies)
    .map(asObj)
    .map((s) => {
      const q = clampQty(s.qty);
      const ch = asStr(s.charge);
      return `${asStr(s.name)}${q > 0 ? ` ${q}` : ''}${ch ? `(${ch})` : ''}`.trim();
    })
    .filter(Boolean);

  const ver = c.ver ?? 0;
  const salesChanged =
    work && work.seen_ver !== null && work.seen_ver !== undefined && (ver > work.seen_ver || (ver === work.seen_ver && !!work.seen_hash && work.seen_hash !== c.payload_hash))
      ? { fromVer: work.seen_ver, toVer: ver }
      : null;

  return {
    id: c.id,
    docNo: c.doc_no ?? '',
    ver,
    deliveryDate: c.delivery_date,
    receivedAt: c.first_saved_at ?? c.first_seen_at,
    status: work && isSalesConfirmStatus(work.status) ? work.status : '접수',
    savedBy: c.saved_by ?? '',
    processors: work?.processors ?? [],
    salesRep: c.sales_rep ?? '',
    type: c.type ?? '',
    term: c.term ?? '',
    company: c.company ?? '',
    region: c.region ?? '',
    // 대표번호가 없으면 IT담당 → 계약담당 → 현장상주(실측 — types.ts contactLine)
    phone: contactLine(asObj(c.contacts) as Partial<SalesConfirmContacts>),
    itemSummary,
    specSummary: specParts.join(' · '),
    specEdited,
    assetIds: filled.map((u) => asStr(u.asset_id)),
    serials: sortedUnits.map((u) => asStr(u.serial)).filter(Boolean),
    unitsFilled: filled.length,
    unitsTotal,
    suppliesSummary: supplies.join(' · '),
    special: c.special ?? '',
    note: work?.note ?? '',
    isNew: !work || !work.first_opened_at,
    salesChanged,
    salesState: c.sales_state ?? '',
    docUrl: safeDocUrl(c.doc_url),
    workUpdatedAt: work?.updated_at ?? null,
    firstSeenAt: c.first_seen_at,
  };
}

/** 정렬: 오늘 이후 납품일 가까운 순 → 지난 건(가까운 과거부터) → 납품일 없음(접수 늦은 순) */
export function sortListRows(rows: SalesConfirmListRow[], today: string): SalesConfirmListRow[] {
  const grp = (r: SalesConfirmListRow) => (!r.deliveryDate ? 2 : r.deliveryDate >= today ? 0 : 1);
  return [...rows].sort((a, b) => {
    const ga = grp(a);
    const gb = grp(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return (a.deliveryDate ?? '').localeCompare(b.deliveryDate ?? '') || a.docNo.localeCompare(b.docNo);
    if (ga === 1) return (b.deliveryDate ?? '').localeCompare(a.deliveryDate ?? '') || a.docNo.localeCompare(b.docNo);
    return (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '') || a.docNo.localeCompare(b.docNo);
  });
}

// ───────────── 읽기 ─────────────

async function readWork(supabase: Supa, ids: string[]): Promise<Map<string, WorkDbRow>> {
  const out = new Map<string, WorkDbRow>();
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase.from(SALES_CONFIRM_WORK_TABLE).select(WORK_COLS).in('confirm_id', part);
    if (error) throw error;
    for (const w of (data ?? []) as WorkDbRow[]) out.set(w.confirm_id, w);
  }
  return out;
}

async function readUnits(supabase: Supa, ids: string[]): Promise<Map<string, UnitDbRow[]>> {
  const out = new Map<string, UnitDbRow[]>();
  for (const part of chunks(ids, CHUNK)) {
    const rows = await readAllPages<UnitDbRow>((from, to) =>
      supabase
        .from(SALES_CONFIRM_UNITS_TABLE)
        .select(UNIT_COLS)
        .in('confirm_id', part)
        .order('confirm_id')
        .order('slot_key')
        .order('unit_no')
        .range(from, to),
    );
    for (const u of rows) {
      const list = out.get(u.confirm_id);
      if (list) list.push(u);
      else out.set(u.confirm_id, [u]);
    }
  }
  return out;
}

async function rowsFor(supabase: Supa, confirms: ConfirmDbRow[]): Promise<SalesConfirmListRow[]> {
  const ids = confirms.map((c) => c.id);
  const [work, units] = await Promise.all([readWork(supabase, ids), readUnits(supabase, ids)]);
  return confirms.map((c) => buildRow(c, work.get(c.id), units.get(c.id) ?? []));
}

/** 시트 비교용: 고른 id 의 목록 줄(payload 없음) */
export async function loadListRowsByIds(ids: string[]): Promise<SalesConfirmListRow[]> {
  const supabase = createAdminClient();
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 2000);
  const confirms: ConfirmDbRow[] = [];
  for (const part of chunks(unique, CHUNK)) {
    const { data, error } = await supabase.from(SALES_CONFIRMS_TABLE).select(CONFIRM_COLS).in('id', part);
    if (error) throw error;
    confirms.push(...((data ?? []) as ConfirmDbRow[]));
  }
  return rowsFor(supabase, confirms);
}

export async function readImportStateRow(supabase: Supa) {
  const { data, error } = await supabase.from(SALES_IMPORT_STATE_TABLE).select('*').eq('id', 'main').maybeSingle();
  if (error) return null; // 상태 줄을 못 읽어도 목록은 보여 줌
  return importStateFromRow(data as SalesImportStateRow | null);
}

async function readPeople(supabase: Supa): Promise<string[]> {
  const { data, error } = await supabase.from(PREP_PEOPLE_TABLE).select('name').eq('is_active', true).order('sort_order').order('name');
  if (error) return [];
  return ((data ?? []) as { name: string }[]).map((p) => p.name).filter(Boolean);
}

export async function loadSalesConfirmList(): Promise<SalesConfirmListResult> {
  try {
    const supabase = createAdminClient();
    const today = kstTodayYmd();
    const cutoff = shiftYmd(today, -WINDOW_DAYS);
    const cutoffIso = new Date(`${cutoff}T00:00:00+09:00`).toISOString();

    // ① 최근 120일(처음 받은 날 또는 납품일)
    const recent = await readAllPages<ConfirmDbRow>((from, to) =>
      supabase
        .from(SALES_CONFIRMS_TABLE)
        .select(CONFIRM_COLS)
        .or(`first_seen_at.gte.${cutoffIso},delivery_date.gte.${cutoff}`)
        .order('id')
        .range(from, to),
    );
    const have = new Set(recent.map((r) => r.id));

    // 더 옛날 건 중 ③ 상태가 출고·취소가 아닌 것(처리 중이던 건이 사라지지 않게)
    const doneList = SALES_CONFIRM_DONE_STATUSES.map((s) => `"${s}"`).join(',');
    const openWork = await readAllPages<{ confirm_id: string }>((from, to) =>
      supabase.from(SALES_CONFIRM_WORK_TABLE).select('confirm_id').not('status', 'in', `(${doneList})`).order('confirm_id').range(from, to),
    );
    const olderIds = openWork.map((w) => w.confirm_id).filter((id) => !have.has(id));
    const older: ConfirmDbRow[] = [];
    for (const part of chunks(olderIds, CHUNK)) {
      const { data, error } = await supabase.from(SALES_CONFIRMS_TABLE).select(CONFIRM_COLS).in('id', part);
      if (error) throw error;
      older.push(...((data ?? []) as ConfirmDbRow[]));
    }

    const [rows, importState, people] = await Promise.all([
      rowsFor(supabase, [...recent, ...older]),
      readImportStateRow(supabase),
      readPeople(supabase),
    ]);
    return {
      ok: true,
      data: {
        rows: sortListRows(rows, today),
        importState,
        people,
        rangeLabel: `최근 ${WINDOW_DAYS}일 + 아직 안 끝난 옛 건`,
        hasKey: Boolean(process.env.SALES_EXPORT_KEY),
      },
    };
  } catch (err) {
    if (isMissingSalesTable(err)) return { ok: false, missingTable: true };
    // 원문·연락처가 섞일 수 있어 코드만 로그에 남김
    console.warn('[sales-confirms] 목록 읽기 실패', (err as { code?: string } | null)?.code ?? 'unknown');
    return { ok: false, error: '영업 확인서 목록을 못 읽었어요. 잠시 뒤 다시 열어 주세요.' };
  }
}
