'use server';

import { getEventWithEtag, isNaverCalDavConfigured, putEventByHref, rewriteSummaryTags } from '@/lib/naverCaldav';
import { syncNaverCalendars } from '@/lib/naverCalendarSync';
import {
  applyPrepStage,
  eventKindOf,
  guessCompany,
  isItPrepTarget,
  parseEventTitle,
  parseItemsFromMemo,
  prepTitleTags,
  type PrepChecks,
  type PrepStage,
} from '@/lib/shipmentPrep';
import { CALENDAR_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';

const PREP_EVENTS_TABLE = 'it_prep_events';
const PREP_PEOPLE_TABLE = 'it_prep_people';
const PREP_REPORTS_TABLE = 'it_prep_reports';
const SYNC_STATE_TABLE = 'it_naver_sync_state';

export type PrepEventRow = {
  id: string;
  date: string;
  time: string;
  createdAt: string;
  title: string;
  description: string;
  location: string;
  company: string;
  kind: string;
  items: string[];
  naverUid: string | null;
  prepChecks: PrepChecks;
  reportSent: boolean;
  photoCount: number;
};

export type PrepListResult = { ok: true; events: PrepEventRow[] } | { ok: false; error: string };

function ymdOffset(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000); // KST
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 별표(네이버 ★ 또는 앱 ⭐) 일정 중 IT 출고 대상만 — 네이버 목록 순서(날짜 → 시각(종일 먼저) → 등록순). */
export async function listPrepEvents(): Promise<PrepListResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 설정이 필요해요.' };
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(CALENDAR_TABLE)
    .select('id,date,time,created_at,title,description,location,naver_uid,important,naver_important')
    .or('naver_important.eq.true,important.eq.true')
    .gte('date', ymdOffset(-14))
    .lte('date', ymdOffset(60))
    .limit(1000);
  if (error) {
    if (/naver_important/.test(error.message)) {
      return { ok: false, error: 'DB 준비가 안 됐어요 — supabase/shipment_prep_schema.sql 을 먼저 실행해주세요.' };
    }
    return { ok: false, error: error.message };
  }
  type Row = {
    id: string; date: string; time: string; created_at: string; title: string; description: string;
    location: string; naver_uid: string | null;
  };
  const rows = ((data ?? []) as Row[]).filter((r) => isItPrepTarget(r.title, r.description));
  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.created_at.localeCompare(b.created_at),
  );

  const ids = rows.map((r) => r.id);
  const [prepRes, reportRes] = ids.length
    ? await Promise.all([
        supabase.from(PREP_EVENTS_TABLE).select('event_id,prep_checks').in('event_id', ids),
        supabase.from(PREP_REPORTS_TABLE).select('event_id,sent_at,photos').in('event_id', ids),
      ])
    : [{ data: [] }, { data: [] }];
  const checksById = new Map(
    ((prepRes.data ?? []) as { event_id: string; prep_checks: PrepChecks }[]).map((r) => [r.event_id, r.prep_checks ?? {}]),
  );
  const reportById = new Map(
    ((reportRes.data ?? []) as { event_id: string; sent_at: string | null; photos: unknown[] }[]).map((r) => [r.event_id, r]),
  );

  return {
    ok: true,
    events: rows.map((r) => {
      const rep = reportById.get(r.id);
      return {
        id: r.id,
        date: r.date,
        time: r.time ?? '',
        createdAt: r.created_at,
        title: r.title,
        description: r.description ?? '',
        location: r.location ?? '',
        company: guessCompany(r.title),
        kind: eventKindOf(r.title),
        items: (() => {
          const fromTitle = parseEventTitle(r.title).items;
          return fromTitle.length ? fromTitle : parseItemsFromMemo(r.description ?? '');
        })(),
        naverUid: r.naver_uid,
        prepChecks: checksById.get(r.id) ?? {},
        reportSent: !!rep?.sent_at,
        photoCount: Array.isArray(rep?.photos) ? rep!.photos.length : 0,
      };
    }),
  };
}

export type TitleTagResult = { ok: true; title?: string; skipped?: string } | { ok: false; error: string };

/** 담당자 단계 체크 저장(DB만 — 빠르게). */
export async function setPrepStage(
  eventId: string,
  person: string,
  stage: PrepStage,
  on: boolean,
): Promise<{ ok: true; checks: PrepChecks } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const { data: cur } = await supabase.from(PREP_EVENTS_TABLE).select('prep_checks').eq('event_id', eventId).maybeSingle();
  const checks = applyPrepStage(((cur as { prep_checks?: PrepChecks } | null)?.prep_checks ?? {}) as PrepChecks, person, stage, on, new Date().toISOString());
  const { error } = await supabase
    .from(PREP_EVENTS_TABLE)
    .upsert({ event_id: eventId, prep_checks: checks, updated_at: new Date().toISOString() }, { onConflict: 'event_id' });
  if (error) return { ok: false, error: `저장 실패: ${error.message}` };
  // 네이버 제목 태그는 /api/shipment-prep/title-tag 로 따로(버튼 응답을 붙잡지 않게).
  return { ok: true, checks };
}

/** 네이버 일정 제목 앞에 "이름오버홀/준비중/완료" 반영 — 원본 Edge Function prep_tag 이식. */
export async function syncPrepTitleTag(eventId: string): Promise<TitleTagResult> {
  try {
    if (!isNaverCalDavConfigured()) return { ok: true, skipped: '네이버 연동 설정 없음' };
    const supabase = createAdminClient();
    const { data: ev } = await supabase.from(CALENDAR_TABLE).select('naver_uid,title').eq('id', eventId).maybeSingle();
    const uid = (ev as { naver_uid: string | null } | null)?.naver_uid;
    if (!uid) return { ok: true, skipped: '네이버에서 온 일정이 아님' };

    const { data: hrefRows } = await supabase.from(SYNC_STATE_TABLE).select('href').eq('uid', uid);
    const href = ((hrefRows ?? []) as { href: string }[])[0]?.href;
    if (!href) return { ok: false, error: '네이버 일정 주소를 아직 몰라요 (동기화 후 다시 시도해주세요)' };

    const [{ data: prep }, { data: people }] = await Promise.all([
      supabase.from(PREP_EVENTS_TABLE).select('prep_checks').eq('event_id', eventId).maybeSingle(),
      supabase.from(PREP_PEOPLE_TABLE).select('name'),
    ]);
    const checks = ((prep as { prep_checks?: PrepChecks } | null)?.prep_checks ?? {}) as PrepChecks;
    const tags = prepTitleTags(checks);
    // 우리 담당자 이름 태그만 지우고 붙입니다(백오피스 담당자 태그는 그대로).
    const names = [...new Set([...Object.keys(checks), ...((people ?? []) as { name: string }[]).map((p) => p.name)])].filter(Boolean);

    for (let attempt = 0; attempt < 2; attempt++) {
      const { ics, etag } = await getEventWithEtag(href);
      const next = rewriteSummaryTags(ics, names, tags);
      if (!next) return { ok: true };
      const r = await putEventByHref(href, next.ics, etag);
      if (r === 'conflict') continue; // 그 사이 누가 고침 → 다시 읽어서 재시도
      await supabase.from(CALENDAR_TABLE).update({ title: next.title.slice(0, 300) }).eq('id', eventId);
      return { ok: true, title: next.title };
    }
    return { ok: false, error: '다른 사람이 동시에 고쳐서 수정하지 못했어요. 다시 시도해주세요.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let lastFullSync = 0;

/** 화면을 열어두면 60초마다 호출 — 네이버 → 통합캘린더 동기화. */
export async function triggerPrepSync(): Promise<{ ok: boolean; error?: string; results?: unknown }> {
  try {
    // ctag가 별표·완료 같은 속성 변경에 안 바뀔 수 있어, 5분에 한 번은 ctag와 무관하게 전체 대조.
    const full = Date.now() - lastFullSync > 5 * 60_000;
    if (full) lastFullSync = Date.now();
    const r = await syncNaverCalendars(full);
    return r.ok ? { ok: true, results: 'results' in r ? r.results : undefined } : { ok: false, error: 'error' in r ? r.error : '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── 담당자 관리 ──────────────────────────────────────────────

export type PrepPerson = { name: string; sortOrder: number; isActive: boolean };

export async function listPrepPeople(): Promise<PrepPerson[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from(PREP_PEOPLE_TABLE).select('name,sort_order,is_active').order('sort_order').order('name');
  return ((data ?? []) as { name: string; sort_order: number; is_active: boolean }[]).map((p) => ({
    name: p.name,
    sortOrder: p.sort_order,
    isActive: p.is_active,
  }));
}

export async function savePrepPeople(people: PrepPerson[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const clean = people
    .map((p, i) => ({ name: p.name.trim(), sort_order: i, is_active: p.isActive }))
    .filter((p) => p.name);
  const { data: existing } = await supabase.from(PREP_PEOPLE_TABLE).select('name');
  const keep = new Set(clean.map((p) => p.name));
  const removed = ((existing ?? []) as { name: string }[]).map((r) => r.name).filter((n) => !keep.has(n));
  if (removed.length) await supabase.from(PREP_PEOPLE_TABLE).delete().in('name', removed);
  if (clean.length) {
    const { error } = await supabase.from(PREP_PEOPLE_TABLE).upsert(clean, { onConflict: 'name' });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
