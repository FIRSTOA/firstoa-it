'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { syncPrepToConfirm } from '@/lib/confirmLink';
import { findAssetBriefs } from '@/lib/inventory/assetIndex';
import { getAssetFromSheets, updateAssetInSheet } from '@/lib/inventory/sheets';
import { logAssetMovement } from '@/lib/inventory/movements';
import { extractSaleInfoFromImage, isOcrConfigured } from '@/lib/ocr';
import {
  buildPrepMessage,
  eventKindOf,
  isMissingStockIssuesColumn,
  KAKAO_ROOM,
  stockTargetIds,
  type PrepPhoto,
  type PrepReport,
  type PrepStockIssue,
  type PrepStockIssues,
  type PrepUnit,
} from '@/lib/shipmentPrep';
import { CALENDAR_TABLE, createAdminClient, RENTAL_TABLE } from '@/lib/supabase/server';
import { sheetFailReason } from '@/lib/syncFailure';

const REPORTS_TABLE = 'it_prep_reports';
const PHOTO_ITEMS_TABLE = 'it_prep_photo_items';
const BUCKET = 'prep-photos';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type ReportRow = {
  id: string; event_id: string; company: string; model: string; author: string; units: PrepUnit[];
  photos: PrepPhoto[]; checked_items: string[]; note: string; message: string; sent_at: string | null;
  stock_applied: string[];
  /** SQL(shipment_prep_schema.sql 맨 끝) 실행 전이면 select('*') 결과에 없음 */
  stock_issues?: PrepStockIssues | null;
  updated_at?: string | null;
};

function toReport(r: ReportRow): PrepReport {
  return {
    id: r.id,
    eventId: r.event_id,
    company: r.company,
    model: r.model,
    author: r.author,
    units: r.units ?? [],
    photos: r.photos ?? [],
    checkedItems: r.checked_items ?? [],
    note: r.note,
    message: r.message,
    sentAt: r.sent_at,
    stockApplied: r.stock_applied ?? [],
    stockIssues: r.stock_issues ?? {},
    updatedAt: r.updated_at ?? null,
  };
}

async function ensureReport(eventId: string): Promise<ReportRow> {
  const supabase = createAdminClient();
  const { data } = await supabase.from(REPORTS_TABLE).select('*').eq('event_id', eventId).maybeSingle();
  if (data) return data as ReportRow;
  const { data: created, error } = await supabase.from(REPORTS_TABLE).insert({ event_id: eventId }).select('*').single();
  if (error) throw new Error(error.message);
  return created as ReportRow;
}

export type CheckItem = { label: string; grp: string };

export async function getPrepReport(eventId: string): Promise<Result<{ report: PrepReport | null; photoItems: CheckItem[] }>> {
  const supabase = createAdminClient();
  const [rep, items] = await Promise.all([
    supabase.from(REPORTS_TABLE).select('*').eq('event_id', eventId).maybeSingle(),
    supabase
      .from(PHOTO_ITEMS_TABLE)
      .select('label,grp')
      .order('sort_order')
      .order('created_at')
      .then(async (r) =>
        // shipment_prep_checklist.sql 실행 전이면 grp 칸이 없어요 — 묶음 없이 읽기
        r.error ? await supabase.from(PHOTO_ITEMS_TABLE).select('label').order('sort_order').order('created_at') : r,
      ),
  ]);
  if (rep.error) return { ok: false, error: /it_prep_reports/.test(rep.error.message) ? 'supabase/shipment_prep_schema.sql 을 먼저 실행해주세요.' : rep.error.message };
  return {
    ok: true,
    report: rep.data ? toReport(rep.data as ReportRow) : null,
    photoItems: ((items.data ?? []) as { label: string; grp?: string }[]).map((i) => ({ label: i.label, grp: i.grp || '기타' })),
  };
}

export type ReportDraft = {
  company: string;
  model: string;
  author: string;
  units: PrepUnit[];
  checkedItems: string[];
  note: string;
};

export async function savePrepReport(eventId: string, draft: ReportDraft): Promise<Result> {
  try {
    await ensureReport(eventId);
    const { error } = await createAdminClient()
      .from(REPORTS_TABLE)
      .update({
        company: draft.company.trim(),
        model: draft.model.trim(),
        author: draft.author.trim(),
        units: draft.units.map((u) => ({
          serial: u.serial.trim(),
          assetId: u.assetId.trim().toUpperCase(),
          grade: u.grade,
          model: (u.model ?? '').trim(),
          gubun: (u.gubun ?? '').trim(),
          spec: (u.spec ?? '').trim(),
        })),
        checked_items: draft.checkedItems,
        note: draft.note,
        updated_at: new Date().toISOString(),
      })
      .eq('event_id', eventId);
    if (error) return { ok: false, error: error.message };
    // 같은 건 확인서(확인서리스트 시트 탭)의 출고시 기재 칸도 채움 — 응답 뒤에
    after(() =>
      syncPrepToConfirm(eventId)
        .then((r) => r.startsWith('written') && console.log('[prep→확인서]', eventId, r))
        .catch((e) => console.error('[prep→확인서] 실패:', eventId, e)),
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── 사진 ─────────────────────────────────────────────────────

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const supabase = createAdminClient();
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) throw new Error(`사진 저장소 생성 실패: ${error.message}`);
  }
  bucketReady = true;
}

/** 리사이즈된 사진(base64 JPEG)을 올리고 보고에 추가합니다. */
export async function uploadPrepPhoto(eventId: string, base64: string, mediaType: string): Promise<Result<{ photo: PrepPhoto }>> {
  try {
    await ensureBucket();
    const report = await ensureReport(eventId);
    const supabase = createAdminClient();
    const path = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(base64, 'base64'), { contentType: mediaType, upsert: false });
    if (error) return { ok: false, error: `사진 업로드 실패: ${error.message}` };
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const photo: PrepPhoto = { path, url, at: new Date().toISOString() };
    // 동시에 여러 장 올려도 서로 덮어쓰지 않게 최신 목록을 다시 읽고 붙입니다.
    const { data: fresh } = await supabase.from(REPORTS_TABLE).select('photos').eq('id', report.id).single();
    const photos = [...(((fresh as { photos: PrepPhoto[] } | null)?.photos ?? []) as PrepPhoto[]), photo];
    await supabase.from(REPORTS_TABLE).update({ photos, updated_at: new Date().toISOString() }).eq('id', report.id);
    return { ok: true, photo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 저장소에만 올림(DB 안 건드림) — 여러 장을 동시에 올릴 수 있게. 목록 저장은 appendPrepPhotos 한 번. */
export async function storePrepPhotoFile(eventId: string, base64: string, mediaType: string): Promise<Result<{ photo: PrepPhoto }>> {
  try {
    await ensureBucket();
    const supabase = createAdminClient();
    const path = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(base64, 'base64'), { contentType: mediaType, upsert: false });
    if (error) return { ok: false, error: `사진 업로드 실패: ${error.message}` };
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return { ok: true, photo: { path, url, at: new Date().toISOString() } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 올린 사진들을 보고서 목록에 한 번에 추가(최신 목록에 이어 붙임). */
export async function appendPrepPhotos(eventId: string, added: PrepPhoto[]): Promise<Result<{ photos: PrepPhoto[] }>> {
  const report = await ensureReport(eventId);
  const supabase = createAdminClient();
  const { data: fresh } = await supabase.from(REPORTS_TABLE).select('photos').eq('id', report.id).single();
  const cur = (((fresh as { photos: PrepPhoto[] } | null)?.photos ?? []) as PrepPhoto[]);
  const known = new Set(cur.map((p) => p.path));
  const photos = [...cur, ...added.filter((p) => !known.has(p.path))];
  const { error } = await supabase.from(REPORTS_TABLE).update({ photos, updated_at: new Date().toISOString() }).eq('id', report.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, photos };
}

export async function deletePrepPhotos(eventId: string, paths: string[]): Promise<Result<{ photos: PrepPhoto[] }>> {
  const supabase = createAdminClient();
  const report = await ensureReport(eventId);
  const remove = new Set(paths);
  const photos = (report.photos ?? []).filter((p) => !remove.has(p.path));
  await supabase.storage.from(BUCKET).remove(paths).catch(() => null);
  const { error } = await supabase.from(REPORTS_TABLE).update({ photos }).eq('id', report.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, photos };
}

/** 사진에서 시리얼·자산번호 읽기(Claude Vision). */
export async function ocrPrepPhoto(base64: string, mediaType: string): Promise<Result<{ serial: string; assetId: string; model: string }>> {
  if (!isOcrConfigured()) return { ok: false, error: 'OCR 키(ANTHROPIC_API_KEY)가 설정되지 않았어요.' };
  try {
    const r = await extractSaleInfoFromImage(base64, mediaType);
    return { ok: true, serial: r.serialNumber, assetId: r.assetId.toUpperCase(), model: r.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type UnitLookup = {
  serials: string[];
  /** 제조사(예: 삼성, 조립PC, MSI) */
  brand?: string;
  model: string;
  gubun: string;
  spec: string;
  category: string;
  source: 'inventory' | 'rental' | '';
  /** 같은 자산번호가 다른 탭에도 있으면 그 품목들(예: ['모니터']) */
  duplicates?: string[];
};

/**
 * 자산번호 → 시리얼·모델명·구분값·스펙. IT재고(구글시트)가 구분값/스펙까지 있어 우선,
 * 없으면 임대리스트(firstoa-works 사본)의 모델명·시리얼·옵션.
 */
export async function lookupUnitByAsset(assetId: string, hint = ''): Promise<UnitLookup> {
  const key = assetId.trim().toUpperCase();
  const empty: UnitLookup = { serials: [], model: '', gubun: '', spec: '', category: '', source: '' };
  if (!/^[A-Z0-9._-]{2,}$/.test(key)) return empty;
  // 공유 캐시 색인 먼저(시트 읽기 한도 회피), 실패하면 단건 조회.
  const briefs = await findAssetBriefs(key, hint).catch(() => []);
  const brief =
    briefs[0] ??
    (await getAssetFromSheets(key)
      .then((a) =>
        a ? { serialNo: a.serialNo, brand: a.brand, model: a.model, specLabel: a.specLabel ?? '', gubun: a.gubunCode || '', category: a.category } : null,
      )
      .catch(() => null));
  if (brief) {
    const { data: rental } = await createAdminClient().from(RENTAL_TABLE).select('serial_number').eq('asset_code', key).limit(20);
    const rentalSerials = ((rental ?? []) as { serial_number: string | null }[]).map((r) => (r.serial_number ?? '').trim());
    // IT재고 시트 시리얼을 맨 앞에(자동 입력), 임대리스트 시리얼은 후보로.
    const serials = [...new Set([brief.serialNo, ...rentalSerials].map((x) => (x ?? '').trim()).filter(Boolean))];
    return {
      serials,
      brand: brief.brand,
      model: [brief.brand, brief.model].filter(Boolean).join(' '),
      gubun: brief.gubun,
      spec: brief.specLabel,
      category: brief.category,
      source: 'inventory',
      duplicates: briefs.slice(1).map((b) => `${b.category}(${[b.brand, b.model].filter(Boolean).join(' ')})`),
    };
  }
  const { data } = await createAdminClient()
    .from(RENTAL_TABLE)
    .select('serial_number,model_name,manufacturer,option1,option2,option3,option4,contract_date')
    .eq('asset_code', key)
    .order('contract_date', { ascending: false })
    .limit(50);
  const rows = (data ?? []) as Record<string, string | null>[];
  if (!rows.length) return empty;
  const r = rows[0];
  return {
    serials: [...new Set(rows.map((x) => (x.serial_number ?? '').trim()).filter(Boolean))],
    brand: (r.manufacturer ?? '').trim(),
    model: [r.manufacturer, r.model_name].map((v) => (v ?? '').trim()).filter(Boolean).join(' '),
    gubun: '',
    spec: (() => {
      // 임대리스트 옵션 → IT재고 사양과 같은 "I7/12/16/512/X/4050" 형식
      const cpu = (r.option1 ?? '').trim().replace(/[-\s]+/g, '/');
      const parts = (r.option2 ?? '').split('/').map((v) => v.trim().replace(/\s*(GB|G|TB|T)$/i, ''));
      return [cpu, ...parts, (r.option3 ?? '').trim()].filter(Boolean).join('/');
    })(),
    category: /데스크|desktop/i.test(`${r.model_name}`) ? '데스크탑' : '',
    source: 'rental',
  };
}

/** 자산번호 → 시리얼 후보(임대리스트 = firstoa-works 사본, 없으면 IT재고). */
export async function lookupSerialsByAsset(assetId: string): Promise<string[]> {
  const key = assetId.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{2,}$/.test(key)) return [];
  const { data } = await createAdminClient().from(RENTAL_TABLE).select('serial_number').eq('asset_code', key).limit(50);
  const serials = [...new Set(((data ?? []) as { serial_number: string }[]).map((r) => (r.serial_number ?? '').trim()).filter(Boolean))];
  if (serials.length) return serials;
  const asset = await getAssetFromSheets(key).catch(() => null);
  return asset?.serialNo ? [asset.serialNo] : [];
}

// ── 사진 체크리스트 항목 ─────────────────────────────────────

export async function addPhotoItem(label: string, grp = '기타'): Promise<Result> {
  const l = label.trim();
  if (!l) return { ok: false, error: '항목 이름을 입력해주세요.' };
  const supabase = createAdminClient();
  const { count } = await supabase.from(PHOTO_ITEMS_TABLE).select('label', { count: 'exact', head: true });
  const base = grp === '데스크탑&노트북' ? 100 : grp === '모니터' ? 200 : 300;
  let { error } = await supabase.from(PHOTO_ITEMS_TABLE).upsert({ label: l, grp, sort_order: base + 50 + (count ?? 0) }, { onConflict: 'label' });
  if (error && /grp/.test(error.message)) {
    ({ error } = await supabase.from(PHOTO_ITEMS_TABLE).upsert({ label: l, sort_order: (count ?? 0) + 1 }, { onConflict: 'label' }));
  }
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deletePhotoItem(label: string): Promise<Result> {
  const { error } = await createAdminClient().from(PHOTO_ITEMS_TABLE).delete().eq('label', label);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── 완료 · 카톡 발송 ─────────────────────────────────────────

const MESSENGER_URL = process.env.MESSENGER_SUPABASE_URL || 'https://kkdiihazgzesbqxjytqv.supabase.co';

/** 메신저 Supabase outbox 에 { room, text } 1행 → 카톡봇이 polling 해서 그 방으로 보냄. */
async function enqueueOutbox(room: string, text: string) {
  const key = process.env.MESSENGER_SUPABASE_ANON_KEY;
  if (!key) throw new Error('카톡 발송 설정(MESSENGER_SUPABASE_ANON_KEY)이 없어요.');
  const res = await fetch(`${MESSENGER_URL}/rest/v1/outbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
    body: JSON.stringify({ room, text }),
  });
  if (!res.ok) throw new Error(`카톡 발송 요청 실패(${res.status}): ${(await res.text().catch(() => '')).slice(0, 160)}`);
}

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'firstoa-it.vercel.app';
  const proto = h.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

/**
 * 완료 보고 저장 → 카톡 문구 생성 → outbox 발송 → (납품·교체) IT재고 위치를 '임대중'으로 바꾸고
 * 비고에 "yy.mm.dd 업체명" 이력 추가. 다시 보내면 이미 바꾼 자산번호는 건너뜁니다.
 */
export async function sendPrepReport(
  eventId: string,
  draft: ReportDraft,
  photoItemCount: number,
  /** send = 처음 발송, resend = "[수정]" 붙여 다시 발송, fix = 고치기만(카톡 안 보냄) */
  mode: 'send' | 'resend' | 'fix' = 'send',
): Promise<Result<{ message: string; stockPending: number }>> {
  const saved = await savePrepReport(eventId, draft);
  if (!saved.ok) return saved;
  const supabase = createAdminClient();
  const report = await ensureReport(eventId);
  const { data: ev } = await supabase.from(CALENDAR_TABLE).select('date,title').eq('id', eventId).single();
  const evRow = ev as { date: string; title: string };
  const kind = eventKindOf(evRow.title);
  const albumUrl = `${await siteOrigin()}/album?id=${report.id}`;
  const units = (report.units ?? []).filter((u) => u.serial || u.assetId);
  const built = buildPrepMessage({
    date: evRow.date,
    kind,
    company: report.company,
    model: report.model,
    units,
    checked: (report.checked_items ?? []).length,
    totalItems: photoItemCount,
    author: report.author,
    photoCount: (report.photos ?? []).length,
    albumUrl,
    note: report.note,
  });
  const message = mode === 'resend' ? `[수정] ${built}` : built;

  if (mode !== 'fix') {
    try {
      await enqueueOutbox(KAKAO_ROOM, message);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 보고 저장은 바로 — 응답을 빨리 돌려줘서 창이 닫히게.
  await supabase
    .from(REPORTS_TABLE)
    .update({ message, ...(mode === 'fix' ? {} : { sent_at: new Date().toISOString() }), updated_at: new Date().toISOString() })
    .eq('id', report.id);

  // 재고 위치 변경(철수 제외)은 응답 뒤에 따로 — 여러 대를 구글시트에 한 대씩 쓰면 1분을 넘겨
  // 창이 "처리 중"에서 멈췄어요. 이미 바꾼 자산번호는 stock_applied로 건너뜀.
  // 결과(반영됨 / IT재고에 없음 / 실패)는 한 대씩 보고 행에 적고, 완료 보고 창이 그걸 읽어 알려 줌.
  const pending = stockTargetIds(kind, units).filter((id) => !(report.stock_applied ?? []).includes(id));
  if (pending.length) {
    const ctx = { company: report.company, date: evRow.date, kind };
    after(async () => {
      await applyStockForReport(report.id, pending, ctx);
    });
  }
  return { ok: true, message, stockPending: pending.length };
}

// ── IT재고 반영(납품·교체 → 위치 '임대중' + 비고 "yy.mm.dd 업체명") ────────────

type StockContext = { company: string; date: string; kind: string };
export type StockOutcome = {
  id: string;
  result: 'applied' | PrepStockIssue['reason'];
  message: string;
  /** 시트는 처리했는데 결과를 보고 행에 못 적음(다시 반영해도 같은 날 이력은 두 번 안 씀) */
  recordError?: string;
};

function kstStamp(): string {
  const d = new Date(Date.now() + 9 * 3600_000);
  return `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 한 대 반영 — 예전 after() 안의 동작 그대로(무엇을·어디에 쓰는지 같음) + 읽은 줄 재확인. */
async function applyStockUnit(id: string, ctx: StockContext): Promise<StockOutcome> {
  try {
    const asset = await getAssetFromSheets(id);
    if (!asset) {
      console.warn('[prep] IT재고에 없는 자산번호:', id);
      return { id, result: 'not_found', message: 'IT재고에 없는 자산번호예요 — 번호가 맞는지 확인해 주세요' };
    }
    // 기억해 둔 줄 번호가 밀려(그 사이 시트에 줄이 끼거나 빠짐) 다른 기기 줄을 읽었으면 쓰지 않음
    if (asset.assetId.trim().toUpperCase() !== id) {
      console.error('[prep] 읽은 줄의 자산번호가 다름 — 안 씀:', id, '→', asset.assetId);
      return {
        id,
        result: 'error',
        message: `IT재고 시트 줄 위치가 바뀌어 다른 줄(${asset.assetId || '빈 줄'})이 읽혀서 안 썼어요 — 10분쯤 뒤 다시 반영해 주세요`,
      };
    }
    const tag = `${kstStamp()} ${ctx.company || '출고'}`;
    // 이미 반영된 자산(예전 발송이 중간에 끊긴 경우)은 이력을 두 번 쓰지 않음
    const already = asset.location.trim() === '임대중' && asset.history.includes(tag);
    const history = already ? asset.history : [asset.history.trim(), tag].filter(Boolean).join(' / ');
    if (!already) await updateAssetInSheet(id, { ...asset, location: '임대중', history });
    if (!already)
      await logAssetMovement({
        assetNumber: id,
        category: asset.category,
        fromLocation: null,
        toLocation: null,
        fromStatus: null,
        toStatus: null,
        memo: `출고 준비 완료 보고 — ${ctx.company} (${ctx.date} ${ctx.kind})`,
      });
    return { id, result: 'applied', message: '' };
  } catch (err) {
    console.error('[prep] 재고 위치 변경 실패:', id, err);
    return { id, result: 'error', message: `IT재고 시트에 못 썼어요(${sheetFailReason(err)})` };
  }
}

type StockState = { applied: string[]; issues: PrepStockIssues; issuesReady: boolean };

async function readStockState(reportId: string): Promise<StockState> {
  const supabase = createAdminClient();
  const full = await supabase.from(REPORTS_TABLE).select('stock_applied,stock_issues').eq('id', reportId).single();
  if (!full.error) {
    const r = full.data as { stock_applied: string[] | null; stock_issues: PrepStockIssues | null };
    return { applied: r.stock_applied ?? [], issues: r.stock_issues ?? {}, issuesReady: true };
  }
  if (!isMissingStockIssuesColumn(full.error)) throw new Error(`보고 읽기 실패: ${full.error.message}`);
  // SQL 실행 전 — 반영된 것만 적고, 못 한 것은 화면이 "기기 − stock_applied"로 셈
  const old = await supabase.from(REPORTS_TABLE).select('stock_applied').eq('id', reportId).single();
  if (old.error) throw new Error(`보고 읽기 실패: ${old.error.message}`);
  return { applied: (old.data as { stock_applied: string[] | null }).stock_applied ?? [], issues: {}, issuesReady: false };
}

/** 한 대씩 기록 — 중간에 끊겨도 다시 보낼 때 이미 바꾼 건 건너뜀(stock_applied), 못 한 건 이유(stock_issues). */
async function recordStockOutcome(reportId: string, o: StockOutcome): Promise<void> {
  const state = await readStockState(reportId);
  const applied = new Set(state.applied);
  const issues: PrepStockIssues = { ...state.issues };
  if (o.result === 'applied') {
    applied.add(o.id);
    delete issues[o.id];
  } else {
    if (!state.issuesReady) return; // 적을 칸이 없음 — 화면은 "기기 − stock_applied"로 셈
    issues[o.id] = { reason: o.result, message: o.message, at: new Date().toISOString() };
  }
  const patch = state.issuesReady ? { stock_applied: [...applied], stock_issues: issues } : { stock_applied: [...applied] };
  const { error } = await createAdminClient().from(REPORTS_TABLE).update(patch).eq('id', reportId);
  if (error) throw new Error(`반영 결과 저장 실패: ${error.message}`);
}

/** 다시 시도하는 번호의 예전 이유는 먼저 지움 — 창이 옛 결과 대신 "처리 중"으로 보게(새 결과가 곧 적힘). */
async function clearStockIssues(reportId: string, ids: string[]): Promise<void> {
  const state = await readStockState(reportId);
  if (!state.issuesReady || !ids.some((id) => state.issues[id])) return;
  const issues: PrepStockIssues = { ...state.issues };
  for (const id of ids) delete issues[id];
  const { error } = await createAdminClient().from(REPORTS_TABLE).update({ stock_issues: issues }).eq('id', reportId);
  if (error) throw new Error(`예전 반영 결과 지우기 실패: ${error.message}`);
}

async function applyStockForReport(reportId: string, ids: string[], ctx: StockContext): Promise<StockOutcome[]> {
  const out: StockOutcome[] = [];
  // 예전 이유 지우기는 화면 표시용 — 실패해도 재고 반영(본 일)은 그대로 하고, 새 결과가 옛 이유를 덮어씀
  try {
    await clearStockIssues(reportId, ids);
  } catch (err) {
    console.error('[prep] 예전 반영 결과 지우기 실패(반영은 계속):', reportId, err);
  }
  for (const id of [...new Set(ids)]) {
    const o = await applyStockUnit(id, ctx);
    try {
      await recordStockOutcome(reportId, o);
    } catch (err) {
      console.error('[prep] 재고 반영 결과 저장 실패:', id, err);
      o.recordError = err instanceof Error ? err.message : String(err);
    }
    out.push(o);
  }
  return out;
}

/** 재고 반영 상태만 다시 읽기(완료 보고 창이 발송 뒤 몇 초마다 확인) — 사진 항목은 안 읽음. */
export async function getPrepStock(eventId: string): Promise<Result<{ report: PrepReport | null }>> {
  const { data, error } = await createAdminClient().from(REPORTS_TABLE).select('*').eq('event_id', eventId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, report: data ? toReport(data as ReportRow) : null };
}

/**
 * "재고 다시 반영" — 아직 IT재고에 반영 안 된 기기만 지금 바로 다시(카톡은 안 보냄). 발송 때와 같은 반영 함수,
 * stock_applied 에 있는 번호는 건너뜀. skip = 이번에 창에서 이미 시도한 번호(같은 번호를 되풀이하지 않게).
 * 한 번에 최대 6대(한 대에 시트 3번 — 응답이 30초를 안 넘게). 남으면(remaining) 창이 이어서 부름.
 */
export async function retryPrepStock(
  eventId: string,
  skip: string[] = [],
): Promise<Result<{ outcomes: StockOutcome[]; remaining: number }>> {
  try {
    const supabase = createAdminClient();
    const { data: rep, error } = await supabase.from(REPORTS_TABLE).select('*').eq('event_id', eventId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!rep) return { ok: false, error: '완료 보고가 아직 없어요.' };
    const report = rep as ReportRow;
    const { data: ev, error: evError } = await supabase.from(CALENDAR_TABLE).select('date,title').eq('id', eventId).single();
    if (evError) return { ok: false, error: evError.message };
    const evRow = ev as { date: string; title: string };
    const kind = eventKindOf(evRow.title);
    if (kind === '철수') return { ok: false, error: '철수 건은 IT재고 위치를 바꾸지 않아요.' };
    const done = new Set(report.stock_applied ?? []);
    const tried = new Set(skip);
    const pending = stockTargetIds(kind, report.units ?? []).filter((id) => !done.has(id) && !tried.has(id));
    const batch = pending.slice(0, 6);
    const outcomes = batch.length
      ? await applyStockForReport(report.id, batch, { company: report.company, date: evRow.date, kind })
      : [];
    return { ok: true, outcomes, remaining: pending.length - batch.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 공개 앨범 뷰어(/album?id=)용 — 로그인 없이 사진만. */
export async function getAlbum(id: string): Promise<{ title: string; date: string; photos: PrepPhoto[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = createAdminClient();
  const { data } = await supabase.from(REPORTS_TABLE).select('company,model,photos,event_id').eq('id', id).maybeSingle();
  if (!data) return null;
  const r = data as { company: string; model: string; photos: PrepPhoto[]; event_id: string };
  const { data: ev } = await supabase.from(CALENDAR_TABLE).select('date').eq('id', r.event_id).maybeSingle();
  return { title: [r.company, r.model].filter(Boolean).join(' · ') || '출고 준비 사진', date: (ev as { date?: string } | null)?.date ?? '', photos: r.photos ?? [] };
}

/** 카톡은 이미 나갔는데 "발송 완료"가 저장되지 않은 보고를 발송됨으로 표시(카톡 다시 안 보냄). */
export async function markPrepReportSent(eventId: string): Promise<Result> {
  const report = await ensureReport(eventId);
  if (report.sent_at) return { ok: true };
  const { error } = await createAdminClient()
    .from(REPORTS_TABLE)
    .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', report.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
