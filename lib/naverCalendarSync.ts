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
const MAX_CHANGED_PER_CALENDAR = 240;
const FETCH_CONCURRENCY = 8;

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

type SyncStateRow = { href: string; etag: string; uid: string; calendar_id: string };

export async function syncNaverCalendars(
  forceFull = false,
): Promise<{ ok: true; results: Record<string, unknown> } | { ok: false; error: string } | { ok: true; skipped: true }> {
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

  const probe = await supabase.from(CALENDAR_TABLE).select('naver_important').limit(1);
  const hasImportantCol = !probe.error;

  // 같은 UID가 여러 href(복사된 일정·다른 캘린더)에 있으면 행 하나에 서로 덮어써서 일정이
  // 사라져 보였어요(영화사집 별표 일정). href마다 행을 따로 두기 위해 두 번째부터는
  // "uid#href해시" 키를 씁니다. 이미 덮어써진 중복은 지문을 지워 다시 읽게 합니다.
  const allState: SyncStateRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from(SYNC_STATE_TABLE)
      .select('href,etag,uid,calendar_id')
      .order('href', { ascending: true })
      .range(from, from + 999);
    allState.push(...((page ?? []) as SyncStateRow[]));
    if (!page || page.length < 1000) break;
  }
  const claimed = new Map<string, string>(); // 기본 uid → 그 키를 가진 href
  const hrefsByUid = new Map<string, SyncStateRow[]>();
  for (const r of allState) {
    if (r.uid.startsWith('it-')) continue;
    if (!r.uid.includes('#')) claimed.set(r.uid, r.href);
    const base = r.uid.split('#')[0];
    hrefsByUid.set(base, [...(hrefsByUid.get(base) ?? []), r]);
  }
  const collided = [...hrefsByUid.values()].filter((rs) => rs.filter((r) => !r.uid.includes('#')).length > 1).flat();
  if (collided.length) {
    for (const r of collided) {
      await supabase.from(SYNC_STATE_TABLE).delete().eq('href', r.href);
      if (claimed.get(r.uid) === r.href) claimed.delete(r.uid);
    }
    await supabase.from(NAVER_CALENDARS_TABLE).update({ ctag: '' }).neq('id', '');
    for (const c of (calendars ?? []) as { ctag: string }[]) c.ctag = '';
  }
  const hrefHash = (h: string) => {
    let x = 5381;
    for (let i = 0; i < h.length; i++) x = ((x * 33) ^ h.charCodeAt(i)) >>> 0;
    return x.toString(36);
  };
  /** 이 href의 행 키 — 이미 아는 href면 그대로, 처음이면 uid를 아무도 안 쓸 때만 uid. */
  const rowKeyFor = (uid: string, href: string, known?: SyncStateRow) => {
    if (known && !collided.some((c) => c.href === href)) return known.uid;
    const owner = claimed.get(uid);
    if (!owner || owner === href) {
      claimed.set(uid, href);
      return uid;
    }
    return `${uid}#${hrefHash(href)}`;
  };

  const startYmd = todayPlus(-30);
  const endYmd = todayPlus(120);
  const results: Record<string, unknown> = {};

  for (const cal of (calendars ?? []) as { id: string; name: string; ctag: string }[]) {
    try {
      const newCtag = await fetchCtag(cal.id);
      // ctag가 "완료 체크만 토글" 같은 속성 전용 변경에는 안 바뀔 수도 있어서(서버 구현에
      // 따라 다름), forceFull(하루 1번 cron)일 땐 ctag가 같아도 항상 전체 REPORT까지 돕니다.
      if (!forceFull && newCtag && newCtag === cal.ctag) {
        results[cal.id] = { skipped: true, reason: 'ctag unchanged' };
        continue;
      }

      const current = await reportChangedEvents(cal.id, startYmd, endYmd);

      // 상태 행이 1000개를 넘으면 PostgREST가 잘라내서 일정이 영원히 누락됩니다 — 끝까지 페이지로 읽음.
      const stateRows: SyncStateRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error: pageErr } = await supabase
          .from(SYNC_STATE_TABLE)
          .select('href,etag,uid,calendar_id')
          .eq('calendar_id', cal.id)
          .order('href', { ascending: true })
          .range(from, from + 999);
        if (pageErr) throw new Error(`동기화 상태 조회 실패: ${pageErr.message}`);
        stateRows.push(...((page ?? []) as SyncStateRow[]));
        if (!page || page.length < 1000) break;
      }
      const prevByHref = new Map(stateRows.map((r) => [r.href, r]));

      const allChanged = current.filter((c) => prevByHref.get(c.href)?.etag !== c.etag);
      const changed = allChanged.slice(0, MAX_CHANGED_PER_CALENDAR);
      const backlogged = allChanged.length > changed.length;

      let updated = 0;
      let created = 0;
      let failed = 0;

      // shipment_prep_schema.sql 실행 전이면 naver_important 칸이 없어요 — 그 칸만 빼고 저장.
      const stripImportant = <T extends Record<string, unknown>>(row: T): T => {
        if (hasImportantCol) return row;
        const { naver_important: _omit, ...rest } = row;
        void _omit;
        return rest as T;
      };

      async function processOne({ href, etag }: { href: string; etag: string }) {
        try {
          const ics = await getEventByHref(href);
          const parsed = parseEventBlock(ics);
          if (!parsed) return;

          let error: { message: string } | null = null;
          const rowKey = parsed.uid.startsWith('it-') ? parsed.uid : rowKeyFor(parsed.uid, href, prevByHref.get(href));
          if (parsed.uid.startsWith('it-')) {
            const patch = stripImportant({
                title: parsed.title,
                date: parsed.date,
                time: parsed.time,
                location: parsed.location,
                description: parsed.description,
                status: parsed.completed ? '완료' : '진행중',
                naver_important: parsed.important,
                naver_synced_at: new Date().toISOString(),
              });
            ({ error } = await supabase.from(CALENDAR_TABLE).update(patch).eq('id', parsed.uid.slice(3)));
            if (!error) updated++;
          } else {
            ({ error } = await supabase.from(CALENDAR_TABLE).upsert(
              stripImportant({
                title: parsed.title,
                date: parsed.date,
                time: parsed.time,
                location: parsed.location,
                description: parsed.description,
                status: parsed.completed ? '완료' : '진행중',
                author: '',
                naver_uid: rowKey,
                source: 'naver',
                calendar_id: cal.id,
                naver_important: parsed.important,
                naver_synced_at: new Date().toISOString(),
              }),
              { onConflict: 'naver_uid' },
            ));
            if (!error) created++;
          }
          // 저장에 실패한 일정은 지문(etag)을 남기지 않습니다 — 남기면 다음 동기화에서
          // "변경 없음"으로 건너뛰어 영구 누락돼요.
          if (error) {
            failed++;
            console.error('[naverCalendarSync] 일정 저장 실패:', href, error.message);
            return;
          }
          await supabase
            .from(SYNC_STATE_TABLE)
            .upsert({ href, etag, uid: rowKey, calendar_id: cal.id }, { onConflict: 'href' });
        } catch (err) {
          failed++;
          console.error('[naverCalendarSync] 이벤트 처리 실패:', href, err);
        }
      }

      for (let i = 0; i < changed.length; i += FETCH_CONCURRENCY) {
        await Promise.all(changed.slice(i, i + FETCH_CONCURRENCY).map(processOne));
      }

      // 삭제는 에러·밀린 분량이 없을 때만, 그리고 동기화 기간 창 안의 일정만 지웁니다 —
      // 창 밖으로 밀려난 일정(30일 지난 것 등)은 상태 행만 정리하고 일정은 남겨둡니다.
      let deleted = 0;
      if (failed === 0 && !backlogged) {
        const currentHrefs = new Set(current.map((c) => c.href));
        const staleStates = stateRows.filter((r) => !currentHrefs.has(r.href));
        const winStart = `${startYmd.slice(0, 4)}-${startYmd.slice(4, 6)}-${startYmd.slice(6, 8)}`;
        const winEnd = `${endYmd.slice(0, 4)}-${endYmd.slice(4, 6)}-${endYmd.slice(6, 8)}`;
        for (const stale of staleStates) {
          const byId = stale.uid.startsWith('it-');
          const { data: local } = await supabase
            .from(CALENDAR_TABLE)
            .select('id,date')
            .eq(byId ? 'id' : 'naver_uid', byId ? stale.uid.slice(3) : stale.uid)
            .maybeSingle();
          const d = (local as { date?: string } | null)?.date ?? '';
          if (local && d >= winStart && d <= winEnd) {
            await supabase.from(CALENDAR_TABLE).delete().eq('id', (local as { id: string }).id);
            deleted++;
          }
          await supabase.from(SYNC_STATE_TABLE).delete().eq('href', stale.href);
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
