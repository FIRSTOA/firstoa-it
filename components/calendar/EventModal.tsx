'use client';

import { useEffect, useState } from 'react';
import { lookupKnownAsset } from '@/app/actions';
import {
  CALENDAR_STATUSES,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventItem,
  type NaverCalendarConnection,
} from '@/lib/calendar';
import { CATEGORIES } from '@/lib/types';

function blankInput(date: string, calendarId: string | null): CalendarEventInput {
  return {
    title: '',
    date,
    time: '',
    location: '',
    description: '',
    status: '진행중',
    author: '',
    important: false,
    items: [],
    calendarId,
  };
}

function blankItem(): CalendarEventItem {
  return { category: CATEGORIES[0], model: '', quantity: 1, assetId: '', note: '' };
}

type Props = {
  open: boolean;
  editing: CalendarEvent | null;
  defaultDate: string;
  connectedCalendars: NaverCalendarConnection[];
  pending: boolean;
  onClose: () => void;
  onSave: (input: CalendarEventInput) => void;
  onDelete?: () => void;
};

export default function EventModal({ open, editing, defaultDate, connectedCalendars, pending, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<CalendarEventInput>(() => blankInput(defaultDate, null));
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
        important: editing.important,
        items: editing.items,
        calendarId: editing.calendarId,
      });
      setAllDay(!editing.time);
    } else {
      setForm(blankInput(defaultDate, connectedCalendars[0]?.id ?? null));
      setAllDay(true);
    }
  }, [open, editing, defaultDate, connectedCalendars]);

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
            <label className="toggle" style={{ fontWeight: 600 }}>
              <input type="checkbox" checked={form.important} onChange={(e) => set('important', e.target.checked)} />
              ★ 중요
            </label>
          </div>
          <div className="form-field full">
            <label>네이버 캘린더</label>
            <select
              value={form.calendarId ?? ''}
              onChange={(e) => set('calendarId', e.target.value || null)}
            >
              <option value="">연결 안 함(앱에만 저장)</option>
              {connectedCalendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field full">
            <label>장소</label>
            <input value={form.location} onChange={(e) => set('location', e.target.value)} />
          </div>
          <div className="form-field full">
            <label>품목</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {form.items.map((item, idx) => (
                <ItemRow
                  key={idx}
                  item={item}
                  onChange={(next) => {
                    const items = [...form.items];
                    items[idx] = next;
                    set('items', items);
                  }}
                  onRemove={() => set('items', form.items.filter((_, i) => i !== idx))}
                />
              ))}
              <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => set('items', [...form.items, blankItem()])}>
                ＋ 라인 추가
              </button>
            </div>
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

function ItemRow({
  item,
  onChange,
  onRemove,
}: {
  item: CalendarEventItem;
  onChange: (next: CalendarEventItem) => void;
  onRemove: () => void;
}) {
  const [looking, setLooking] = useState(false);

  async function handleAssetBlur() {
    const assetId = item.assetId.trim();
    if (!assetId) return;
    setLooking(true);
    const result = await lookupKnownAsset(assetId);
    setLooking(false);
    if (!result.found) return;
    onChange({
      ...item,
      category: item.category || result.category,
      model: item.model || result.model,
    });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px 110px 1fr 28px', gap: '6px', alignItems: 'center' }}>
      <select value={item.category} onChange={(e) => onChange({ ...item, category: e.target.value })} style={{ fontSize: '12.5px' }}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        value={item.model}
        onChange={(e) => onChange({ ...item, model: e.target.value })}
        placeholder="품목명"
        style={{ fontSize: '12.5px' }}
      />
      <input
        type="number"
        min="1"
        value={item.quantity}
        onChange={(e) => onChange({ ...item, quantity: Number(e.target.value) || 1 })}
        style={{ fontSize: '12.5px' }}
      />
      <input
        value={item.assetId}
        onChange={(e) => onChange({ ...item, assetId: e.target.value })}
        onBlur={handleAssetBlur}
        placeholder={looking ? '조회 중…' : '자산번호'}
        style={{ fontSize: '12.5px' }}
      />
      <input
        value={item.note}
        onChange={(e) => onChange({ ...item, note: e.target.value })}
        placeholder="비고"
        style={{ fontSize: '12.5px' }}
      />
      <button type="button" className="icon-btn danger" onClick={onRemove} title="라인 삭제">
        ×
      </button>
    </div>
  );
}
