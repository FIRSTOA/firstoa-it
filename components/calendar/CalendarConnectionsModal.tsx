'use client';

import { useState } from 'react';
import {
  addConnectedCalendar,
  listAvailableNaverCalendars,
  removeConnectedCalendar,
  type NaverCalendarOption,
} from '@/app/calendar/actions';
import type { NaverCalendarConnection } from '@/lib/calendar';

type Props = {
  open: boolean;
  connected: NaverCalendarConnection[];
  pending: boolean;
  onClose: () => void;
  onChanged: () => void;
};

export default function CalendarConnectionsModal({ open, connected, pending, onClose, onChanged }: Props) {
  const [picking, setPicking] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [options, setOptions] = useState<NaverCalendarOption[]>([]);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!open) return null;

  const connectedIds = new Set(connected.map((c) => c.id));

  async function openPicker() {
    setPicking(true);
    setLoadingOptions(true);
    setLoadError('');
    const result = await listAvailableNaverCalendars();
    setLoadingOptions(false);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setOptions(result.calendars);
  }

  async function handleAdd(cal: NaverCalendarOption) {
    setBusyId(cal.id);
    await addConnectedCalendar(cal.id, cal.name);
    setBusyId(null);
    onChanged();
  }

  async function handleRemove(id: string) {
    if (!confirm('이 캘린더 연결을 해제할까요? (네이버 쪽 캘린더 자체는 지워지지 않아요)')) return;
    setBusyId(id);
    await removeConnectedCalendar(id);
    setBusyId(null);
    onChanged();
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div className="modal" style={{ width: '520px' }}>
        <h2>🔗 네이버 캘린더 연결 관리</h2>
        <div className="sub">여기 연결된 캘린더만 일정 등록 시 선택할 수 있고, 네이버 쪽 변경도 이 캘린더들만 확인해요.</div>

        <div style={{ display: 'grid', gap: '8px', marginTop: '14px' }}>
          {connected.length === 0 && (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              <div>🔗</div>
              <div>아직 연결된 캘린더가 없어요.</div>
            </div>
          )}
          {connected.map((cal) => (
            <div
              key={cal.id}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--ink-100)', borderRadius: '8px' }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{cal.name || cal.id}</span>
              <button
                type="button"
                className="icon-btn danger"
                title="연결 해제"
                disabled={busyId === cal.id}
                onClick={() => handleRemove(cal.id)}
              >
                🗑
              </button>
            </div>
          ))}
        </div>

        {!picking ? (
          <button type="button" className="btn btn-ghost" style={{ marginTop: '14px', width: '100%' }} onClick={openPicker}>
            ＋ 캘린더 추가
          </button>
        ) : (
          <div style={{ marginTop: '14px' }}>
            <div className="sub" style={{ marginBottom: '8px' }}>이 네이버 계정에서 보이는 캘린더 목록이에요.</div>
            {loadingOptions && <div className="loading-note">불러오는 중…</div>}
            {loadError && <div className="setup-alert">{loadError}</div>}
            <div style={{ display: 'grid', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
              {options.map((opt) => (
                <div
                  key={opt.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', border: '1px solid var(--ink-100)', borderRadius: '8px' }}
                >
                  <span style={{ fontSize: '13px' }}>{opt.name || opt.id}</span>
                  {connectedIds.has(opt.id) ? (
                    <span style={{ fontSize: '11.5px', color: 'var(--ink-400)' }}>연결됨</span>
                  ) : (
                    <button type="button" className="chip" disabled={busyId === opt.id} onClick={() => handleAdd(opt)}>
                      추가
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={pending}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
