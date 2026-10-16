'use client';

import type { CalendarEvent } from '@/lib/calendar';

type Props = {
  events: CalendarEvent[];
  onToggleStatus: (ev: CalendarEvent) => void;
  onEdit: (ev: CalendarEvent) => void;
  emptyMessage: string;
};

/** 하루치 일정 목록 렌더링 — 월간 뷰의 날짜 팝업(DayEventsModal)과 "일간" 탭이 공유합니다. */
export default function DayEventList({ events, onToggleStatus, onEdit, emptyMessage }: Props) {
  if (events.length === 0) {
    return <div className="detail-empty">{emptyMessage}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {events.map((ev) => (
        <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={ev.status === '완료'} onChange={() => onToggleStatus(ev)} title="완료 체크" />
          <button
            type="button"
            className={`calendar-event-chip${ev.status === '완료' ? ' done' : ''}`}
            style={{ flex: 1, textAlign: 'left' }}
            onClick={() => onEdit(ev)}
          >
            {ev.time && <span className="calendar-event-time">{ev.time}</span>} {ev.important && '⭐ '}
            {ev.title}
            {ev.location && <span style={{ color: 'var(--ink-400)' }}> · {ev.location}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
