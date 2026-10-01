import 'server-only';
import {
  fetchCtag,
  getEventByHref,
  isNaverCalDavConfigured,
  parseEventBlock,
  reportChangedEvents,
} from './naverCaldav';
import { CALENDAR_TABLE, createAdminClient, isSupabaseConfigured } from './supabase/server';

/**
 * 네이버 → 앱 풀 동기화. Vercel Hobby 요금제는 하루 1번 넘는 cron을 못 써서(API 라우트
 * 확인됨), cron은 하루 1번 안전망으로만 두고, 이 함수를 캘린더 페이지를 열 때마다
 * best-effort로 같이 불러서 사실상 "방문 시 동기화"가 되게 합니다 — ctag가 안 바뀌었으면
 * REPORT 자체를 생략해서 빠릅니다.
 *
 * uid가 'it-'로 시작(앱이 만든 일정) → 네이버 쪽 수정 내용을 로컬에 반영.
 * 그 외 uid(네이버에서 직접 만든 일정) → source:'naver'로 새 로컬 행 생성.
 * 삭제는 이번 폴링에 에러/밀린 분량이 없었던 캘린더에 한해서만 판정합니다(오판 방지).
 */

const NAVER_CALENDARS_TABLE = 'it_naver_calendars';
const SYNC_STATE_TABLE = 'it_naver_sync_state';
const MAX_CHANGED_PER_CALENDAR = 80;

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

type SyncStateRow = { href: string; etag: string; uid: string; calendar_id: string };

export async function syncNaverCalendars(): Promise<{ ok: true; results: Record<string, unknown> } | { ok: false; error: string } | { ok: true; skipped: true }> {
  if (!isNaverCalDavConfigured() || !isSupabaseConfigured()) {
    return { ok: true, skipped: true };
  }

  const supabase = createAdminClient();
  const { data: calendars, error: calError } = await supabase
    .from(NAVER_CALENDARS_TABLE)
    .select('id,name,ctag')
    .eq('enabled', true);

  if (calError) {
    console.error('[naverCalendarSync] 연결된 캘린더 조회 실패:', calError);
    return { ok: false, error: calError.message };
  }

  const startYmd = todayPlus(-30);
  const endYmd = todayPlus(120);
  const results: Record<string, unknown> = {};

  for (const cal of (calendars ?? []) as { id: string; name: string; ctag: string }[]) {
    try {
      const newCtag = await fetchCtag(cal.id);
      if (newCtag && newCtag === cal.ctag) {
        results[cal.id] = { skipped: true, reason: 'ctag unchanged' };
        continue;
      }

      const current = await reportChangedEvents(cal.id, startYmd, endYmd);

      const { data: stateRows } = await supabase
        .from(SYNC_STATE_TABLE)
        .select('href,etag,uid,calendar_id')
        .eq('calendar_id', cal.id);
      const prevByHref = new Map(((stateRows ?? []) as SyncStateRow[]).map((r) => [r.href, r]));

      const changed = current.filter((c) => prevByHref.get(c.href)?.etag !== c.etag).slice(0, MAX_CHANGED_PER_CALENDAR);
      const backlogged = current.length - changed.length > 0 && changed.length === MAX_CHANGED_PER_CALENDAR;

      let updated = 0;
      let created = 0;
      let failed = 0;

      for (const { href, etag } of changed) {
        try {
          const ics = await getEventByHref(href);
          const parsed = parseEventBlock(ics);
          if (!parsed) continue;

          if (parsed.uid.startsWith('it-')) {
            const localId = parsed.uid.slice(3);
            const { error } = await supabase
              .from(CALENDAR_TABLE)
              .update({
                title: parsed.title,
                date: parsed.date,
                time: parsed.time,
                location: parsed.location,
                description: parsed.description,
                naver_synced_at: new Date().toISOString(),
              })
              .eq('id', localId);
            if (!error) updated++;
            else failed++;
          } else {
            const { error } = await supabase.from(CALENDAR_TABLE).upsert(
              {
                title: parsed.title,
                date: parsed.date,
                time: parsed.time,
                location: parsed.location,
                description: parsed.description,
                status: '진행중',
                author: '',
                naver_uid: parsed.uid,
                source: 'naver',
                calendar_id: cal.id,
                naver_synced_at: new Date().toISOString(),
              },
              { onConflict: 'naver_uid' },
            );
            if (!error) created++;
            else failed++;
          }

          await supabase
            .from(SYNC_STATE_TABLE)
            .upsert({ href, etag, uid: parsed.uid, calendar_id: cal.id }, { onConflict: 'href' });
        } catch (err) {
          failed++;
          console.error('[naverCalendarSync] 이벤트 처리 실패:', href, err);
        }
      }

      let deleted = 0;
      if (failed === 0 && !backlogged) {
        const currentHrefs = new Set(current.map((c) => c.href));
        const staleStates = ((stateRows ?? []) as SyncStateRow[]).filter((r) => !currentHrefs.has(r.href));
        for (const stale of staleStates) {
          if (stale.uid.startsWith('it-')) {
            await supabase.from(CALENDAR_TABLE).delete().eq('id', stale.uid.slice(3));
          } else {
            await supabase.from(CALENDAR_TABLE).delete().eq('naver_uid', stale.uid);
          }
          await supabase.from(SYNC_STATE_TABLE).delete().eq('href', stale.href);
          deleted++;
        }
      }

      if (newCtag) {
        await supabase.from(NAVER_CALENDARS_TABLE).update({ ctag: newCtag }).eq('id', cal.id);
      }

      results[cal.id] = { name: cal.name, checked: current.length, updated, created, deleted, failed, backlogged };
    } catch (err) {
      console.error('[naverCalendarSync] 캘린더 동기화 실패:', cal.id, err);
      results[cal.id] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { ok: true, results };
}
