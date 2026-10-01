import CalendarPage from '@/components/calendar/CalendarPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { monthGridRange, toYmd } from '@/lib/calendar';
import { syncNaverCalendars } from '@/lib/naverCalendarSync';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { listConnectedCalendars, listEventsInRange } from './actions';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu="통합 캘린더" title="📅 통합캘린더">
        <SetupGuide schemaFile="supabase/schema.sql, supabase/calendar_schema.sql" />
      </Shell>
    );
  }

  // 네이버 → 앱 동기화는 Vercel Cron(하루 1번, Hobby 요금제 제한)만으로는 너무 뜸해서,
  // 캘린더 페이지를 열 때마다 best-effort로 같이 돌립니다. 실패해도(네이버 지연/오류)
  // 페이지 자체는 로컬 데이터로 정상 표시됩니다.
  await syncNaverCalendars().catch((err) => console.error('[calendar] 방문 시 네이버 동기화 실패:', err));

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const { start, end } = monthGridRange(year, month);
  const [events, connectedCalendars] = await Promise.all([
    listEventsInRange(toYmd(start), toYmd(end)),
    listConnectedCalendars(),
  ]);

  return (
    <Shell activeMenu="통합 캘린더" title="📅 통합캘린더" note="IT팀 업무 일정">
      <CalendarPage
        initialYear={year}
        initialMonth={month}
        initialEvents={events}
        initialConnectedCalendars={connectedCalendars}
      />
    </Shell>
  );
}
