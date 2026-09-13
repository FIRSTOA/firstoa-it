'use client';

import { useEffect, useMemo, useState } from 'react';
import { lookupRentalAsset } from '@/app/actions';
import type { DataSource } from '@/lib/dataSource';
import { parseLocationStatus_ } from '@/lib/inventory/status';
import { BRANDS, CATEGORIES, SPECS, STATUSES, type Asset } from '@/lib/types';

const BLANK: Asset = {
  assetId: '',
  category: '노트북',
  brand: '삼성',
  model: '',
  cpu: '',
  spec: '사무용',
  ram: '',
  storage: '',
  screen: '',
  location: '',
  status: '상품화준비중',
  history: '',
  isNew: false,
  malicious: false,
  serialNo: '',
};

type RentalLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; specHint: string }
  | { status: 'not-found' };

type Props = {
  open: boolean;
  editing: Asset | null;
  pending: boolean;
  dataSource: DataSource;
  onClose: () => void;
  onSave: (asset: Asset) => void;
};

export default function AssetModal({ open, editing, pending, dataSource, onClose, onSave }: Props) {
  const [form, setForm] = useState<Asset>(BLANK);
  const [rentalLookup, setRentalLookup] = useState<RentalLookupState>({ status: 'idle' });

  // 모달을 열 때마다 수정 대상(또는 빈 값)으로 폼을 다시 채웁니다.
  useEffect(() => {
    if (open) {
      setForm(editing ?? BLANK);
      setRentalLookup({ status: 'idle' });
    }
  }, [open, editing]);

  const set = <K extends keyof Asset>(key: K, value: Asset[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // 구글시트 소스일 때는 "상태"가 별도 컬럼이 아니라 위치값에서 파생되므로,
  // 위치를 입력하는 대로 실시간으로 예상 상태를 미리 보여줍니다 (저장은 안 함).
  const derivedStatus = useMemo(
    () => parseLocationStatus_(form.location, form.category, form.history).status,
    [form.location, form.category, form.history],
  );

  // 신규 등록 시 자산번호를 입력하고 다른 칸으로 넘어가면 임대리스트(구글시트)에서
  // 모델명/시리얼을 찾아 자동으로 채워줍니다. 수정 모드에서는 자산번호가 잠겨 있어 동작하지 않습니다.
  async function handleAssetIdBlur() {
    if (editing) return;
    const assetId = form.assetId.trim();
    if (!assetId) {
      setRentalLookup({ status: 'idle' });
      return;
    }
    setRentalLookup({ status: 'loading' });
    const result = await lookupRentalAsset(assetId);
    if (!result.found) {
      setRentalLookup({ status: 'not-found' });
      return;
    }
    setForm((prev) => ({
      ...prev,
      model: result.model || prev.model,
      serialNo: result.serialNo || prev.serialNo,
    }));
    setRentalLookup({ status: 'found', specHint: result.specHint ?? '' });
  }

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
      serialNo: form.serialNo.trim(),
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
              onBlur={handleAssetIdBlur}
              placeholder="예: P2400"
            />
            {!editing && rentalLookup.status !== 'idle' && (
              <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>
                {rentalLookup.status === 'loading' && '임대리스트 조회 중…'}
                {rentalLookup.status === 'not-found' &&
                  '임대리스트에서 못 찾았어요 — 직접 입력해주세요.'}
                {rentalLookup.status === 'found' &&
                  `임대리스트에서 모델명/시리얼을 채웠어요.${
                    rentalLookup.specHint ? ` (${rentalLookup.specHint})` : ''
                  }`}
              </div>
            )}
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
            <input
              value={form.cpu}
              onChange={(e) => set('cpu', e.target.value)}
              placeholder="예: i7-1165G7"
            />
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
            {dataSource === 'sheets' && (
              <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>
                예상 상태: {derivedStatus} (구글시트에는 상태 컬럼이 따로 없어서 위치값으로 자동
                계산돼요 — 저장되는 값 아님)
              </div>
            )}
          </div>
          {dataSource === 'supabase' && (
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
          )}
          <div className="form-field">
            <label>시리얼번호</label>
            <input
              value={form.serialNo}
              onChange={(e) => set('serialNo', e.target.value)}
              placeholder="예: 5CG0444MXO"
            />
          </div>
          <div className="form-field">
            <label>{dataSource === 'sheets' ? '이력(비고)' : '이력(건)'}</label>
            <input
              value={form.history}
              onChange={(e) => set('history', e.target.value)}
              placeholder={
                dataSource === 'sheets' ? '예: 26.05.06 고객사명 / 새기기' : '예: 1건 (없으면 비워두세요)'
              }
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
