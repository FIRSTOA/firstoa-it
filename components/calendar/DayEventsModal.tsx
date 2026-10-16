'use client';

import type { CalendarEvent } from '@/lib/calendar';
import DayEventList from './DayEventList';

type Props = {
  open: boolean;
  dateLabel: string;
  events: CalendarEvent[];
  onClose: () => void;
  onToggleStatus: (ev: CalendarEvent) => void;
  onEdit: (ev: CalendarEvent) => void;
  onAddNew: () => void;
};

/** 날짜 칸을 눌렀을 때 뜨는 팝업 — 그 날 일정 전체를 한눈에 보여줍니다. */
export default function DayEventsModal({ open, dateLabel, events, onClose, onToggleStatus, onEdit, onAddNew }: Props) {
  if (!open) return null;

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '460px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ marginBottom: '2px' }}>{dateLabel}</h2>
            <div className="sub">{events.length}건의 일정</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div style={{ marginTop: '14px', maxHeight: '420px', overflowY: 'auto' }}>
          <DayEventList events={events} onToggleStatus={onToggleStatus} onEdit={onEdit} emptyMessage="이 날 일정이 없어요." />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onAddNew}>
            ＋ 이 날에 추가
          </button>
        </div>
      </div>
    </div>
  );
}
