import 'server-only';

/**
 * 계약 관리 — 거래처 개요·상세 조립(읽기) + 거래처 만들기(ensureClient · createManualClientRow).
 * 설계: docs/tasks/2026-11-20-contract-management.md §3-1 ~ §3-3, §3-7.
 *
 * - 화면을 여는 것만으로는 표에 쓰지 않음. 저장할 때(app/contracts/actions.ts 등)만 addMatchedKeys 로
 *   그 순간 맞은 works 줄 id·거래처 코드를 seen_asset_ids·vendor_codes 에 "더함"(빼지 않음).
 * - 거래처 코드(vendorCodeKey)는 서버 안에서만 — 반환 모양(types.ts)에 싣지 않음.
 * - 비밀 칸 값은 여기서 읽지 않음 — 상세의 secrets 는 빈 채로 두고, 잠금 확인 뒤 app/contracts/actions.ts 가 채움.
 * - 계약 표 select 는 칸 이름을 적음(* 금지).
 */
import {
  CONTRACT_CLIENTS_TABLE,
  SW_CONTRACTS_TABLE,
  SW_SEATS_TABLE,
  createAdminClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import { groupWorksRows, matchClients, type GroupRow, type SavedClientKeys, type WorksGroup } from './grouping';
import { nameKey } from './nameKey';
import { clientRenewal, kstTodayYmd, type RenewalContract } from './renewal';
import {
  PCM_ITEMS,
  SW_ITEMS,
  type ClientDetail,
  type ClientState,
  type ClientSummary,
  type ContractTab,
  type ContractsOverview,
  type EndedReason,
  type LicenseType,
  type MatchedBy,
  type SwContract,
  type SwSeat,
  type WorksLine,
} from './types';
import { loadContractAssets, type ContractAssetLine } from './worksSource';

type Supabase = ReturnType<typeof createAdminClient>;

// ---------- 공용 ----------

/** 사용자에게 그대로 보여 줘도 되는 쉬운 말 오류 */
export class UserError extends Error {}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

const CONTRACT_TABLE_NAMES = /it_contract_clients|it_sw_contracts|it_sw_seats|it_contract_secrets|it_contract_secret_log/;

/** 계약 표가 아직 없는지 — 좁게(42P01/PGRST205 또는 표 이름 + "does not exist" 류 문구). 권한 오류 등은 "없음"으로 안 봄 */
export function isMissingContractTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: string; code?: string };
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  const message = e.message ?? '';
  return CONTRACT_TABLE_NAMES.test(message) && /does not exist|could not find|schema cache/i.test(message);
}

/** Supabase 는 한 번에 1000줄까지만 — 끝까지 페이지로 읽음 */
export async function readPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function admin(): Supabase {
  if (!isSupabaseConfigured()) throw new UserError('Supabase 설정이 필요해요.');
  return createAdminClient();
}

const uniq = <T,>(list: T[]) => [...new Set(list)];

// ---------- 저장된 거래처 ----------

export const CLIENT_COLS =
  'id, name, name_key, alias_keys, vendor_codes, seen_asset_ids, not_in_works, manual_status, sales_owner, it_owner, key_person, key_phone, memo';

export type ClientRow = {
  id: string;
  name: string;
  name_key: string;
  alias_keys: string[] | null;
  vendor_codes: string[] | null;
  seen_asset_ids: number[] | null;
  not_in_works: boolean;
  manual_status: '' | 'ended' | 'hidden';
  sales_owner: string;
  it_owner: string;
  key_person: string;
  key_phone: string;
  memo: string;
};

export type SavedClient = SavedClientKeys & { row: ClientRow };

function toSaved(row: ClientRow): SavedClient {
  return {
    id: row.id,
    name: row.name,
    nameKey: row.name_key,
    aliasKeys: row.alias_keys ?? [],
    vendorCodes: row.vendor_codes ?? [],
    seenAssetIds: row.seen_asset_ids ?? [],
    row,
  };
}

export async function loadSavedClients(supabase: Supabase): Promise<SavedClient[]> {
  const rows = await readPages<ClientRow>((from, to) =>
    supabase.from(CONTRACT_CLIENTS_TABLE).select(CLIENT_COLS).order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toSaved);
}

// ---------- works 줄 ↔ 우리 거래처 맞추기 ----------

type Row = ContractAssetLine & GroupRow;
type Group = WorksGroup<Row>;

type Entry = {
  key: string; // 저장됨 = id, 아직 없음 = 'new:<묶음 열쇠>'
  saved: SavedClient | null;
  groups: Group[];
  by: MatchedBy;
  notices: string[];
};

const BY_RANK: Record<MatchedBy, number> = { asset: 3, code: 2, name: 1, new: 0 };

function toRows(lines: ContractAssetLine[]): Row[] {
  return lines.map((l) => ({ ...l, nameKey: nameKey(l.vendorName), codeKey: l.vendorCodeKey }));
}

const entryLines = (e: Entry): Row[] => e.groups.flatMap((g) => g.rows);

/** works 줄들을 묶고 우리 거래처와 맞춤. 같은 우리 거래처에 맞은 묶음은 하나로 합침 */
function resolveEntries(lines: ContractAssetLine[], saved: SavedClient[]): Entry[] {
  const groups = groupWorksRows(toRows(lines));
  const matches = matchClients(groups, saved);
  const entries: Entry[] = [];
  const bySaved = new Map<string, Entry>();
  for (const m of matches) {
    const notices: string[] = [];
    if (m.renamed) notices.push(`works 이름이 바뀌었어요: ${m.renamed.from} → ${m.renamed.to}`);
    if (m.splitWith.length) notices.push(`거래처가 둘로 나뉘어 있어요 — ${m.splitWith.map((c) => c.name).join(', ')} 와(과) 합치기`);
    if (m.client) {
      const found = bySaved.get(m.client.id);
      if (found) {
        found.groups.push(m.group);
        if (BY_RANK[m.by] > BY_RANK[found.by]) found.by = m.by;
        found.notices = uniq([...found.notices, ...notices]);
        continue;
      }
      const entry: Entry = { key: m.client.id, saved: m.client, groups: [m.group], by: m.by, notices };
      bySaved.set(m.client.id, entry);
      entries.push(entry);
    } else {
      entries.push({ key: `new:${m.group.key}`, saved: null, groups: [m.group], by: 'new', notices });
    }
  }
  return entries;
}

/** 'new:code:123' / 'new:name:abc' 열쇠가 이 묶음 중 하나를 가리키는가(탭마다 묶음이 달라질 수 있어 코드·이름 키로도 맞춤) */
function matchesNewKey(e: Entry, key: string): boolean {
  if (e.saved) return false;
  const k = key.replace(/^new:/, '');
  return e.groups.some((g) => {
    if (g.key === k) return true;
    if (k.startsWith('code:')) return g.codes.includes(k.slice(5));
    if (k.startsWith('name:')) return g.nameKeys.includes(k.slice(5));
    return false;
  });
}

// ---------- 계약·좌석 읽기(개요용 가벼운 칸) ----------

type ContractLight = {
  id: string;
  client_id: string;
  product: string;
  license_type: string;
  term: '' | 'monthly' | 'yearly';
  quantity: number | null;
  status: string;
  renews_on: string | null;
  ends_on: string | null;
};
type SeatLight = {
  id: string;
  contract_id: string;
  user_name: string;
  pc_asset_code: string;
  status: string;
  renews_on: string | null;
  ends_on: string | null;
};

const CONTRACT_LIGHT_COLS = 'id, client_id, product, license_type, term, quantity, status, renews_on, ends_on';
const SEAT_LIGHT_COLS = 'id, contract_id, user_name, pc_asset_code, status, renews_on, ends_on';

type OverviewDb = { missing: boolean; saved: SavedClient[]; contracts: ContractLight[]; seats: SeatLight[] };

async function loadOverviewDb(supabase: Supabase, tab: ContractTab): Promise<OverviewDb> {
  try {
    const saved = await loadSavedClients(supabase);
    if (tab !== 'sw') return { missing: false, saved, contracts: [], seats: [] };
    const [contracts, seats] = await Promise.all([
      readPages<ContractLight>((from, to) =>
        supabase.from(SW_CONTRACTS_TABLE).select(CONTRACT_LIGHT_COLS).order('id', { ascending: true }).range(from, to),
      ),
      readPages<SeatLight>((from, to) =>
        supabase.from(SW_SEATS_TABLE).select(SEAT_LIGHT_COLS).order('id', { ascending: true }).range(from, to),
      ),
    ]);
    return { missing: false, saved, contracts, seats };
  } catch (err) {
    if (isMissingContractTable(err)) return { missing: true, saved: [], contracts: [], seats: [] };
    throw err;
  }
}

function group<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of list) {
    const k = key(t);
    const l = m.get(k);
    if (l) l.push(t);
    else m.set(k, [t]);
  }
  return m;
}

const isActiveLine = (l: { status: string }) => l.status !== '임대종료';
const LICENSE_TYPES = new Set(['perpetual', 'subscription', 'free', 'unknown']);

function toRenewalContract(c: ContractLight, seats: SeatLight[]): RenewalContract {
  return {
    term: c.term,
    status: c.status,
    renewsOn: c.renews_on,
    endsOn: c.ends_on,
    seats: seats.map((s) => ({ renewsOn: s.renews_on, endsOn: s.ends_on, status: s.status })),
  };
}

type SummaryCtx = {
  tab: ContractTab;
  today: string;
  source: ContractsOverview['source'];
  contractsByClient: Map<string, ContractLight[]>;
  seatsByContract: Map<string, SeatLight[]>;
};

function summarize(e: Entry, ctx: SummaryCtx): ClientSummary {
  const saved = e.saved;
  const lines = entryLines(e);
  const hasGroup = e.groups.length > 0;
  const activeLines = lines.filter(isActiveLine);
  const endedLines = lines.length - activeLines.length;

  let state: ClientState;
  let endedReason: EndedReason = null;
  if (saved?.row.manual_status === 'ended' || saved?.row.manual_status === 'hidden') {
    state = 'ended';
    endedReason = 'manual';
  } else if (!hasGroup) {
    if (saved?.row.not_in_works) state = 'manual';
    else if (ctx.source === 'none') state = 'active'; // 목록을 못 읽어서 종료인지 알 수 없음
    else {
      state = 'ended';
      endedReason = 'not_in_works';
    }
  } else if (activeLines.length > 0) {
    state = 'active';
  } else {
    state = 'ended';
    endedReason = 'rental_ended';
  }

  const contracts = saved ? ctx.contractsByClient.get(saved.id) ?? [] : [];
  const seatsOf = (c: ContractLight) => ctx.seatsByContract.get(c.id) ?? [];

  const productMap = new Map<string, number>();
  let licenseCount = 0;
  for (const c of contracts) {
    if (c.status === '해지' || c.status === '만료') continue;
    const n = c.quantity ?? seatsOf(c).filter((s) => s.status === '사용중' || s.status === '미배정').length;
    licenseCount += n;
    productMap.set(c.product, (productMap.get(c.product) ?? 0) + n);
  }
  const products = [...productMap.entries()].map(([name, count]) => ({ name, count }));
  const renewal =
    ctx.tab === 'sw' && state !== 'ended'
      ? clientRenewal(contracts.map((c) => toRenewalContract(c, seatsOf(c))), ctx.today)
      : { state: 'nodate' as const, next: null };

  const dates = lines.map((l) => l.contractDate).filter(Boolean).sort();
  const worksName = hasGroup ? e.groups[0].name : '';
  const name = saved?.name ?? worksName;
  const siteSource = activeLines.length ? activeLines : lines;
  const searchParts = [
    name,
    worksName,
    ...products.map((p) => p.name),
    ...contracts.flatMap((c) => seatsOf(c).flatMap((s) => [s.user_name, s.pc_asset_code])),
    ...lines.map((l) => l.assetCode),
  ];

  return {
    key: e.key,
    id: saved?.id ?? null,
    name,
    worksName,
    matchedBy: e.by,
    state,
    endedReason,
    needsDetail: state !== 'ended' && (!saved || (ctx.tab === 'sw' && contracts.length === 0)),
    activeLines: activeLines.length,
    endedLines,
    firstContract: dates[0] ?? '',
    lastContract: dates[dates.length - 1] ?? '',
    sites: uniq(siteSource.map((l) => l.siteName).filter(Boolean)).slice(0, 8),
    notice: e.notices.length ? e.notices.join(' / ') : null,
    products,
    licenseCount,
    nextDate: renewal.next,
    renewal: renewal.state,
    salesOwner: saved?.row.sales_owner ?? '',
    itOwner: saved?.row.it_owner ?? '',
    searchText: searchParts.filter(Boolean).join(' ').toLowerCase(),
  };
}

/** 정렬: 날짜 지남 → 30일 안 → 상세 미입력 → 이름순, 계약 종료는 맨 아래 */
function sortRank(c: ClientSummary): number {
  if (c.state === 'ended') return 9;
  if (c.renewal === 'expired') return 0;
  if (c.renewal === 'due30') return 1;
  if (c.needsDetail) return 2;
  return 3;
}

// ---------- 개요 ----------

/** 계약 화면 목록 — works(또는 사본)·거래처·계약·좌석을 동시에 읽어 조립. 표가 없으면 tablesMissing(works 거래처는 그대로 보임) */
export async function buildContractsOverview(tab: ContractTab): Promise<ContractsOverview> {
  const supabase = admin();
  const today = kstTodayYmd();
  const [assets, db] = await Promise.all([loadContractAssets(), loadOverviewDb(supabase, tab)]);

  const tabItems: readonly string[] = tab === 'sw' ? SW_ITEMS : PCM_ITEMS;
  const entries = resolveEntries(assets.lines.filter((l) => tabItems.includes(l.item)), db.saved);

  // 이 탭의 works 줄에 안 맞은 저장 거래처 — 소프트웨어 탭은 works에 없는 곳·계약이 있는 곳만(계약 종료로 보임)
  if (tab === 'sw') {
    const matched = new Set(entries.map((e) => e.saved?.id).filter(Boolean));
    const hasContract = new Set(db.contracts.map((c) => c.client_id));
    for (const s of db.saved) {
      if (matched.has(s.id)) continue;
      if (s.row.not_in_works || hasContract.has(s.id)) entries.push({ key: s.id, saved: s, groups: [], by: 'new', notices: [] });
    }
  }

  const ctx: SummaryCtx = {
    tab,
    today,
    source: assets.source,
    contractsByClient: group(db.contracts, (c) => c.client_id),
    seatsByContract: group(db.seats, (s) => s.contract_id),
  };
  const clients = entries.map((e) => summarize(e, ctx));
  clients.sort((a, b) => sortRank(a) - sortRank(b) || a.name.localeCompare(b.name, 'ko'));

  return {
    tab,
    clients,
    source: assets.source,
    sourceMs: assets.ms,
    sourceError: assets.error,
    readAt: new Date().toISOString(),
    tablesMissing: db.missing,
  };
}

// ---------- 상세 ----------

const CONTRACT_COLS =
  'id, client_id, product, supplier, license_type, license_type_raw, term, pay_cycle, quantity, starts_on, renews_on, ends_on, cost_note, admin_portal, setup_vendor, status, memo, source';
const SEAT_COLS =
  'id, contract_id, user_name, dept, pc_asset_code, mfa_note, works_asset_id, works_seq, installed_on, purchased_on, renews_on, ends_on, status, memo, source_raw, updated_at';

type ContractFull = ContractLight & {
  supplier: string;
  license_type_raw: string;
  pay_cycle: '' | 'monthly' | 'yearly' | 'once';
  starts_on: string | null;
  cost_note: string;
  admin_portal: string;
  setup_vendor: string;
  memo: string;
  source: string;
};
type SeatFull = SeatLight & {
  dept: string;
  mfa_note: string;
  works_asset_id: number | null;
  works_seq: string;
  installed_on: string | null;
  purchased_on: string | null;
  memo: string;
  source_raw: Record<string, unknown> | null;
  updated_at: string;
};

function rawToStrings(raw: Record<string, unknown> | null): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v == null ? '' : String(v);
  return Object.keys(out).length ? out : null;
}

/** 거래처 한 곳의 상세(거래처 정보·works 줄·계약 상품·좌석). key = 저장된 거래처 id 또는 'new:…'. 비밀 값은 안 읽고 어느 칸에 있는지만 */
export async function buildClientDetail(key: string): Promise<ClientDetail> {
  const supabase = admin();
  const today = kstTodayYmd();
  let saved: SavedClient[];
  try {
    saved = await loadSavedClients(supabase);
  } catch (err) {
    if (isMissingContractTable(err)) throw new UserError('계약 관리 표가 아직 없어요 — supabase/contracts_schema.sql 을 먼저 실행해 주세요.');
    throw err;
  }
  const assets = await loadContractAssets();
  const entries = resolveEntries(assets.lines, saved);

  let entry: Entry | undefined = entries.find((e) => e.key === key) ?? entries.find((e) => matchesNewKey(e, key));
  if (!entry) {
    const s = saved.find((x) => x.id === key);
    if (!s) throw new UserError('거래처를 못 찾았어요 — works에서 사라졌거나 이름이 바뀌었을 수 있어요. 목록을 다시 열어 주세요.');
    entry = { key: s.id, saved: s, groups: [], by: 'new', notices: [] };
  }

  let contracts: ContractFull[] = [];
  let seats: SeatFull[] = [];
  if (entry.saved) {
    const clientId = entry.saved.id;
    contracts = await readPages<ContractFull>((from, to) =>
      supabase
        .from(SW_CONTRACTS_TABLE)
        .select(CONTRACT_COLS)
        .eq('client_id', clientId)
        .order('product', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    const ids = contracts.map((c) => c.id);
    if (ids.length) {
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50);
        seats.push(
          ...(await readPages<SeatFull>((from, to) =>
            supabase
              .from(SW_SEATS_TABLE)
              .select(SEAT_COLS)
              .in('contract_id', part)
              .order('user_name', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to),
          )),
        );
      }
    }
  }
  const seatsByContract = group(seats, (s) => s.contract_id);
  const swContracts: SwContract[] = contracts.map((c) => {
    const cs = seatsByContract.get(c.id) ?? [];
    const r = clientRenewal([toRenewalContract(c, cs)], today);
    return {
      id: c.id,
      product: c.product,
      supplier: c.supplier,
      licenseType: (LICENSE_TYPES.has(c.license_type) ? c.license_type : 'unknown') as LicenseType,
      term: c.term,
      payCycle: c.pay_cycle,
      licenseTypeRaw: c.license_type_raw,
      quantity: c.quantity,
      startsOn: c.starts_on,
      renewsOn: c.renews_on,
      endsOn: c.ends_on,
      costNote: c.cost_note,
      adminPortal: c.admin_portal,
      setupVendor: c.setup_vendor,
      status: c.status,
      memo: c.memo,
      source: c.source,
      secrets: {},
      seats: cs.map(
        (s): SwSeat => ({
          id: s.id,
          userName: s.user_name,
          dept: s.dept,
          pcAssetCode: s.pc_asset_code,
          mfaNote: s.mfa_note,
          worksAssetId: s.works_asset_id,
          worksSeq: s.works_seq,
          installedOn: s.installed_on,
          purchasedOn: s.purchased_on,
          renewsOn: s.renews_on,
          endsOn: s.ends_on,
          status: s.status,
          memo: s.memo,
          secrets: {},
          sourceRaw: rawToStrings(s.source_raw),
          updatedAt: s.updated_at,
        }),
      ),
      nextDate: r.next,
      renewal: r.state,
    };
  });

  const summary = summarize(entry, {
    tab: 'sw',
    today,
    source: assets.source,
    contractsByClient: group(contracts, (c) => c.client_id),
    seatsByContract,
  });
  const row = entry.saved?.row;
  const lines: WorksLine[] = entryLines(entry).map((l) => ({
    assetId: l.assetId,
    seq: l.seq,
    vendorName: l.vendorName,
    siteName: l.siteName,
    assetCode: l.assetCode,
    modelName: l.modelName,
    serial: l.serial,
    item: l.item,
    status: l.status,
    contractDate: l.contractDate,
    endDate: l.endDate,
  }));
  return {
    client: {
      ...summary,
      memo: row?.memo ?? '',
      keyPerson: row?.key_person ?? '',
      keyPhone: row?.key_phone ?? '',
      aliasKeys: entry.saved?.aliasKeys ?? [],
      manualStatus: row?.manual_status ?? '',
      notInWorks: row?.not_in_works ?? false,
    },
    lines,
    source: assets.source,
    contracts: swContracts,
  };
}

// ---------- 거래처 만들기·맞은 줄 더하기(저장할 때만) ----------

/** 거래처 행 한 곳에 works 줄 id·거래처 코드를 "더함"(빼지 않음). 바뀐 게 없으면 쓰지 않음 */
async function mergeKeys(supabase: Supabase, s: SavedClient, assetIds: number[], codes: string[]): Promise<void> {
  const ids = uniq([...s.seenAssetIds, ...assetIds]);
  const cs = uniq([...s.vendorCodes, ...codes]);
  if (ids.length === s.seenAssetIds.length && cs.length === s.vendorCodes.length) return;
  const { error } = await supabase.from(CONTRACT_CLIENTS_TABLE).update({ seen_asset_ids: ids, vendor_codes: cs }).eq('id', s.id);
  if (error) throw error;
}

/**
 * 저장한 직후 호출 — 지금 이 거래처에 맞는 works 줄 id·코드를 seen_asset_ids·vendor_codes 에 더함.
 * 덤이라서 실패해도 저장 결과를 뒤집지 않음(서버 로그만) — works 를 못 읽으면 그냥 넘어감.
 */
export async function addMatchedKeys(clientId: string): Promise<void> {
  try {
    const supabase = admin();
    const [assets, saved] = await Promise.all([loadContractAssets(), loadSavedClients(supabase)]);
    if (assets.source === 'none' || assets.lines.length === 0) return;
    const entry = resolveEntries(assets.lines, saved).find((e) => e.saved?.id === clientId);
    if (!entry?.saved) return;
    const lines = entryLines(entry);
    await mergeKeys(
      supabase,
      entry.saved,
      lines.map((l) => l.assetId),
      lines.map((l) => l.vendorCodeKey).filter(Boolean),
    );
  } catch (err) {
    console.error('[contracts] 맞은 works 줄 기록 실패(저장은 됨):', errText(err));
  }
}

async function selectIdByNameKey(supabase: Supabase, key: string): Promise<string | null> {
  const { data, error } = await supabase.from(CONTRACT_CLIENTS_TABLE).select('id').eq('name_key', key).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * 거래처 열쇠를 거래처 id 로. 'new:…' 이면 works 줄에서 거래처를 만들고(상세 미입력 상태) 그때 맞은 줄 id·코드를 더함,
 * 이미 있으면(그 사이 누가 만들었거나 이름이 같음) 그 id. 저장된 id 면 그대로.
 */
export async function ensureClient(clientKey: string, actor: string): Promise<string> {
  if (!clientKey.startsWith('new:')) return clientKey;
  const supabase = admin();
  const [assets, saved] = await Promise.all([loadContractAssets(), loadSavedClients(supabase)]);
  if (assets.source === 'none') throw new UserError('거래처 목록을 못 읽어서 새 거래처를 만들 수 없어요. 잠시 뒤 다시 해 주세요.');
  const entry = resolveEntries(assets.lines, saved).find((e) => matchesNewKey(e, clientKey));
  if (!entry) {
    // 그 사이 다른 사람이 만들어서 저장된 거래처에 합쳐졌을 수 있음
    const key = clientKey.replace(/^new:(code|name):/, '');
    const existing = saved.find((s) => s.nameKey === key || s.aliasKeys.includes(key) || s.vendorCodes.includes(key));
    if (existing) return existing.id;
    throw new UserError('works에서 이 거래처를 못 찾았어요. 목록을 다시 열어 주세요.');
  }
  const g = entry.groups[0];
  const lines = entryLines(entry);
  const name = g.name.trim() || g.key.replace(/^(code|name):/, '');
  const key = nameKey(name) || g.key;
  const { data, error } = await supabase
    .from(CONTRACT_CLIENTS_TABLE)
    .insert({
      name,
      name_key: key,
      alias_keys: uniq(entry.groups.flatMap((x) => x.nameKeys)).filter((k) => k !== key),
      vendor_codes: uniq(entry.groups.flatMap((x) => x.codes)),
      seen_asset_ids: uniq(lines.map((l) => l.assetId)),
      created_by: actor,
      updated_by: actor,
    })
    .select('id')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const id = await selectIdByNameKey(supabase, key);
      if (id) return id;
    }
    throw error;
  }
  return (data as { id: string }).id;
}

/** works 에 없는 거래처(판매·직접 계약·옮기기 미분류) 만들기. 같은 이름 키가 이미 있으면 그 id */
export async function createManualClientRow(name: string, actor: string): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new UserError('거래처 이름을 적어 주세요.');
  const key = nameKey(clean);
  if (!key) throw new UserError('거래처 이름에 글자가 있어야 해요.');
  const supabase = admin();
  const existing = await selectIdByNameKey(supabase, key);
  if (existing) return existing;
  const { data, error } = await supabase
    .from(CONTRACT_CLIENTS_TABLE)
    .insert({ name: clean, name_key: key, not_in_works: true, created_by: actor, updated_by: actor })
    .select('id')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const id = await selectIdByNameKey(supabase, key);
      if (id) return id;
    }
    throw error;
  }
  return (data as { id: string }).id;
}

/** 합치기(addClientAlias)용 — 'new:…' 묶음이 가진 이름 키·코드·줄 id. 못 찾으면 null(목록을 못 읽었을 때 포함) */
export async function lookupNewGroup(
  otherKey: string,
): Promise<{ name: string; nameKeys: string[]; codes: string[]; assetIds: number[]; saved: SavedClient[] } | null> {
  const supabase = admin();
  const [assets, saved] = await Promise.all([loadContractAssets(), loadSavedClients(supabase)]);
  if (assets.source === 'none') return null;
  const entry = resolveEntries(assets.lines, saved).find((e) => matchesNewKey(e, otherKey));
  if (!entry) return null;
  const lines = entryLines(entry);
  return {
    name: entry.groups[0].name,
    nameKeys: uniq(entry.groups.flatMap((g) => g.nameKeys)),
    codes: uniq(entry.groups.flatMap((g) => g.codes)),
    assetIds: lines.map((l) => l.assetId),
    saved,
  };
}
