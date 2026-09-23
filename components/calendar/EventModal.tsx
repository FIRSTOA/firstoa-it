'use client';

import { useEffect, useState } from 'react';
import { CALENDAR_STATUSES, type CalendarEvent, type CalendarEventInput } from '@/lib/calendar';

function blankInput(date: string): CalendarEventInput {
  return { title: '', date, time: '', location: '', description: '', status: '진행중', author: '' };
}

type Props = {
  open: boolean;
  editing: CalendarEvent | null;
  defaultDate: string;
  pending: boolean;
  onClose: () => void;
  onSave: (input: CalendarEventInput) => void;
  onDelete?: () => void;
};

export default function EventModal({ open, editing, defaultDate, pending, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<CalendarEventInput>(() => blankInput(defaultDate));
  const [allDay, setAllDay] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        title: editing.title,
        date: editing.date,
        time: editing.time,
        location: editing.location,
        description: editing.description,
        status: editing.status,
        author: editing.author,
      });
      setAllDay(!editing.time);
    } else {
      setForm(blankInput(defaultDate));
      setAllDay(true);
    }
  }, [open, editing, defaultDate]);

  if (!open) return null;

  const set = <K extends keyof CalendarEventInput>(key: K, value: CalendarEventInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    onSave({ ...form, title: form.title.trim(), time: allDay ? '' : form.time });
  }

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="modal" style={{ width: '480px' }}>
        <h2>{editing ? '일정 수정' : '일정 추가'}</h2>
        <div className="form-grid">
          <div className="form-field full">
            <label>
              제목 <span className="required">*</span>
            </label>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 서버실 점검" />
          </div>
          <div className="form-field">
            <label>날짜</label>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div className="form-field">
            <label>시간</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label className="toggle" style={{ fontWeight: 400, fontSize: '12.5px' }}>
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                />
                종일
              </label>
              {!allDay && <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />}
            </div>
          </div>
          <div className="form-field">
            <label>상태</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {CALENDAR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>등록자</label>
            <input value={form.author} onChange={(e) => set('author', e.target.value)} />
          </div>
          <div className="form-field full">
            <label>장소</label>
            <input value={form.location} onChange={(e) => set('location', e.target.value)} />
          </div>
          <div className="form-field full">
            <label>설명</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              style={{
                width: '100%',
                fontFamily: 'inherit',
                fontSize: '13px',
                padding: '8px',
                border: '1px solid var(--ink-200)',
                borderRadius: '8px',
                resize: 'vertical',
              }}
            />
          </div>
        </div>
        <div className="modal-footer">
          {onDelete && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginRight: 'auto', color: 'var(--red-600)' }}
              onClick={onDelete}
              disabled={pending}
            >
              삭제
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={pending || !form.title.trim()}>
            {pending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
