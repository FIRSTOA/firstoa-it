'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createEvent, deleteEvent, listConnectedCalendars, listEventsInRange, updateEvent } from '@/app/calendar/actions';
import { groupEventsByDate, monthGridRange, toYmd, type CalendarEvent, type CalendarEventInput, type NaverCalendarConnection } from '@/lib/calendar';
import CalendarConnectionsModal from './CalendarConnectionsModal';
import EventModal from './EventModal';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

type Props = {
  initialYear: number;
  initialMonth: number;
  initialEvents: CalendarEvent[];
  initialConnectedCalendars: NaverCalendarConnection[];
};

function todayYmd(): string {
  return toYmd(new Date());
}

export default function CalendarPage({ initialYear, initialMonth, initialEvents, initialConnectedCalendars }: Props) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [events, setEvents] = useState(initialEvents);
  const [connectedCalendars, setConnectedCalendars] = useState(initialConnectedCalendars);
  const [modalOpen, setModalOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<string>(todayYmd());
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();

  function refetchConnectedCalendars() {
    startTransition(async () => {
      setConnectedCalendars(await listConnectedCalendars());
    });
  }

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }
  function closeToast() {
    setToast((t) => ({ ...t, show: false }));
  }

  const { start, end } = useMemo(() => monthGridRange(year, month), [year, month]);

  useEffect(() => {
    // 최초 로드는 서버에서 이미 받아온 initialEvents를 쓰고, 월이 바뀔 때만 다시 조회합니다.
    if (year === initialYear && month === initialMonth) return;
    let cancelled = false;
    startTransition(async () => {
      const fresh = await listEventsInRange(toYmd(start), toYmd(end));
      if (!cancelled) setEvents(fresh);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  function refetch() {
    startTransition(async () => {
      const fresh = await listEventsInRange(toYmd(start), toYmd(end));
      setEvents(fresh);
    });
  }

  const days = useMemo(() => {
    const list: Date[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      list.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return list;
  }, [start, end]);

  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

  function goToday() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
  }
  function goPrev() {
    const d = new Date(year, month - 2, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }
  function goNext() {
    const d = new Date(year, month, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  function openCreate(date: string) {
    setEditing(null);
    setDefaultDate(date);
    setModalOpen(true);
  }
  function openEdit(event: CalendarEvent) {
    setEditing(event);
    setModalOpen(true);
  }

  function handleSave(input: CalendarEventInput) {
    const target = editing;
    startTransition(async () => {
      const result = target ? await updateEvent(target.id, input) : await createEvent(input);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setModalOpen(false);
      setEditing(null);
      showToast(target ? '수정했어요.' : '등록했어요.');
      refetch();
    });
  }

  function handleDelete(id: string) {
    if (!confirm('이 일정을 삭제할까요?')) return;
    startTransition(async () => {
      const result = await deleteEvent(id);
      if (result.ok) {
        setModalOpen(false);
        setEditing(null);
      }
      showToast(result.ok ? '삭제했어요.' : result.error);
      refetch();
    });
  }

  const today = todayYmd();

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={goToday} disabled={pending}>
            오늘
          </button>
          <button type="button" className="btn btn-ghost" onClick={goPrev} disabled={pending} aria-label="이전 달">
            ‹
          </button>
          <button type="button" className="btn btn-ghost" onClick={goNext} disabled={pending} aria-label="다음 달">
            ›
          </button>
          <div className="meta" style={{ fontSize: '15px', fontWeight: 700, marginLeft: '6px' }}>
            {year}년 {month}월
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConnectionsOpen(true)}>
            🔗 캘린더 연결
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => openCreate(today)}>
            ＋ 일정 추가
          </button>
        </div>
      </div>

      <div className="panel calendar-panel">
        <div className="calendar-weekday-row">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`calendar-weekday${i === 0 ? ' sun' : ''}${i === 6 ? ' sat' : ''}`}>
              {w}
            </div>
          ))}
        </div>
        <div className="calendar-grid">
          {days.map((d) => {
            const ymd = toYmd(d);
            const inMonth = d.getMonth() + 1 === month;
            const dayEvents = eventsByDate.get(ymd) ?? [];
            const visible = dayEvents.slice(0, 4);
            const extra = dayEvents.length - visible.length;
            return (
              <div
                key={ymd}
                className={`calendar-day${inMonth ? '' : ' outside'}${ymd === today ? ' today' : ''}`}
                onClick={() => openCreate(ymd)}
              >
                <div className="calendar-day-number">{d.getDate()}</div>
                <div className="calendar-day-events">
                  {visible.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      className={`calendar-event-chip${ev.status === '완료' ? ' done' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(ev);
                      }}
                      title={ev.title}
                    >
                      {ev.time && <span className="calendar-event-time">{ev.time}</span>} {ev.title}
                    </button>
                  ))}
                  {extra > 0 && <div className="calendar-event-more">+{extra}개 더</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <EventModal
        open={modalOpen}
        editing={editing}
        defaultDate={defaultDate}
        connectedCalendars={connectedCalendars}
        pending={pending}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        onDelete={editing ? () => handleDelete(editing.id) : undefined}
      />

      <CalendarConnectionsModal
        open={connectionsOpen}
        connected={connectedCalendars}
        pending={pending}
        onClose={() => setConnectionsOpen(false)}
        onChanged={refetchConnectedCalendars}
      />

      <div className={`toast${toast.show ? ' show' : ''}`}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={closeToast} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
