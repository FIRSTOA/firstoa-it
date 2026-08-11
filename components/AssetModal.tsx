'use client';

import { useEffect, useState } from 'react';
import { BRANDS, CATEGORIES, CPUS, SPECS, STATUSES, type Asset } from '@/lib/types';

const BLANK: Asset = {
  assetId: '',
  category: '노트북',
  brand: '삼성',
  model: '',
  cpu: 'I5',
  spec: '사무용',
  ram: '',
  storage: '',
  screen: '',
  location: '',
  status: '상품화준비중',
  history: '',
  isNew: false,
  malicious: false,
};

type Props = {
  open: boolean;
  editing: Asset | null;
  pending: boolean;
  onClose: () => void;
  onSave: (asset: Asset) => void;
};

export default function AssetModal({ open, editing, pending, onClose, onSave }: Props) {
  const [form, setForm] = useState<Asset>(BLANK);

  // 모달을 열 때마다 수정 대상(또는 빈 값)으로 폼을 다시 채웁니다.
  useEffect(() => {
    if (open) setForm(editing ?? BLANK);
  }, [open, editing]);

  const set = <K extends keyof Asset>(key: K, value: Asset[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    onSave({
      ...form,
      assetId: form.assetId.trim(),
      model: form.model.trim(),
      ram: form.ram.trim(),
      storage: form.storage.trim(),
      screen: form.screen.trim() || '-',
      location: form.location.trim(),
      history: form.history.trim(),
    });
  }

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="modal">
        <h2>{editing ? '자산 수정' : '재고입력'}</h2>
        <div className="sub">신규 자산을 등록하면 목록과 통계에 바로 반영돼요.</div>
        <div className="form-grid">
          <div className="form-field">
            <label>
              자산번호 <span className="required">*</span>
            </label>
            <input
              value={form.assetId}
              disabled={!!editing}
              onChange={(e) => set('assetId', e.target.value)}
              placeholder="예: P2400"
            />
          </div>
          <div className="form-field">
            <label>
              품목 <span className="required">*</span>
            </label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>
              브랜드 <span className="required">*</span>
            </label>
            <select value={form.brand} onChange={(e) => set('brand', e.target.value)}>
              {BRANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>
              모델명 <span className="required">*</span>
            </label>
            <input
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="예: EliteBook 840 G7"
            />
          </div>
          <div className="form-field">
            <label>CPU종류</label>
            <select value={form.cpu} onChange={(e) => set('cpu', e.target.value)}>
              {CPUS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>사양분류</label>
            <select value={form.spec} onChange={(e) => set('spec', e.target.value)}>
              {SPECS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>RAM(GB)</label>
            <input value={form.ram} onChange={(e) => set('ram', e.target.value)} placeholder="예: 16" />
          </div>
          <div className="form-field">
            <label>저장용량(GB)</label>
            <input
              value={form.storage}
              onChange={(e) => set('storage', e.target.value)}
              placeholder="예: 256"
            />
          </div>
          <div className="form-field">
            <label>화면크기</label>
            <input
              value={form.screen}
              onChange={(e) => set('screen', e.target.value)}
              placeholder="예: 15.6인치"
            />
          </div>
          <div className="form-field">
            <label>위치</label>
            <input
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="예: J1"
            />
          </div>
          <div className="form-field">
            <label>
              상태 <span className="required">*</span>
            </label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>이력(건)</label>
            <input
              value={form.history}
              onChange={(e) => set('history', e.target.value)}
              placeholder="예: 1건 (없으면 비워두세요)"
            />
          </div>
          <div className="form-field full toggle-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.isNew}
                onChange={(e) => set('isNew', e.target.checked)}
              />{' '}
              새기기
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.malicious}
                onChange={(e) => set('malicious', e.target.checked)}
              />{' '}
              악성(불량)
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={pending}>
            {pending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
