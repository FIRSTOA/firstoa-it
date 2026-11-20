import 'server-only';
import { createHash } from 'node:crypto';
import { getSheetsClient } from '@/lib/googleAuth';
import {
  createAdminClient,
  CONTRACT_CLIENTS_TABLE,
  SW_CONTRACTS_TABLE,
  SW_SEATS_TABLE,
} from '@/lib/supabase/server';
import { nameKey, similarNames } from '@/lib/contracts/nameKey';
import { buildContractsOverview, ensureClient, createManualClientRow } from '@/lib/contracts/clients';
import { insertSecretsIfMissing, verifySecrets, logSecretEvent } from '@/lib/contracts/secrets';
import {
  parseSheets,
  summarizeGroups,
  countNames,
  countSecrets,
  contractSig,
  applyRowEdit,
  SheetHeaderError,
  type ParsedRow,
  type ParsedSheet,
  type ParsedTab,
  type SheetSecretField,
} from '@/lib/contracts/sheetParse';
import type {
  ImportGroup,
  ImportRowDetail,
  ImportPlan,
  ImportPreview,
  ImportResult,
  ImportTabResult,
  ImportCounts,
  SecretField,
} from '@/lib/contracts/types';

/**
 * 시트 → 앱 옮기기(한 번). 설계 §3-5. 시트 읽기는 batchGet 한 번(재시도 루프 없음).
 * 비밀 값은 이 파일에서 암호화 함수(secrets.ts)로만 넘기고, 응답·로그·에러 문구에는 싣지 않는다.
 */

const UNSORTED_NAME = '미분류(시트에서 옮김)';
const NO_PRODUCT = '(상품명 미입력)';

type Values = { renew: string[][]; perm: string[][] };
type Read = { ok: true; values: Values; fingerprint: string } | { ok: false; error: string };

function fingerprintOf(v: Values): string {
  return createHash('sha256').update(JSON.stringify([v.renew, v.perm])).digest('hex');
}

async function readSheet(): Promise<Read> {
  const id = process.env.GOOGLE_INVENTORY_SHEET_ID;
  if (!id) return { ok: false, error: '구글시트 설정(GOOGLE_INVENTORY_SHEET_ID)이 없어요.' };
  try {
    const res = await getSheetsClient().spreadsheets.values.batchGet({
      spreadsheetId: id,
      ranges: ["'SW자산_갱신형'!A1:Z", "'SW자산_비갱신형'!A1:AQ"],
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const vr = res.data.valueRanges ?? [];
    const norm = (x: unknown): string[][] => ((x as unknown[][] | undefined) ?? []).map((r) => r.map((c) => (c == null ? '' : String(c))));
    const values: Values = { renew: norm(vr[0]?.values), perm: norm(vr[1]?.values) };
    return { ok: true, values, fingerprint: fingerprintOf(values) };
  } catch (e) {
    const code = (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;
    if (code === 429) return { ok: false, error: '구글시트 읽기 한도에 걸렸어요. 1분 뒤에 다시 눌러 주세요.' };
    return { ok: false, error: '구글시트를 못 읽었어요. 잠시 뒤 다시 해 보세요.' };
  }
}

function parseOrError(values: Values): { ok: true; sheet: ParsedSheet } | { ok: false; error: string } {
  try {
    return { ok: true, sheet: parseSheets(values.renew, values.perm) };
  } catch (e) {
    if (e instanceof SheetHeaderError) return { ok: false, error: e.message };
    return { ok: false, error: '시트 모양을 읽지 못했어요.' };
  }
}

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  const m = (x?.message ?? '').toLowerCase();
  return x?.code === '42P01' || x?.code === 'PGRST205' || m.includes('does not exist') || m.includes('schema cache');
}
const MISSING_TABLE_MSG = '계약 관리 표가 아직 없어요 — supabase/contracts_schema.sql 을 먼저 실행해 주세요.';

async function readSeatKeys(): Promise<Map<string, string>> {
  const supabase = createAdminClient();
  const out = new Map<string, string>(); // source_key → id
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(SW_SEATS_TABLE)
      .select('id, source_key')
      .not('source_key', 'is', null)
      .order('source_key')
      .range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as { id: string; source_key: string }[]) out.set(r.source_key, r.id);
    if (!data || data.length < 1000) return out;
  }
}

function rowDetail(r: ParsedRow, done: boolean): ImportRowDetail {
  return {
    row: r.sheetRow,
    product: r.product,
    supplier: r.supplier,
    userName: r.seat.userName,
    dept: r.seat.dept,
    pcAssetCode: r.seat.pcAssetCode,
    mfaNote: r.seat.mfaNote,
    purchasedOn: r.seat.purchasedOn,
    renewsOn: r.seat.renewsOn,
    endsOn: r.seat.endsOn,
    dateRaw: r.dateRaw,
    secretFields: r.secrets.map((x) => x.field), // 칸 이름만(값 없음)
    alreadyImported: done,
  };
}

function emptyCounts(t: ParsedTab): ImportCounts {
  return { sheetRows: t.sheetRows, blankRows: t.blankRows, seats: t.sheetRows, secrets: countSecrets(t) };
}

// ── 미리보기(쓰기 없음) ─────────────────────────────────────
export async function previewImport(): Promise<{ ok: true; preview: ImportPreview } | { ok: false; error: string }> {
  const read = await readSheet();
  if (!read.ok) return read;
  const parsed = parseOrError(read.values);
  if (!parsed.ok) return parsed;
  const sheet = parsed.sheet;

  let seatKeys: Map<string, string>;
  try {
    seatKeys = await readSeatKeys();
  } catch (e) {
    return { ok: false, error: isMissingTable(e) ? MISSING_TABLE_MSG : '앱 표를 못 읽었어요.' };
  }

  const warnings: string[] = [];
  const cands: { key: string; name: string; nk: string }[] = [];
  try {
    const ov = await buildContractsOverview('sw');
    if (ov.source === 'none') warnings.push('거래처 목록(works)을 못 읽어 후보를 못 찾았어요. 아래에서 직접 고르거나 새 거래처로 만들 수 있어요.');
    for (const c of ov.clients) cands.push({ key: c.key, name: c.name, nk: nameKey(c.name) });
  } catch {
    warnings.push('거래처 목록을 못 읽어 후보를 못 찾았어요. 아래에서 직접 고르거나 새 거래처로 만들 수 있어요.');
  }

  const doneBy = new Map<string, number>();
  const detailBy = new Map<string, ImportRowDetail[]>();
  for (const t of [sheet.renew, sheet.perm]) {
    for (const r of t.rows) {
      const done = seatKeys.has(r.seatSourceKey);
      if (done) doneBy.set(r.groupKey, (doneBy.get(r.groupKey) ?? 0) + 1);
      const list = detailBy.get(r.groupKey) ?? [];
      list.push(rowDetail(r, done));
      detailBy.set(r.groupKey, list);
    }
  }

  const groups: ImportGroup[] = summarizeGroups(sheet).map((g) => {
    let match: ImportGroup['match'] = 'none';
    let candidates: { key: string; name: string }[] = [];
    if (g.sheetName) {
      const nk = nameKey(g.sheetName);
      const exact = cands.filter((c) => c.nk === nk);
      const similar = cands.filter((c) => c.nk !== nk && similarNames(g.sheetName, c.name));
      if (exact.length) match = 'exact';
      else if (similar.length) match = 'similar';
      candidates = [...exact, ...similar].slice(0, 5).map(({ key, name }) => ({ key, name }));
    }
    return {
      groupKey: g.groupKey,
      tab: g.tab,
      sheetName: g.sheetName,
      guessedBy: g.guessedBy,
      domainHint: g.domainHint,
      rows: g.rows,
      products: g.products,
      secretCounts: g.secretCounts as Partial<Record<SecretField, number>>,
      match,
      candidates,
      alreadyImported: doneBy.get(g.groupKey) ?? 0,
      rowsDetail: detailBy.get(g.groupKey) ?? [],
    };
  });

  if (sheet.renew.dateWarnings + sheet.perm.dateWarnings > 0) {
    warnings.push(`날짜를 못 읽은 칸이 ${sheet.renew.dateWarnings + sheet.perm.dateWarnings}곳 있어요(원문은 따로 보관돼요).`);
  }
  const noProduct = [...sheet.renew.rows, ...sheet.perm.rows].filter((r) => !r.product).length;
  if (noProduct) warnings.push(`상품명이 빈 줄이 ${noProduct}줄 있어요 — "${NO_PRODUCT}" 상품으로 들어가요.`);

  return {
    ok: true,
    preview: {
      fingerprint: read.fingerprint,
      groups,
      counts: { renew: emptyCounts(sheet.renew), perm: emptyCounts(sheet.perm) },
      productNames: countNames(sheet, 'product'),
      supplierNames: countNames(sheet, 'supplier'),
      warnings,
    },
  };
}

// ── 반영 ───────────────────────────────────────────────────
function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

function emptyTabResult(t: ParsedTab): ImportTabResult {
  return { sheetRows: t.sheetRows, seatsInserted: 0, seatsExisting: 0, secrets: {}, missing: [], skippedRows: 0 };
}

export async function applyImport(
  plan: ImportPlan,
  actor: string,
): Promise<{ ok: true; result: ImportResult } | { ok: false; error: string }> {
  const read = await readSheet();
  if (!read.ok) return read;
  if (read.fingerprint !== plan.fingerprint) return { ok: false, error: '시트가 바뀌었어요 — 미리보기를 다시 눌러 주세요.' };
  const parsed = parseOrError(read.values);
  if (!parsed.ok) return parsed;
  const sheet = parsed.sheet;
  const supabase = createAdminClient();

  // 빼기(묶음째·줄 하나씩) → 줄 수정. 뺀 줄은 좌석·비밀 모두 안 넣고 missing 에도 안 셈.
  const choiceOf = new Map(plan.choices.map((c) => [c.groupKey, c.target] as const));
  const excluded = new Set((plan.excludeRows ?? []).map((x) => `${x.tab}:${x.row}`));
  const editOf = new Map((plan.rowEdits ?? []).map((e) => [`${e.tab}:${e.row}`, e] as const));
  const skipped: Record<'renew' | 'perm', number> = { renew: 0, perm: 0 };
  const skippedGroupKeys = new Set<string>();
  let editWarnings = 0;
  const rowsAll: ParsedRow[] = [];
  for (const t of [sheet.renew, sheet.perm]) {
    for (const r0 of t.rows) {
      if (choiceOf.get(r0.groupKey) === 'skip') {
        skippedGroupKeys.add(r0.groupKey);
        skipped[r0.tab]++;
        continue;
      }
      if (excluded.has(`${r0.tab}:${r0.sheetRow}`)) {
        skipped[r0.tab]++;
        continue;
      }
      const e = editOf.get(`${r0.tab}:${r0.sheetRow}`);
      if (e) {
        const x = applyRowEdit(r0, e);
        editWarnings += x.warnings;
        rowsAll.push(x.row);
      } else rowsAll.push(r0);
    }
  }

  try {
    // 1. 거래처 정하기
    const existingClients = new Set<string>();
    {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(CONTRACT_CLIENTS_TABLE).select('id').order('id').range(from, from + 999);
        if (error) throw error;
        for (const r of (data ?? []) as { id: string }[]) existingClients.add(r.id);
        if (!data || data.length < 1000) break;
      }
    }
    const clientByGroup = new Map<string, string>();
    const resolvedByName = new Map<string, string>();
    const unsortedGroups = new Set<string>();
    const groupKeys = [...new Set(rowsAll.map((r) => r.groupKey))];

    const byNameKey = async (name: string): Promise<string> => {
      const nk = nameKey(name);
      const hit = resolvedByName.get(nk);
      if (hit) return hit;
      const { data, error } = await supabase.from(CONTRACT_CLIENTS_TABLE).select('id').eq('name_key', nk).limit(1);
      if (error) throw error;
      const id = (data as { id: string }[] | null)?.[0]?.id ?? (await createManualClientRow(name, actor));
      resolvedByName.set(nk, id);
      return id;
    };

    for (const gk of groupKeys) {
      const target = choiceOf.get(gk) ?? 'unsorted';
      if (target === 'skip') continue; // 위에서 이미 뺌
      if (target === 'unsorted') {
        unsortedGroups.add(gk);
        clientByGroup.set(gk, await byNameKey(UNSORTED_NAME));
      } else if ('newName' in target) {
        const nm = target.newName.trim();
        if (!nm) return { ok: false, error: '새 거래처 이름이 비어 있는 묶음이 있어요.' };
        clientByGroup.set(gk, await byNameKey(nm));
      } else {
        clientByGroup.set(gk, await ensureClient(target.clientKey, actor));
      }
    }
    const clientsCreated = new Set([...clientByGroup.values()].filter((id) => !existingClients.has(id))).size;

    // 거래처 담당·키맨은 비어 있을 때만 채움(앱에서 고친 것 안 덮음). 미분류 거래처는 건너뜀.
    {
      const fill = new Map<string, { salesOwner: string; itOwner: string; keyPerson: string; keyPhone: string }>();
      for (const r of rowsAll) {
        if (unsortedGroups.has(r.groupKey)) continue;
        const id = clientByGroup.get(r.groupKey)!;
        const f = fill.get(id) ?? { salesOwner: '', itOwner: '', keyPerson: '', keyPhone: '' };
        for (const k of ['salesOwner', 'itOwner', 'keyPerson', 'keyPhone'] as const) if (!f[k] && r.client[k]) f[k] = r.client[k];
        fill.set(id, f);
      }
      for (const [id, f] of fill) {
        const { data, error } = await supabase
          .from(CONTRACT_CLIENTS_TABLE)
          .select('sales_owner, it_owner, key_person, key_phone')
          .eq('id', id)
          .limit(1);
        if (error) throw error;
        const cur = (data as Record<string, string>[] | null)?.[0];
        if (!cur) continue;
        const patch: Record<string, string> = {};
        if (!cur.sales_owner && f.salesOwner) patch.sales_owner = f.salesOwner;
        if (!cur.it_owner && f.itOwner) patch.it_owner = f.itOwner;
        if (!cur.key_person && f.keyPerson) patch.key_person = f.keyPerson;
        if (!cur.key_phone && f.keyPhone) patch.key_phone = f.keyPhone;
        if (Object.keys(patch).length) {
          const { error: ue } = await supabase.from(CONTRACT_CLIENTS_TABLE).update({ ...patch, updated_by: actor }).eq('id', id);
          if (ue) throw ue;
        }
      }
    }

    // 2. 계약 상품 upsert
    // 줄 수정이 이름 정리표보다 우선
    const prodOf = (r: ParsedRow) => (r.edited?.product ? r.product : plan.productRenames[r.product] || r.product) || NO_PRODUCT;
    const supOf = (r: ParsedRow) => (r.edited?.supplier ? r.supplier : plan.supplierRenames[r.supplier] || r.supplier);
    const contractKeyOf = (r: ParsedRow) => `sheet:${clientByGroup.get(r.groupKey)}:${contractSig(prodOf(r), r.typeRaw, supOf(r))}`;
    const contractRows = new Map<string, Record<string, unknown>>();
    for (const r of rowsAll) {
      const key = contractKeyOf(r);
      const prev = contractRows.get(key);
      if (!prev) {
        contractRows.set(key, {
          client_id: clientByGroup.get(r.groupKey),
          product: prodOf(r),
          supplier: supOf(r),
          license_type: r.licenseType,
          term: r.term,
          pay_cycle: r.payCycle,
          license_type_raw: r.typeRaw,
          cost_note: r.contract.costNote,
          admin_portal: r.contract.adminPortal,
          setup_vendor: r.contract.setupVendor,
          status: '사용중',
          memo: '',
          source: r.tab === 'renew' ? 'sheet_renew' : 'sheet_perm',
          source_key: key,
          created_by: actor,
          updated_by: actor,
        });
      } else {
        if (!prev.cost_note && r.contract.costNote) prev.cost_note = r.contract.costNote;
        if (!prev.admin_portal && r.contract.adminPortal) prev.admin_portal = r.contract.adminPortal;
        if (!prev.setup_vendor && r.contract.setupVendor) prev.setup_vendor = r.contract.setupVendor;
      }
    }
    const contractIdByKey = new Map<string, string>();
    const readContractIds = async () => {
      const keys = [...contractRows.keys()];
      for (const part of chunk(keys, 40)) {
        const { data, error } = await supabase.from(SW_CONTRACTS_TABLE).select('id, source_key').in('source_key', part);
        if (error) throw error;
        for (const x of (data ?? []) as { id: string; source_key: string }[]) contractIdByKey.set(x.source_key, x.id);
      }
    };
    await readContractIds();
    const contractsBefore = contractIdByKey.size;
    const toInsert = [...contractRows.values()].filter((c) => !contractIdByKey.has(c.source_key as string));
    for (const part of chunk(toInsert, 100)) {
      const { error } = await supabase.from(SW_CONTRACTS_TABLE).upsert(part, { onConflict: 'source_key', ignoreDuplicates: true });
      if (error) throw error;
    }
    await readContractIds();
    const contractsCreated = Math.max(0, contractIdByKey.size - contractsBefore);

    // 3. 좌석 insert
    const seatKeysBefore = await readSeatKeys();
    const seatRows: Record<string, unknown>[] = [];
    const missingSeat = new Set<string>();
    for (const r of rowsAll) {
      if (seatKeysBefore.has(r.seatSourceKey)) continue;
      const contractId = contractIdByKey.get(contractKeyOf(r));
      if (!contractId) {
        missingSeat.add(r.seatSourceKey);
        continue;
      }
      seatRows.push({
        contract_id: contractId,
        user_name: r.seat.userName,
        dept: r.seat.dept,
        pc_asset_code: r.seat.pcAssetCode,
        mfa_note: r.seat.mfaNote,
        installed_on: r.seat.installedOn,
        purchased_on: r.seat.purchasedOn,
        renews_on: r.seat.renewsOn,
        ends_on: r.seat.endsOn,
        status: r.seat.status,
        memo: '',
        source: r.tab === 'renew' ? 'sheet_renew' : 'sheet_perm',
        source_key: r.seatSourceKey,
        source_raw: r.sourceRaw,
        created_by: actor,
        updated_by: actor,
      });
    }
    for (const part of chunk(seatRows, 100)) {
      const { error } = await supabase.from(SW_SEATS_TABLE).upsert(part, { onConflict: 'source_key', ignoreDuplicates: true });
      if (error) throw error;
    }
    const seatIds = await readSeatKeys();

    const results: Record<'renew' | 'perm', ImportTabResult> = { renew: emptyTabResult(sheet.renew), perm: emptyTabResult(sheet.perm) };
    // 4·5. 비밀 칸 암호화 저장 + 복호화 확인(탭·칸 종류별)
    type Item = { row: ParsedRow; seatId: string; plain: string };
    const buckets = new Map<string, { tab: 'renew' | 'perm'; field: SheetSecretField; items: Item[] }>();
    for (const r of rowsAll) {
      const res = results[r.tab];
      const seatId = seatIds.get(r.seatSourceKey);
      if (seatKeysBefore.has(r.seatSourceKey)) res.seatsExisting++;
      else if (seatId) res.seatsInserted++;
      if (!seatId) {
        res.missing.push({ row: r.sheetRow, field: 'seat' });
        for (const s of r.secrets) {
          res.secrets[s.field] ??= { sheet: 0, inserted: 0, existing: 0, verified: 0 };
          res.secrets[s.field]!.sheet++;
          res.missing.push({ row: r.sheetRow, field: s.field });
        }
        continue;
      }
      for (const s of r.secrets) {
        const bk = `${r.tab}:${s.field}`;
        const b = buckets.get(bk) ?? { tab: r.tab, field: s.field, items: [] };
        b.items.push({ row: r, seatId, plain: s.plain });
        buckets.set(bk, b);
      }
    }
    for (const b of buckets.values()) {
      const res = results[b.tab];
      const stat = (res.secrets[b.field] ??= { sheet: 0, inserted: 0, existing: 0, verified: 0 });
      stat.sheet += b.items.length;
      const rowOf = new Map(b.items.map((i) => [i.seatId, i.row.sheetRow] as const));
      try {
        const ins = await insertSecretsIfMissing(
          b.items.map((i) => ({ seatId: i.seatId, field: b.field, plain: i.plain })),
          actor,
        );
        stat.inserted += ins.inserted;
        stat.existing += ins.existing;
        const ver = await verifySecrets(b.items.map((i) => ({ seatId: i.seatId, field: b.field, plain: i.plain })));
        stat.verified += ver.verified;
        for (const m of ver.mismatched) {
          const row = rowOf.get(m.seatId);
          if (row) res.missing.push({ row, field: b.field });
        }
      } catch {
        // 값 없이 위치만 — 이 묶음 전체를 빠진 것으로 표시
        for (const i of b.items) res.missing.push({ row: i.row.sheetRow, field: b.field });
      }
    }

    results.renew.skippedRows = skipped.renew;
    results.perm.skippedRows = skipped.perm;

    // 6. 기록(값 없이 개수만)
    const secretTotal = [results.renew, results.perm].reduce(
      (n, t) => n + Object.values(t.secrets).reduce((m, s) => m + (s?.inserted ?? 0), 0),
      0,
    );
    await logSecretEvent({
      action: 'import',
      actor,
      count: secretTotal,
      note: `좌석 ${results.renew.seatsInserted + results.perm.seatsInserted}개 · 거래처 ${clientsCreated}곳 · 상품 ${contractsCreated}개 새로 · 뺀 줄 ${skipped.renew + skipped.perm}${editWarnings ? ` · 줄 수정 날짜 모양 오류 ${editWarnings}칸(시트 값 유지)` : ''}`,
    });

    return {
      ok: true,
      result: { clientsCreated, contractsCreated, unsortedGroups: unsortedGroups.size, skippedGroups: skippedGroupKeys.size, renew: results.renew, perm: results.perm },
    };
  } catch (e) {
    if (isMissingTable(e)) return { ok: false, error: MISSING_TABLE_MSG };
    const msg = (e as { message?: string } | null)?.message;
    return { ok: false, error: `옮기는 도중 멈췄어요(다시 눌러도 중복되지 않아요): ${(msg ?? '알 수 없는 오류').slice(0, 120)}` };
  }
}
