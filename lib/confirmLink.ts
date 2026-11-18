import 'server-only';
import {
  allocateUnits,
  deliverySpecFromUnits,
  titleBody,
  type ConfirmBlock,
  type ConfirmDoc,
  type ConfirmUnit,
} from '@/lib/confirmSheet';
import { readConfirmDoc, readConfirmDocs, writeConfirmBlocks } from '@/lib/confirmSheetServer';
import { findAssetBriefs } from '@/lib/inventory/assetIndex';
import { parseEventTitle, type PrepUnit } from '@/lib/shipmentPrep';
import { CALENDAR_TABLE, createAdminClient } from '@/lib/supabase/server';

/**
 * 확인서 ↔ 출고 준비 리스트(캘린더 일정 + 완료 보고) 연결.
 * 영업이 같은 제목으로 확인서와 네이버 일정을 만들어서, 제목의 "IT/…" 이후가 같으면 같은 건으로 봅니다
 * (앞쪽 시간 문구·담당자 태그는 바뀔 수 있어서 뗌). 제목이 조금 달라도 거래처·품목이 같고 날짜가
 * 가까우면 같은 건으로 봅니다.
 */
export const CONFIRM_DOCS_TABLE = 'it_confirm_docs';
const REPORTS_TABLE = 'it_prep_reports';

export type CalEvent = { id: string; date: string; title: string };
export type LinkInfo = { eventId: string; date: string; title: string; unitCount: number; sentAt: string | null };

const norm = (s: string) => s.replace(/[\s★☆]/g, '').toLowerCase();
const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);

export function isSameJob(doc: Pick<ConfirmDoc, 'title' | 'company' | 'deliveryDate'>, ev: CalEvent): boolean {
  if (!doc.title) return false;
  if (titleBody(doc.title) === titleBody(ev.title)) return true;
  const a = parseEventTitle(doc.title);
  const b = parseEventTitle(ev.title);
  return (
    !!a.company &&
    norm(a.company) === norm(b.company) &&
    norm(a.items.join(',')) === norm(b.items.join(',')) &&
    !!doc.deliveryDate &&
    dayDiff(doc.deliveryDate, ev.date) <= 3
  );
}

function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 확인서들의 납품일 범위 ±14일 안 일정(제목에 IT 들어간 것만). */
export async function eventsAround(dates: string[]): Promise<CalEvent[]> {
  const ds = dates.filter(Boolean).sort();
  if (!ds.length) return [];
  const { data } = await createAdminClient()
    .from(CALENDAR_TABLE)
    .select('id,date,title')
    .gte('date', shift(ds[0], -14))
    .lte('date', shift(ds[ds.length - 1], 14))
    .ilike('title', '%IT%')
    .limit(2000);
  return (data ?? []) as CalEvent[];
}

export function findEventsFor(doc: ConfirmDoc, events: CalEvent[]): CalEvent[] {
  return events
    .filter((e) => isSameJob(doc, e))
    .sort((a, b) => dayDiff(a.date, doc.deliveryDate || a.date) - dayDiff(b.date, doc.deliveryDate || b.date));
}

/** 같은 제목 일정이 여러 개(다른 캘린더에 복사본 등)면 완료 보고가 있는 쪽 → 납품일 가까운 쪽 */
export function pickLinked(hits: CalEvent[], infos: Record<string, LinkInfo>): CalEvent | null {
  const score = (e: CalEvent) => ((infos[e.id]?.unitCount ?? 0) > 0 ? 2 : 0) + (infos[e.id]?.sentAt ? 1 : 0);
  return hits.reduce<CalEvent | null>((best, e) => (!best || score(e) > score(best) ? e : best), null);
}

export async function linkInfoFor(events: CalEvent[]): Promise<Record<string, LinkInfo>> {
  if (!events.length) return {};
  const { data } = await createAdminClient()
    .from(REPORTS_TABLE)
    .select('event_id,units,sent_at')
    .in('event_id', events.map((e) => e.id));
  const reps = new Map(((data ?? []) as { event_id: string; units: PrepUnit[]; sent_at: string | null }[]).map((r) => [r.event_id, r]));
  return Object.fromEntries(
    events.map((e) => {
      const r = reps.get(e.id);
      return [
        e.id,
        { eventId: e.id, date: e.date, title: e.title, unitCount: (r?.units ?? []).filter((u) => u.assetId?.trim()).length, sentAt: r?.sent_at ?? null },
      ];
    }),
  );
}

/** 자산번호로 IT재고 색인에서 제조사·사양·품목 보충(캐시라 빠름). 조립PC처럼 시리얼=자산번호면 시리얼은 비움. */
export async function enrichUnits(units: ConfirmUnit[], hint = ''): Promise<ConfirmUnit[]> {
  return Promise.all(
    units.map(async (u) => {
      const id = u.assetId.trim().toUpperCase();
      if (!id) return u;
      const b = (await findAssetBriefs(id, hint).catch(() => []))[0];
      const serialRaw = u.serial || b?.serialNo || '';
      return {
        ...u,
        assetId: id,
        serial: serialRaw.trim().toUpperCase() === id ? '' : serialRaw.trim(),
        brand: u.brand || b?.brand || '',
        model: u.model || (b ? [b.brand, b.model].filter(Boolean).join(' ') : ''),
        gubun: u.gubun || b?.gubun || '',
        spec: u.spec || b?.specLabel || '',
        category: u.category || b?.category || '',
      };
    }),
  );
}

/** 완료 보고 기기 → 확인서 기기 */
export function prepToConfirmUnits(units: PrepUnit[]): ConfirmUnit[] {
  return units
    .filter((u) => u.assetId?.trim())
    .map((u) => ({ assetId: u.assetId.trim().toUpperCase(), serial: u.serial ?? '', model: u.model, gubun: u.gubun, spec: u.spec, category: u.category }));
}

/**
 * 확인서 → 완료 보고. 보고의 자산번호가 확인서 것의 일부(또는 없음)면 확인서 기준으로 바꾸고,
 * 보고에 확인서에 없는 자산이 있으면(사람이 따로 넣은 것) 지우지 않고 빠진 것만 더합니다.
 */
export async function pushDocToPrep(doc: ConfirmDoc, eventId: string): Promise<number> {
  const units = doc.blocks.flatMap((b) => b.units).filter((u) => u.assetId.trim());
  if (!units.length) return 0;
  const supabase = createAdminClient();
  const { data: rep } = await supabase.from(REPORTS_TABLE).select('id,units').eq('event_id', eventId).maybeSingle();
  const cur = (((rep as { units?: PrepUnit[] } | null)?.units ?? []) as PrepUnit[]).filter((u) => u.assetId?.trim() || u.serial?.trim());
  const curIds = cur.map((u) => u.assetId.trim().toUpperCase()).filter(Boolean);
  const docIds = units.map((u) => u.assetId.trim().toUpperCase());
  const toPrep = (u: ConfirmUnit): PrepUnit => ({
    serial: u.serial,
    assetId: u.assetId.trim().toUpperCase(),
    grade: cur.find((c) => c.assetId.trim().toUpperCase() === u.assetId.trim().toUpperCase())?.grade ?? '',
    model: u.model ?? '',
    gubun: u.gubun ?? '',
    spec: u.spec ?? '',
    category: u.category,
  });
  const next = curIds.every((id) => docIds.includes(id))
    ? units.map(toPrep)
    : [...cur, ...units.filter((u) => !curIds.includes(u.assetId.trim().toUpperCase())).map(toPrep)];
  const same =
    next.length === cur.length && next.every((u, i) => u.assetId === cur[i].assetId && u.serial === cur[i].serial && (u.spec ?? '') === (cur[i].spec ?? ''));
  if (same) return 0;
  if (rep) {
    await supabase.from(REPORTS_TABLE).update({ units: next, updated_at: new Date().toISOString() }).eq('id', (rep as { id: string }).id);
  } else {
    await supabase.from(REPORTS_TABLE).insert({ event_id: eventId, company: doc.company, units: next });
  }
  return next.length;
}

/** 앱 사본 저장(it_confirm_docs). 표가 없으면(SQL 실행 전) 조용히 건너뛰고 false. */
export async function upsertAppDoc(
  doc: ConfirmDoc,
  opts: { appId?: string | null; eventId?: string | null; sheetWritten?: boolean },
): Promise<{ ok: boolean; id: string | null; error?: string }> {
  const supabase = createAdminClient();
  const row = {
    source_tab: doc.tab,
    title: doc.title,
    company: doc.company,
    delivery_date: doc.deliveryDate || null,
    doc,
    prep_event_id: opts.eventId ?? null,
    updated_at: new Date().toISOString(),
    ...(opts.sheetWritten ? { sheet_written_at: new Date().toISOString() } : {}),
  };
  let id = opts.appId ?? null;
  if (!id && doc.tab) {
    const { data, error } = await supabase.from(CONFIRM_DOCS_TABLE).select('id').eq('source_tab', doc.tab).maybeSingle();
    if (error) return { ok: false, id: null, error: error.message };
    id = (data as { id: string } | null)?.id ?? null;
  }
  const res = id
    ? await supabase.from(CONFIRM_DOCS_TABLE).update(row).eq('id', id).select('id').single()
    : await supabase.from(CONFIRM_DOCS_TABLE).insert(row).select('id').single();
  if (res.error) return { ok: false, id, error: res.error.message };
  return { ok: true, id: (res.data as { id: string }).id };
}

/**
 * 완료 보고 → 확인서(보고 저장 뒤 after()에서). 같은 건 확인서 탭을 찾아, 각 품목 묶음의 시트
 * 자산번호가 비었거나 보고 것의 일부일 때만 채웁니다 — 사람이 시트에 직접 다른 번호를 적어 둔
 * 묶음은 건드리지 않아요.
 */
export async function syncPrepToConfirm(eventId: string): Promise<string> {
  const supabase = createAdminClient();
  const [{ data: ev }, { data: rep }] = await Promise.all([
    supabase.from(CALENDAR_TABLE).select('id,date,title').eq('id', eventId).maybeSingle(),
    supabase.from(REPORTS_TABLE).select('units').eq('event_id', eventId).maybeSingle(),
  ]);
  if (!ev) return 'no-event';
  const prepUnits = prepToConfirmUnits(((rep as { units?: PrepUnit[] } | null)?.units ?? []) as PrepUnit[]);
  if (!prepUnits.length) return 'no-units';
  const docs = await readConfirmDocs();
  const listed = docs.find((d) => isSameJob(d, ev as CalEvent));
  if (!listed) return 'no-doc';
  const doc = await readConfirmDoc(listed.tab);
  if (!doc || !doc.blocks.length) return 'no-blocks';

  const hint = doc.blocks.map((b) => b.item).join(' ');
  const units = await enrichUnits(prepUnits, hint);
  const alloc = allocateUnits(doc.blocks, units);
  const changed: ConfirmBlock[] = [];
  doc.blocks.forEach((b, i) => {
    const sheetIds = b.units.map((u) => u.assetId.trim().toUpperCase()).filter(Boolean);
    const newIds = alloc[i].map((u) => u.assetId);
    if (!newIds.length) return;
    if (!sheetIds.every((id) => newIds.includes(id))) return; // 사람이 다른 번호를 적어 둠
    if (sheetIds.length === newIds.length && newIds.every((id) => sheetIds.includes(id))) return; // 이미 같음
    const brands = [...new Set(alloc[i].map((u) => u.brand).filter(Boolean))];
    changed.push({
      ...b,
      units: alloc[i],
      manufacturer: b.manufacturer || brands.join('/'),
      deliverySpec: deliverySpecFromUnits(alloc[i]) || b.deliverySpec,
    });
  });
  if (!changed.length) return 'unchanged';
  await writeConfirmBlocks(doc.tab, changed);
  const merged: ConfirmDoc = { ...doc, blocks: doc.blocks.map((b) => changed.find((c) => c.row === b.row) ?? b) };
  await upsertAppDoc(merged, { eventId, sheetWritten: true }).catch(() => null);
  return `written:${changed.length}`;
}
