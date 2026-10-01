import { after } from 'next/server';
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
  // 캘린더 페이지를 열 때마다 같이 돌립니다. 다만 첫 동기화처럼 변경분이 많으면 느려질 수
  // 있어서 페이지 렌더링을 막지 않게 after()로 응답을 먼저 보낸 뒤 백그라운드로 돌립니다
  // (이번 방문엔 로컬 데이터만 보이고, 네이버 쪽 변경분은 다음 방문/새로고침에 반영됨).
  after(() => syncNaverCalendars().catch((err) => console.error('[calendar] 방문 시 네이버 동기화 실패:', err)));

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
