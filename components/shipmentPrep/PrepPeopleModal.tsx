'use client';

import { useEffect, useState } from 'react';
import { savePrepPeople, type PrepPerson } from '@/app/shipment-prep/actions';

type Props = { open: boolean; people: PrepPerson[]; onClose: () => void; onSaved: () => void };

/** 준비 담당자 추가 · 제외(비활성) · 삭제 · 순서 — 원본 PrepPeopleModal 이식. */
export default function PrepPeopleModal({ open, people, onClose, onSaved }: Props) {
  const [list, setList] = useState<PrepPerson[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setList(people);
      setName('');
      setError('');
    }
  }, [open, people]);

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  }

  function add() {
    const n = name.trim();
    if (!n || list.some((p) => p.name === n)) return;
    setList([...list, { name: n, sortOrder: list.length, isActive: true }]);
    setName('');
  }

  async function save() {
    setSaving(true);
    const res = await savePrepPeople(list);
    setSaving(false);
    if (!res.ok) setError(res.error);
    else onSaved();
  }

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal" style={{ width: 420 }}>
        <h2>👥 준비 담당자 관리</h2>
        <div className="sub">리스트의 체크 칸과 네이버 제목 태그("이름준비중")에 쓰이는 이름이에요.</div>
        <div style={{ display: 'grid', gap: 6, margin: '12px 0' }}>
          {list.length === 0 && <div className="detail-empty">아직 담당자가 없어요.</div>}
          {list.map((p, i) => (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, fontWeight: 600, color: p.isActive ? undefined : 'var(--ink-400)' }}>
                {p.name}
                {!p.isActive && ' (제외)'}
              </span>
              <button type="button" className="icon-btn" onClick={() => move(i, -1)} title="위로">
                ↑
              </button>
              <button type="button" className="icon-btn" onClick={() => move(i, 1)} title="아래로">
                ↓
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setList(list.map((x, k) => (k === i ? { ...x, isActive: !x.isActive } : x)))}
              >
                {p.isActive ? '제외' : '다시 포함'}
              </button>
              <button type="button" className="icon-btn danger" onClick={() => setList(list.filter((_, k) => k !== i))} title="삭제">
                🗑
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="이름 (예: 손영근)"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-ghost" onClick={add} disabled={!name.trim()}>
            + 추가
          </button>
        </div>
        {error && <div style={{ color: 'var(--red-600)', fontSize: 12.5, marginTop: 6 }}>{error}</div>}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
