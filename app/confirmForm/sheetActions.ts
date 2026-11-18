'use server';

import {
  filledCount,
  isItConfirm,
  parseConfirmGrid,
  titleBody,
  type ConfirmDoc,
  type ConfirmUnit,
} from '@/lib/confirmSheet';
import {
  CONFIRM_DOCS_TABLE,
  enrichUnits,
  eventsAround,
  findEventsFor,
  linkInfoFor,
  pickLinked,
  prepToConfirmUnits,
  pushDocToPrep,
  upsertAppDoc,
  type LinkInfo,
} from '@/lib/confirmLink';
import {
  CONFIRM_SHEET_URL,
  readConfirmDoc,
  readConfirmDocs,
  readPrintGrid,
  writeConfirmBlocks,
  type PrintGrid,
} from '@/lib/confirmSheetServer';
import type { PrepUnit } from '@/lib/shipmentPrep';
import { createAdminClient } from '@/lib/supabase/server';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type ConfirmListItem = {
  /** 시트 탭이면 'tab:<이름>', 앱에만 있으면 'app:<id>' */
  key: string;
  tab: string;
  appId: string | null;
  title: string;
  company: string;
  deliveryDate: string;
  formNo: string;
  isIt: boolean;
  items: string;
  filled: number;
  total: number;
  link: LinkInfo | null;
  savedAt: string | null;
  sheetWrittenAt: string | null;
};

type AppRow = {
  id: string;
  source_tab: string;
  title: string;
  company: string;
  delivery_date: string | null;
  doc: ConfirmDoc;
  prep_event_id: string | null;
  sheet_written_at: string | null;
  updated_at: string;
};

async function readAppRows(): Promise<{ rows: AppRow[]; ready: boolean }> {
  const { data, error } = await createAdminClient()
    .from(CONFIRM_DOCS_TABLE)
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(300);
  if (error) return { rows: [], ready: false };
  return { rows: (data ?? []) as AppRow[], ready: true };
}

/** 확인서 목록 — 시트 탭 전부 + 붙여넣기로만 저장한 앱 문서, 출고 준비 연결 상태 포함. */
export async function listConfirmDocs(): Promise<Result<{ items: ConfirmListItem[]; appReady: boolean; sheetUrl: string }>> {
  try {
    const [docs, app] = await Promise.all([readConfirmDocs(), readAppRows()]);
    const byTab = new Map(app.rows.filter((r) => r.source_tab).map((r) => [r.source_tab, r]));
    const all: { doc: ConfirmDoc; row: AppRow | null }[] = [
      ...docs.map((d) => ({ doc: d, row: byTab.get(d.tab) ?? null })),
      ...app.rows.filter((r) => !r.source_tab).map((r) => ({ doc: { ...r.doc, tab: '' }, row: r })),
    ];
    const events = await eventsAround(all.map((x) => x.doc.deliveryDate));
    const hits = all.map((x) => findEventsFor(x.doc, events));
    const infos = await linkInfoFor([...new Map(hits.flat().map((e) => [e.id, e])).values()]);
    const matched = hits.map((h) => pickLinked(h, infos));
    const items: ConfirmListItem[] = all.map(({ doc, row }, i) => {
      const { filled, total } = filledCount(doc);
      const ev = matched[i];
      return {
        key: doc.tab ? `tab:${doc.tab}` : `app:${row?.id}`,
        tab: doc.tab,
        appId: row?.id ?? null,
        title: doc.title,
        company: doc.company,
        deliveryDate: doc.deliveryDate,
        formNo: doc.formNo,
        isIt: isItConfirm(doc),
        items: doc.blocks.map((b) => `${b.item}${b.quantity ? ` ${b.quantity}대` : ''}`).join(', '),
        filled,
        total,
        link: ev ? infos[ev.id] ?? null : null,
        savedAt: row?.updated_at ?? null,
        sheetWrittenAt: row?.sheet_written_at ?? null,
      };
    });
    items.sort((a, b) => (b.deliveryDate || '').localeCompare(a.deliveryDate || '') || a.company.localeCompare(b.company));
    return { ok: true, items, appReady: app.ready, sheetUrl: CONFIRM_SHEET_URL };
  } catch (err) {
    return { ok: false, error: `확인서 목록을 못 읽었어요: ${errMsg(err)}` };
  }
}

export type OpenedConfirm = {
  doc: ConfirmDoc;
  appId: string | null;
  link: LinkInfo | null;
  /** 연결된 완료 보고의 기기(IT재고 정보 보충) — "완료 보고 자산 채우기"용 */
  linkedUnits: ConfirmUnit[];
};

async function withLink(raw: ConfirmDoc, appId: string | null): Promise<OpenedConfirm> {
  // 시트엔 대수별 사양이 없어서 IT재고 색인(캐시)으로 사양·제조사를 보충해서 보여줌
  const doc: ConfirmDoc = {
    ...raw,
    blocks: await Promise.all(raw.blocks.map(async (b) => ({ ...b, units: await enrichUnits(b.units, b.item) }))),
  };
  const events = await eventsAround([doc.deliveryDate || new Date().toISOString().slice(0, 10)]);
  const hits = findEventsFor(doc, events);
  const infos = await linkInfoFor(hits);
  const ev = pickLinked(hits, infos);
  if (!ev) return { doc, appId, link: null, linkedUnits: [] };
  const info = infos[ev.id] ?? null;
  const { data: rep } = await createAdminClient().from('it_prep_reports').select('units').eq('event_id', ev.id).maybeSingle();
  const units = prepToConfirmUnits(((rep as { units?: PrepUnit[] } | null)?.units ?? []) as PrepUnit[]);
  const linkedUnits = units.length ? await enrichUnits(units, doc.blocks.map((b) => b.item).join(' '), true) : [];
  return { doc, appId, link: info, linkedUnits };
}

/** 확인서 열기 — 시트 탭은 최신 값을 다시 읽고, 앱 문서는 저장본을. */
export async function openConfirmDoc(key: string): Promise<Result<OpenedConfirm>> {
  try {
    if (key.startsWith('tab:')) {
      const tab = key.slice(4);
      const doc = await readConfirmDoc(tab);
      if (!doc) return { ok: false, error: `"${tab}" 탭을 확인서로 읽지 못했어요.` };
      const { data } = await createAdminClient().from(CONFIRM_DOCS_TABLE).select('id').eq('source_tab', tab).maybeSingle();
      return { ok: true, ...(await withLink(doc, (data as { id: string } | null)?.id ?? null)) };
    }
    const id = key.slice(4);
    const { data, error } = await createAdminClient().from(CONFIRM_DOCS_TABLE).select('*').eq('id', id).single();
    if (error || !data) return { ok: false, error: error?.message ?? '저장된 확인서를 못 찾았어요.' };
    return { ok: true, ...(await withLink((data as AppRow).doc, id)) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * 붙여넣은 확인서(시트에서 복사한 표 = 칸 배열) 읽기. 제목이 같은 시트 탭이 있으면 그 탭으로
 * 열어서 시트에도 기재할 수 있게 합니다.
 */
export async function parsePastedConfirm(grid: string[][]): Promise<Result<{ key: string | null; opened: OpenedConfirm | null }>> {
  const doc = parseConfirmGrid(grid, '');
  if (!doc) return { ok: false, error: '확인서 양식으로 못 읽었어요. 시트에서 확인서 전체(A열~H열)를 복사해서 붙여넣어 주세요.' };
  try {
    const docs = await readConfirmDocs();
    const same = doc.title ? docs.find((d) => titleBody(d.title) === titleBody(doc.title)) : undefined;
    if (same) return { ok: true, key: `tab:${same.tab}`, opened: null };
  } catch {
    // 시트를 못 읽어도 붙여넣은 내용으로는 열 수 있게
  }
  return { ok: true, key: null, opened: await withLink(doc, null) };
}

/** 사진 인식(OCR) 결과로 간단한 확인서 만들기 — 품목마다 한 묶음. */
export async function confirmFromOcr(fields: {
  companyName: string;
  date: string;
  items: { category: string; model: string; serialNumber: string; assetId: string }[];
}): Promise<Result<{ opened: OpenedConfirm }>> {
  const doc: ConfirmDoc = {
    tab: '',
    title: '',
    formNo: '',
    company: fields.companyName,
    orderDate: '',
    deliveryDate: fields.date,
    deliveryDateText: fields.date,
    department: '',
    salesManager: '',
    address: '',
    consumables: '',
    prices: [],
    blocks: fields.items.map((it, i) => ({
      row: 0 - i,
      item: it.model || it.category,
      quantity: 1,
      request: '',
      requestHardware: '',
      manufacturer: '',
      units: [{ assetId: it.assetId, serial: it.serialNumber }],
      deliverySpec: '',
    })),
    grid: [],
  };
  return { ok: true, opened: await withLink(doc, null) };
}

/**
 * 저장 — writeSheet면 시트 탭의 출고시(기재사항) 칸에 쓰고, 앱 사본(it_confirm_docs)을 저장하고,
 * 같은 건 출고 준비 완료 보고에도 기기를 채웁니다.
 */
export async function saveConfirmDoc(
  doc: ConfirmDoc,
  opts: { appId: string | null; writeSheet: boolean; eventId: string | null },
): Promise<Result<{ appId: string | null; warnings: string[]; pushed: number }>> {
  const warnings: string[] = [];
  try {
    const hint = doc.blocks.map((b) => b.item).join(' ');
    const blocks = await Promise.all(
      doc.blocks.map(async (b) => ({
        ...b,
        units: await enrichUnits(
          b.units.filter((u) => u.assetId.trim() || u.serial.trim()),
          `${b.item} ${hint}`,
        ),
      })),
    );
    const clean: ConfirmDoc = { ...doc, blocks };
    if (opts.writeSheet && doc.tab) await writeConfirmBlocks(doc.tab, blocks.filter((b) => b.row > 0));

    const saved = await upsertAppDoc(clean, { appId: opts.appId, eventId: opts.eventId, sheetWritten: opts.writeSheet && !!doc.tab });
    if (!saved.ok) {
      warnings.push(
        /it_confirm_docs/.test(saved.error ?? '')
          ? '앱 저장은 supabase/confirm_docs_schema.sql 실행 후에 돼요(시트 기재는 됐어요).'
          : `앱 저장 실패: ${saved.error}`,
      );
    }
    let pushed = 0;
    if (opts.eventId) {
      pushed = await pushDocToPrep(clean, opts.eventId).catch((e) => {
        warnings.push(`출고 준비 완료 보고 채우기 실패: ${errMsg(e)}`);
        return 0;
      });
    }
    return { ok: true, appId: saved.id, warnings, pushed };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** 자산번호 여러 개를 한 번에 IT재고 정보로 채우기(요청사항의 번호 넣기 등). */
export async function enrichConfirmUnits(units: ConfirmUnit[], hint: string): Promise<ConfirmUnit[]> {
  return enrichUnits(units, hint);
}

export async function deleteAppConfirmDoc(appId: string): Promise<Result> {
  const { error } = await createAdminClient().from(CONFIRM_DOCS_TABLE).delete().eq('id', appId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function getConfirmPrintGrid(tab: string): Promise<Result<{ grid: PrintGrid }>> {
  try {
    return { ok: true, grid: await readPrintGrid(tab) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}
