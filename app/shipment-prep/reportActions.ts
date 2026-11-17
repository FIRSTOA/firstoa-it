'use server';

import { headers } from 'next/headers';
import { updateAsset } from '@/app/actions';
import { getAssetFromSheets } from '@/lib/inventory/sheets';
import { logAssetMovement } from '@/lib/inventory/movements';
import { extractSaleInfoFromImage, isOcrConfigured } from '@/lib/ocr';
import { buildPrepMessage, KAKAO_ROOM, type PrepPhoto, type PrepReport, type PrepUnit } from '@/lib/shipmentPrep';
import { CALENDAR_TABLE, createAdminClient, RENTAL_TABLE } from '@/lib/supabase/server';

const REPORTS_TABLE = 'it_prep_reports';
const PHOTO_ITEMS_TABLE = 'it_prep_photo_items';
const BUCKET = 'prep-photos';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type ReportRow = {
  id: string; event_id: string; company: string; model: string; author: string; units: PrepUnit[];
  photos: PrepPhoto[]; checked_items: string[]; note: string; message: string; sent_at: string | null;
  stock_applied: string[];
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

export async function getPrepReport(eventId: string): Promise<Result<{ report: PrepReport | null; photoItems: string[] }>> {
  const supabase = createAdminClient();
  const [rep, items] = await Promise.all([
    supabase.from(REPORTS_TABLE).select('*').eq('event_id', eventId).maybeSingle(),
    supabase.from(PHOTO_ITEMS_TABLE).select('label').order('sort_order').order('created_at'),
  ]);
  if (rep.error) return { ok: false, error: /it_prep_reports/.test(rep.error.message) ? 'supabase/shipment_prep_schema.sql 을 먼저 실행해주세요.' : rep.error.message };
  return {
    ok: true,
    report: rep.data ? toReport(rep.data as ReportRow) : null,
    photoItems: ((items.data ?? []) as { label: string }[]).map((i) => i.label),
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

export type UnitLookup = { serials: string[]; model: string; gubun: string; spec: string; source: 'inventory' | 'rental' | '' };

/**
 * 자산번호 → 시리얼·모델명·구분값·스펙. IT재고(구글시트)가 구분값/스펙까지 있어 우선,
 * 없으면 임대리스트(firstoa-works 사본)의 모델명·시리얼·옵션.
 */
export async function lookupUnitByAsset(assetId: string): Promise<UnitLookup> {
  const key = assetId.trim().toUpperCase();
  const empty: UnitLookup = { serials: [], model: '', gubun: '', spec: '', source: '' };
  if (!/^[A-Z0-9._-]{2,}$/.test(key)) return empty;
  const asset = await getAssetFromSheets(key).catch(() => null);
  if (asset) {
    const spec = [asset.cpu, asset.ram && `${asset.ram}${/\D/.test(asset.ram) ? '' : 'GB'}`, asset.storage, asset.screen]
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .join(' / ');
    const rentalSerials = await lookupSerialsByAsset(key).catch(() => []);
    const serials = [...new Set([asset.serialNo, ...rentalSerials].map((s) => (s ?? '').trim()).filter(Boolean))];
    return {
      serials,
      model: [asset.brand, asset.model].filter(Boolean).join(' '),
      gubun: asset.gubunCode || asset.specLabel || asset.spec || '',
      spec,
      source: 'inventory',
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
    model: [r.manufacturer, r.model_name].map((v) => (v ?? '').trim()).filter(Boolean).join(' '),
    gubun: '',
    spec: [r.option1, r.option2, r.option3, r.option4].map((v) => (v ?? '').trim()).filter((v) => v && v !== 'X').join(' / '),
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

export async function addPhotoItem(label: string): Promise<Result> {
  const l = label.trim();
  if (!l) return { ok: false, error: '항목 이름을 입력해주세요.' };
  const supabase = createAdminClient();
  const { count } = await supabase.from(PHOTO_ITEMS_TABLE).select('label', { count: 'exact', head: true });
  const { error } = await supabase.from(PHOTO_ITEMS_TABLE).upsert({ label: l, sort_order: (count ?? 0) + 1 }, { onConflict: 'label' });
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
): Promise<Result<{ message: string; stockWarnings: string[] }>> {
  const saved = await savePrepReport(eventId, draft);
  if (!saved.ok) return saved;
  const supabase = createAdminClient();
  const report = await ensureReport(eventId);
  const { data: ev } = await supabase.from(CALENDAR_TABLE).select('date,title').eq('id', eventId).single();
  const evRow = ev as { date: string; title: string };
  const kind = evRow.title.includes('철수') ? '철수' : evRow.title.includes('교체') ? '교체' : '납품';
  const albumUrl = `${await siteOrigin()}/album?id=${report.id}`;
  const units = (report.units ?? []).filter((u) => u.serial || u.assetId);
  const message = buildPrepMessage({
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

  try {
    await enqueueOutbox(KAKAO_ROOM, message);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 재고 위치 변경 — 철수는 장비가 돌아오는 건이라 제외.
  const stockWarnings: string[] = [];
  const applied = new Set(report.stock_applied ?? []);
  if (kind !== '철수') {
    const d = new Date(Date.now() + 9 * 3600_000);
    const stamp = `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
    for (const u of units) {
      const id = u.assetId.trim().toUpperCase();
      if (!id || applied.has(id)) continue;
      const asset = await getAssetFromSheets(id).catch(() => null);
      if (!asset) {
        stockWarnings.push(`${id}: IT재고에서 못 찾아 위치를 못 바꿨어요`);
        continue;
      }
      const history = [asset.history.trim(), `${stamp} ${report.company || '출고'}`].filter(Boolean).join(' / ');
      const r = await updateAsset(id, { ...asset, location: '임대중', history });
      if (!r.ok) {
        stockWarnings.push(`${id}: ${r.error}`);
        continue;
      }
      await logAssetMovement({
        assetNumber: id,
        category: asset.category,
        fromLocation: null,
        toLocation: null,
        fromStatus: null,
        toStatus: null,
        memo: `출고 준비 완료 보고 — ${report.company} (${evRow.date} ${kind})`,
      });
      applied.add(id);
    }
  }

  await supabase
    .from(REPORTS_TABLE)
    .update({ message, sent_at: new Date().toISOString(), stock_applied: [...applied], updated_at: new Date().toISOString() })
    .eq('id', report.id);
  return { ok: true, message, stockWarnings };
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
