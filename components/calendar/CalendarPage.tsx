'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createEvent, deleteEvent, listConnectedCalendars, listEventsInRange, updateEvent } from '@/app/calendar/actions';
import {
  CALENDAR_EVENT_KINDS,
  groupEventsByDate,
  monthGridRange,
  parseEventKind,
  toYmd,
  type CalendarEvent,
  type CalendarEventInput,
  type NaverCalendarConnection,
} from '@/lib/calendar';
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
  const [viewMode, setViewMode] = useState<'month' | 'list'>('month');
  const [searchTerm, setSearchTerm] = useState('');
  const [calendarFilter, setCalendarFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'전체' | '진행중' | '완료'>('전체');
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayYmd());

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

  const visibleEvents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return events.filter((e) => {
      if (calendarFilter && e.calendarId !== calendarFilter) return false;
      if (statusFilter !== '전체' && e.status !== statusFilter) return false;
      if (kindFilter && parseEventKind(e.title) !== kindFilter) return false;
      if (!term) return true;
      const hay = `${e.title} ${e.location} ${e.description} ${e.author}`.toLowerCase();
      return hay.includes(term);
    });
  }, [events, searchTerm, calendarFilter, statusFilter, kindFilter]);

  const statusCounts = useMemo(() => {
    const base = events.filter((e) => !calendarFilter || e.calendarId === calendarFilter);
    return {
      전체: base.length,
      진행중: base.filter((e) => e.status === '진행중').length,
      완료: base.filter((e) => e.status === '완료').length,
    };
  }, [events, calendarFilter]);

  const kindCounts = useMemo(() => {
    const base = events.filter((e) => !calendarFilter || e.calendarId === calendarFilter);
    const counts = new Map<string, number>();
    for (const k of CALENDAR_EVENT_KINDS) counts.set(k, base.filter((e) => parseEventKind(e.title) === k).length);
    return counts;
  }, [events, calendarFilter]);

  const eventsByDate = useMemo(() => groupEventsByDate(visibleEvents), [visibleEvents]);
  const calendarNameById = useMemo(
    () => new Map(connectedCalendars.map((c) => [c.id, c.name])),
    [connectedCalendars],
  );
  const selectedDayEvents = useMemo(() => eventsByDate.get(selectedDate) ?? [], [eventsByDate, selectedDate]);
  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
    return `${m}월 ${d}일 (${weekday})`;
  }, [selectedDate]);

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

      <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="chip-group">
          <button type="button" className={`chip${viewMode === 'month' ? ' active' : ''}`} onClick={() => setViewMode('month')}>
            월간
          </button>
          <button type="button" className={`chip${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>
            목록
          </button>
        </div>
        <div className="chip-group">
          <button type="button" className={`chip${!calendarFilter ? ' active' : ''}`} onClick={() => setCalendarFilter(null)}>
            전체
          </button>
          {connectedCalendars.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip${calendarFilter === c.id ? ' active' : ''}`}
              onClick={() => setCalendarFilter(calendarFilter === c.id ? null : c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="chip-group">
          {(['전체', '진행중', '완료'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s} ({statusCounts[s]})
            </button>
          ))}
        </div>
        <div className="chip-group">
          <button type="button" className={`chip${!kindFilter ? ' active' : ''}`} onClick={() => setKindFilter(null)}>
            유형 전체
          </button>
          {CALENDAR_EVENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${kindFilter === k ? ' active' : ''}`}
              onClick={() => setKindFilter(kindFilter === k ? null : k)}
            >
              {k} ({kindCounts.get(k) ?? 0})
            </button>
          ))}
        </div>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="제목/장소/설명 검색"
          style={{ minWidth: '200px' }}
        />
      </div>

      {viewMode === 'list' ? (
        <div className="panel" style={{ paddingTop: '6px' }}>
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>시간</th>
                <th>제목</th>
                <th>장소</th>
                <th>상태</th>
                <th>캘린더</th>
                <th>등록자</th>
              </tr>
            </thead>
            <tbody>
              {[...visibleEvents]
                .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
                .map((ev) => (
                  <tr key={ev.id} className="asset-id" onClick={() => openEdit(ev)} style={{ cursor: 'pointer' }}>
                    <td>{ev.date}</td>
                    <td>{ev.time || '종일'}</td>
                    <td>{ev.title}</td>
                    <td>{ev.location || '-'}</td>
                    <td>
                      <span className={`badge ${ev.status === '완료' ? 'badge-상품화완료' : 'badge-상품화준비중'}`}>
                        {ev.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px' }}>{ev.calendarId ? calendarNameById.get(ev.calendarId) ?? '-' : '-'}</td>
                    <td>{ev.author || '-'}</td>
                  </tr>
                ))}
              {visibleEvents.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    <div>📅</div>이 달에 조건에 맞는 일정이 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
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
                className={`calendar-day${inMonth ? '' : ' outside'}${ymd === today ? ' today' : ''}${ymd === selectedDate ? ' selected' : ''}`}
                onClick={() => setSelectedDate(ymd)}
                onDoubleClick={() => openCreate(ymd)}
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
                  {extra > 0 && (
                    <button
                      type="button"
                      className="calendar-event-more"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDate(ymd);
                      }}
                    >
                      +{extra}개 더
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {viewMode === 'month' && (
        <div className="panel" style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px' }}>
              {selectedDateLabel} · {selectedDayEvents.length}건
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => openCreate(selectedDate)}>
              ＋ 이 날에 추가
            </button>
          </div>
          {selectedDayEvents.length === 0 ? (
            <div className="detail-empty">이 날 일정이 없어요 — 날짜 칸을 두 번 누르거나 [이 날에 추가]를 눌러주세요.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {selectedDayEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className={`calendar-event-chip${ev.status === '완료' ? ' done' : ''}`}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => openEdit(ev)}
                >
                  {ev.time && <span className="calendar-event-time">{ev.time}</span>} {ev.title}
                  {ev.location && <span style={{ color: 'var(--ink-400)' }}> · {ev.location}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
