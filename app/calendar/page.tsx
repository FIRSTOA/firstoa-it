import CalendarPage from '@/components/calendar/CalendarPage';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { monthGridRange, toYmd } from '@/lib/calendar';
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
