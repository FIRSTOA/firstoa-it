'use server';

/**
 * 계약 관리(/contracts) 서버 액션 — 거래처·계약 상품·좌석. 설계 docs/tasks/2026-11-20-contract-management.md §3-7.
 * 이름·인자는 lib/contracts/types.ts 맨 아래 주석 목록과 같음. 'use server' 파일이라 async 함수만 export.
 * D13: 소프트웨어(sw) 개요·상세·모든 쓰기는 서버에서 잠금 해제(비밀번호 확인)를 먼저 확인 — 아니면 needUnlock.
 * 비밀 칸 값은 상세(getClientDetail)에서만 읽고(readSecretsForOwners), 쓰는 건 secretActions.ts 몫.
 * 쓰기 뒤 revalidatePath('/contracts'), ('/home'). 저장할 때마다 맞은 works 줄 id·코드를 거래처에 더함(addMatchedKeys).
 */
import { revalidatePath } from 'next/cache';
import {
  CONTRACT_CLIENTS_TABLE,
  SW_CONTRACTS_TABLE,
  SW_SEATS_TABLE,
  createAdminClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  UserError,
  addMatchedKeys,
  buildClientDetail,
  buildContractsOverview,
  createManualClientRow,
  ensureClient,
  errText,
  isMissingContractTable,
  loadSavedClients,
  lookupNewGroup,
} from '@/lib/contracts/clients';
import { nameKey } from '@/lib/contracts/nameKey';
import { kstTodayYmd, nextRenewDate } from '@/lib/contracts/renewal';
import { UnlockRequired, logSecretEvent, readSecretsForOwners, requireUnlock } from '@/lib/contracts/secrets';
import {
  SW_CONTRACT_STATUSES,
  SW_SEAT_STATUSES,
  type ActionResult,
  type ClientDetail,
  type ClientInput,
  type ContractTab,
  type ContractsOverview,
  type SwContractInput,
  type SwSeatInput,
} from '@/lib/contracts/types';

// ---------- 공용 ----------

const SQL_FIRST = '계약 관리 표가 아직 없어요 — supabase/contracts_schema.sql 을 Supabase SQL Editor에서 먼저 실행해 주세요.';

function friendly(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (isMissingContractTable(e)) return SQL_FIRST;
  const code = e && typeof e === 'object' ? (e as { code?: string }).code : undefined;
  if (code === '23001' || code === '23503') return '아직 연결된 항목이 있어요. 연결된 계약·좌석을 먼저 지워 주세요.';
  return `처리하지 못했어요 — ${errText(e)}`;
}

function refresh() {
  revalidatePath('/contracts');
  revalidatePath('/home');
}

function db() {
  if (!isSupabaseConfigured()) throw new UserError('Supabase 설정이 필요해요.');
  return createAdminClient();
}

/** 실패는 쉬운 말로 돌려주고(삼키지 않음), 성공하면 화면 보관값을 비움 */
async function run<T extends object>(write: boolean, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const r = await fn();
    if (write) refresh();
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, error: friendly(e) };
  }
}

const LOCKED_MSG = '소프트웨어 계약은 비밀번호를 넣어야 볼 수 있어요.';

/** 잠금이 풀려 있어야만 실행 — 아니면 needUnlock. 풀린 사람 이름을 fn 에 넘김 */
async function runLocked<T extends object>(write: boolean, fn: (unlocked: { name: string }) => Promise<T>): Promise<ActionResult<T>> {
  let who: { name: string };
  try {
    who = await requireUnlock();
  } catch (e) {
    if (e instanceof UnlockRequired) return { ok: false as const, error: LOCKED_MSG, needUnlock: true };
    return { ok: false as const, error: friendly(e) };
  }
  return run(write, () => fn(who));
}

function cleanActor(actor: string): string {
  return String(actor ?? '').trim().slice(0, 40);
}

function text(v: unknown, max = 2000): string {
  return String(v ?? '').trim().slice(0, max);
}

function ymd(v: string | null | undefined, label: string): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new UserError(`${label} 날짜 형식이 맞지 않아요(예: 2026-12-31).`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new UserError(`${label} 날짜가 달력에 없는 날이에요.`);
  }
  return s;
}

const LICENSE_TYPES = ['perpetual', 'subscription', 'free', 'unknown'];
const TERMS = ['', 'monthly', 'yearly'];
const PAY_CYCLES = ['', 'monthly', 'yearly', 'once'];

function oneOf<T extends string>(v: string, allowed: readonly string[], label: string): T {
  if (!allowed.includes(v)) throw new UserError(`${label} 값이 올바르지 않아요.`);
  return v as T;
}

// ---------- 읽기 ----------

export async function getContractsOverview(tab: ContractTab): Promise<ActionResult<{ overview: ContractsOverview }>> {
  // 2단계 PC 유지보수 탭은 잠금 없이(지금), 소프트웨어 탭은 잠금 확인 뒤에만
  if (tab === 'pcm') return run(false, async () => ({ overview: await buildContractsOverview('pcm') }));
  return runLocked(false, async () => ({ overview: await buildContractsOverview('sw') }));
}

export async function getClientDetail(key: string): Promise<ActionResult<{ detail: ClientDetail }>> {
  return runLocked(false, async ({ name }) => {
    const detail = await buildClientDetail(String(key ?? ''));
    // 열림 상태에서만 비밀 값을 채움(값은 응답에만 — 기록·로그엔 개수만)
    const secrets = await readSecretsForOwners({
      contractIds: detail.contracts.map((c) => c.id),
      seatIds: detail.contracts.flatMap((c) => c.seats.map((s) => s.id)),
    });
    let count = 0;
    for (const c of detail.contracts) {
      c.secrets = secrets.contract.get(c.id) ?? {};
      count += Object.keys(c.secrets).length;
      for (const st of c.seats) {
        st.secrets = secrets.seat.get(st.id) ?? {};
        count += Object.keys(st.secrets).length;
      }
    }
    await logSecretEvent({
      action: 'view_bulk',
      actor: name,
      clientId: detail.client.id ?? undefined,
      clientName: detail.client.name,
      count,
      note: '거래처 상세 열기',
    });
    return { detail };
  });
}

// ---------- 거래처 ----------

/** 다른 거래처가 이 이름 키를 이미 쓰고 있으면 막음(주 이름·다른 표기 모두) */
async function assertNameKeyFree(key: string, exceptId: string | null): Promise<void> {
  const saved = await loadSavedClients(db());
  const other = saved.find((s) => s.id !== exceptId && (s.nameKey === key || s.aliasKeys.includes(key)));
  if (other) throw new UserError(`같은 이름의 거래처가 이미 있어요: ${other.name}`);
}

export async function saveClient(input: ClientInput, actor: string): Promise<ActionResult<{ id: string }>> {
  return runLocked(true, async () => {
    const by = cleanActor(actor);
    const name = text(input.name, 200);
    if (!name) throw new UserError('거래처 이름을 적어 주세요.');
    const newKey = nameKey(name);
    if (!newKey) throw new UserError('거래처 이름에 글자가 있어야 해요.');
    if (!['', 'ended', 'hidden'].includes(input.manualStatus)) throw new UserError('상태 값이 올바르지 않아요.');
    const fields = {
      key_person: text(input.keyPerson, 100),
      key_phone: text(input.keyPhone, 100),
      sales_owner: text(input.salesOwner, 100),
      it_owner: text(input.itOwner, 100),
      memo: text(input.memo, 4000),
      manual_status: input.manualStatus,
      updated_by: by,
    };
    const supabase = db();
    const id = await ensureClient(input.key, by);
    const { data: cur, error: curErr } = await supabase
      .from(CONTRACT_CLIENTS_TABLE)
      .select('id, name, name_key, alias_keys')
      .eq('id', id)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!cur) throw new UserError('거래처를 못 찾았어요. 목록을 다시 열어 주세요.');
    const row = cur as { id: string; name: string; name_key: string; alias_keys: string[] | null };
    const patch: Record<string, unknown> = { ...fields };
    if (name !== row.name || newKey !== row.name_key) {
      if (newKey !== row.name_key) await assertNameKeyFree(newKey, id);
      patch.name = name;
      patch.name_key = newKey;
      // 옛 이름 키는 다른 표기로 남겨 works 이름과 계속 맞게(빼지 않음)
      const alias = (row.alias_keys ?? []).filter((k) => k !== newKey);
      patch.alias_keys = alias.includes(row.name_key) || row.name_key === newKey ? alias : [...alias, row.name_key];
    }
    const { error } = await supabase.from(CONTRACT_CLIENTS_TABLE).update(patch).eq('id', id);
    if (error) throw error;
    await addMatchedKeys(id);
    return { id };
  });
}

/** 합치기 — works 의 다른 표기 거래처('new:…')를 이 거래처의 다른 표기로 더함. 이미 저장된 다른 거래처면 거절 */
export async function addClientAlias(clientId: string, otherKey: string, actor: string): Promise<ActionResult> {
  return runLocked(true, async () => {
    const by = cleanActor(actor);
    if (!otherKey.startsWith('new:')) {
      throw new UserError('이미 따로 저장된 거래처는 합칠 수 없어요(계약·좌석이 섞여요). 아직 저장 안 된 거래처만 합칠 수 있어요.');
    }
    const supabase = db();
    const target = await lookupNewGroup(otherKey);
    if (!target) throw new UserError('합칠 거래처를 works에서 못 찾았어요. 목록을 다시 열어 주세요.');
    const mine = target.saved.find((s) => s.id === clientId);
    if (!mine) throw new UserError('거래처를 못 찾았어요. 목록을 다시 열어 주세요.');
    const clash = target.saved.find((s) => s.id !== clientId && (target.nameKeys.includes(s.nameKey) || s.aliasKeys.some((k) => target.nameKeys.includes(k))));
    if (clash) throw new UserError(`이미 따로 저장된 거래처예요: ${clash.name}`);
    const alias = [...new Set([...mine.aliasKeys, ...target.nameKeys])].filter((k) => k !== mine.nameKey);
    const { error } = await supabase
      .from(CONTRACT_CLIENTS_TABLE)
      .update({
        alias_keys: alias,
        vendor_codes: [...new Set([...mine.vendorCodes, ...target.codes])],
        seen_asset_ids: [...new Set([...mine.seenAssetIds, ...target.assetIds])],
        updated_by: by,
      })
      .eq('id', clientId);
    if (error) throw error;
    return {};
  });
}

export async function createManualClient(name: string, actor: string): Promise<ActionResult<{ id: string }>> {
  return runLocked(true, async () => ({ id: await createManualClientRow(name, cleanActor(actor)) }));
}

/** 계약 상품이 0개일 때만 지움 */
export async function deleteClient(id: string, actor: string): Promise<ActionResult> {
  return runLocked(true, async () => {
    const supabase = db();
    const { count, error: cErr } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('client_id', id);
    if (cErr) throw cErr;
    if ((count ?? 0) > 0) throw new UserError(`계약 상품이 ${count}개 있어요. 상품을 먼저 지워 주세요.`);
    const { error } = await supabase.from(CONTRACT_CLIENTS_TABLE).delete().eq('id', id);
    if (error) throw error;
    console.info(`[contracts] 거래처 삭제 by ${cleanActor(actor) || '-'}`);
    return {};
  });
}

// ---------- 계약 상품 ----------

function contractFields(input: SwContractInput) {
  const product = text(input.product, 200);
  if (!product) throw new UserError('상품 이름을 적어 주세요.');
  if (input.quantity != null && (!Number.isInteger(input.quantity) || input.quantity < 0)) {
    throw new UserError('수량은 0 이상의 정수로 적어 주세요.');
  }
  return {
    product,
    supplier: text(input.supplier, 200),
    license_type: oneOf(input.licenseType, LICENSE_TYPES, '라이선스 유형'),
    term: oneOf(input.term, TERMS, '구독 단위'),
    pay_cycle: oneOf(input.payCycle, PAY_CYCLES, '결제 주기'),
    quantity: input.quantity ?? null,
    starts_on: ymd(input.startsOn, '시작일'),
    renews_on: ymd(input.renewsOn, '갱신일'),
    ends_on: ymd(input.endsOn, '종료일'),
    cost_note: text(input.costNote, 1000),
    admin_portal: text(input.adminPortal, 500),
    setup_vendor: text(input.setupVendor, 200),
    status: oneOf(input.status, SW_CONTRACT_STATUSES, '상태'),
    memo: text(input.memo, 4000),
  };
}

export async function saveSwContract(input: SwContractInput, actor: string): Promise<ActionResult<{ id: string; clientId: string }>> {
  return runLocked(true, async () => {
    const by = cleanActor(actor);
    const fields = contractFields(input);
    const supabase = db();
    if (input.id) {
      // 거래처는 안 바꿈(다른 거래처로 옮기기는 moveSwContract)
      const { data, error } = await supabase
        .from(SW_CONTRACTS_TABLE)
        .update({ ...fields, updated_by: by })
        .eq('id', input.id)
        .select('id, client_id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new UserError('계약 상품을 못 찾았어요. 목록을 다시 열어 주세요.');
      const row = data as { id: string; client_id: string };
      await addMatchedKeys(row.client_id);
      return { id: row.id, clientId: row.client_id };
    }
    const clientId = await ensureClient(input.clientKey, by);
    const { data, error } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .insert({ ...fields, client_id: clientId, source: 'app', created_by: by, updated_by: by })
      .select('id')
      .single();
    if (error) throw error;
    await addMatchedKeys(clientId);
    return { id: (data as { id: string }).id, clientId };
  });
}

/** 좌석 0개일 때만(계약 단위 비밀 칸은 같이 지워짐 — 열림 상태에서만 이 액션이 실행되므로 D2 충족) */
export async function deleteSwContract(id: string): Promise<ActionResult> {
  return runLocked(true, async ({ name }) => {
    const supabase = db();
    const { count, error: cErr } = await supabase
      .from(SW_SEATS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', id);
    if (cErr) throw cErr;
    if ((count ?? 0) > 0) throw new UserError(`좌석이 ${count}개 있어요. 좌석을 먼저 지워 주세요.`);
    const { error } = await supabase.from(SW_CONTRACTS_TABLE).delete().eq('id', id);
    if (error) throw error;
    await logSecretEvent({ action: 'delete', actor: name, contractId: id, note: '계약 상품 삭제' });
    return {};
  });
}

export async function moveSwContract(contractId: string, clientKey: string, actor: string): Promise<ActionResult<{ clientId: string }>> {
  return runLocked(true, async () => {
    const by = cleanActor(actor);
    const supabase = db();
    const clientId = await ensureClient(clientKey, by);
    const { data, error } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .update({ client_id: clientId, updated_by: by })
      .eq('id', contractId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('계약 상품을 못 찾았어요. 목록을 다시 열어 주세요.');
    await addMatchedKeys(clientId);
    return { clientId };
  });
}

/** 갱신 처리 — 계약 갱신일과 사용 중 좌석의 갱신일을 구독 단위(월 구독 1개월, 아니면 1년)만큼 뒤로(오늘 이후가 될 때까지) */
export async function renewSwContract(id: string, actor: string): Promise<ActionResult<{ renewsOn: string | null }>> {
  return runLocked(true, async () => {
    const by = cleanActor(actor);
    const supabase = db();
    const today = kstTodayYmd();
    const { data, error } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .select('id, client_id, term, renews_on, status')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('계약 상품을 못 찾았어요. 목록을 다시 열어 주세요.');
    const c = data as { id: string; client_id: string; term: '' | 'monthly' | 'yearly'; renews_on: string | null; status: string };
    if (c.status === '해지' || c.status === '만료') throw new UserError(`${c.status} 상태의 상품은 갱신 처리할 수 없어요.`);
    const seats: { id: string; renews_on: string | null; status: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: part, error: sErr } = await supabase
        .from(SW_SEATS_TABLE)
        .select('id, renews_on, status')
        .eq('contract_id', id)
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (sErr) throw sErr;
      seats.push(...((part ?? []) as typeof seats));
      if (!part || part.length < 1000) break;
    }
    const nextContract = nextRenewDate(c.renews_on, c.term, today);
    const seatUpdates = seats
      .filter((s) => s.renews_on && !['해지', '만료', '회수'].includes(s.status))
      .map((s) => ({ id: s.id, next: nextRenewDate(s.renews_on, c.term, today) }))
      .filter((s): s is { id: string; next: string } => s.next != null);
    if (!nextContract && seatUpdates.length === 0) {
      throw new UserError('갱신 날짜가 비어 있어요. 갱신일을 먼저 적어 주세요.');
    }
    if (nextContract) {
      const { error: uErr } = await supabase.from(SW_CONTRACTS_TABLE).update({ renews_on: nextContract, updated_by: by }).eq('id', id);
      if (uErr) throw uErr;
    }
    for (const s of seatUpdates) {
      const { error: uErr } = await supabase.from(SW_SEATS_TABLE).update({ renews_on: s.next, updated_by: by }).eq('id', s.id);
      if (uErr) throw uErr;
    }
    await addMatchedKeys(c.client_id);
    return { renewsOn: nextContract };
  });
}

// ---------- 좌석(비밀 칸 제외) ----------

export async function saveSwSeat(input: SwSeatInput, actor: string): Promise<ActionResult<{ id: string }>> {
  return runLocked(true, async () => {
    const by = cleanActor(actor);
    if (input.worksAssetId != null && !Number.isInteger(input.worksAssetId)) throw new UserError('임대 건 번호가 올바르지 않아요.');
    const fields = {
      user_name: text(input.userName, 100),
      dept: text(input.dept, 100),
      pc_asset_code: text(input.pcAssetCode, 50).replace(/\s+/g, '').toUpperCase(),
      mfa_note: text(input.mfaNote, 1000),
      works_asset_id: input.worksAssetId ?? null,
      works_seq: text(input.worksSeq, 50),
      installed_on: ymd(input.installedOn, '설치일'),
      purchased_on: ymd(input.purchasedOn, '구매일'),
      renews_on: ymd(input.renewsOn, '갱신일'),
      ends_on: ymd(input.endsOn, '종료일'),
      status: oneOf(input.status, SW_SEAT_STATUSES, '상태'),
      memo: text(input.memo, 4000),
    };
    const supabase = db();
    const { data: contract, error: cErr } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .select('id, client_id')
      .eq('id', input.contractId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contract) throw new UserError('계약 상품을 못 찾았어요. 목록을 다시 열어 주세요.');
    const clientId = (contract as { client_id: string }).client_id;
    let id = input.id;
    if (id) {
      const { data, error } = await supabase
        .from(SW_SEATS_TABLE)
        .update({ ...fields, updated_by: by })
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new UserError('좌석을 못 찾았어요. 목록을 다시 열어 주세요.');
    } else {
      const { data, error } = await supabase
        .from(SW_SEATS_TABLE)
        .insert({ ...fields, contract_id: input.contractId, source: 'app', created_by: by, updated_by: by })
        .select('id')
        .single();
      if (error) throw error;
      id = (data as { id: string }).id;
    }
    await addMatchedKeys(clientId);
    return { id: id as string };
  });
}

/** 빈 좌석 n개(미배정) 한꺼번에 — 최대 200 */
export async function addSwSeats(contractId: string, count: number, actor: string): Promise<ActionResult<{ ids: string[] }>> {
  return runLocked(true, async () => {
    const by = cleanActor(actor);
    if (!Number.isInteger(count) || count < 1 || count > 200) throw new UserError('한 번에 1~200개까지 추가할 수 있어요.');
    const supabase = db();
    const { data: contract, error: cErr } = await supabase
      .from(SW_CONTRACTS_TABLE)
      .select('id, client_id')
      .eq('id', contractId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contract) throw new UserError('계약 상품을 못 찾았어요. 목록을 다시 열어 주세요.');
    const rows = Array.from({ length: count }, () => ({
      contract_id: contractId,
      status: '미배정',
      source: 'app',
      created_by: by,
      updated_by: by,
    }));
    const { data, error } = await supabase.from(SW_SEATS_TABLE).insert(rows).select('id');
    if (error) throw error;
    await addMatchedKeys((contract as { client_id: string }).client_id);
    return { ids: ((data ?? []) as { id: string }[]).map((r) => r.id) };
  });
}
