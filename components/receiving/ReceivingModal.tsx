'use client';

import { useEffect, useState } from 'react';
import { lookupRentalAsset } from '@/app/actions';
import { RECEIVING_KINDS, type ReceivingEntry, type ReceivingInput } from '@/lib/receiving';
import { CATEGORIES, SPECS } from '@/lib/types';

const BLANK: ReceivingInput = {
  kind: '구매입고예정',
  status: '입고대기',
  category: CATEGORIES[0],
  brand: '',
  model: '',
  cpu: '',
  spec: '',
  ram: '',
  storage: '',
  screen: '',
  vendor: '',
  expectedDate: '',
  manager: '',
  notes: '',
  assetId: '',
  serialNumber: '',
  location: '',
};

type RentalLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; specHint: string }
  | { status: 'not-found' };

type Props = {
  open: boolean;
  editing: ReceivingEntry | null;
  pending: boolean;
  onClose: () => void;
  onSave: (entry: ReceivingInput, quantity: number) => void;
};

export default function ReceivingModal({ open, editing, pending, onClose, onSave }: Props) {
  const [form, setForm] = useState<ReceivingInput>(BLANK);
  const [quantity, setQuantity] = useState(1);
  const [rentalLookup, setRentalLookup] = useState<RentalLookupState>({ status: 'idle' });

  useEffect(() => {
    if (open) {
      setForm(editing ?? BLANK);
      setQuantity(1);
      setRentalLookup({ status: 'idle' });
    }
  }, [open, editing]);

  const set = <K extends keyof ReceivingInput>(key: K, value: ReceivingInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // 렌탈입고예정: 자산번호만 입력하면 임대리스트(구글시트)에서 모델명/시리얼/사양을 자동으로
  // 채워줍니다 — AssetModal.tsx의 handleAssetIdBlur와 동일한 조회를 재사용합니다.
  async function handleAssetIdBlur() {
    if (form.kind !== '렌탈입고예정') return;
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
      serialNumber: result.serialNo || prev.serialNumber,
    }));
    setRentalLookup({ status: 'found', specHint: result.specHint ?? '' });
  }

  function handleSave() {
    onSave(
      {
        ...form,
        brand: form.brand.trim(),
        model: form.model.trim(),
        cpu: form.cpu.trim(),
        ram: form.ram.trim(),
        storage: form.storage.trim(),
        screen: form.screen.trim(),
        vendor: form.vendor.trim(),
        manager: form.manager.trim(),
        notes: form.notes.trim(),
        assetId: form.assetId.trim(),
        serialNumber: form.serialNumber.trim(),
        location: form.location.trim(),
      },
      quantity,
    );
  }

  const isRental = form.kind === '렌탈입고예정';

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="modal" style={{ width: '600px' }}>
        <h2>{editing ? '입고 건 수정' : '입고 등록'}</h2>
        <div className="sub">구매입고예정 또는 렌탈입고예정 건을 등록해요.</div>
        <div className="form-grid">
          <div className="form-field">
            <label>
              유형 <span className="required">*</span>
            </label>
            <select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              {RECEIVING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
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
              자산번호{isRental && <span className="required"> *</span>}
            </label>
            <input
              value={form.assetId}
              onChange={(e) => set('assetId', e.target.value)}
              onBlur={handleAssetIdBlur}
              placeholder="예: P2400"
            />
            {isRental && rentalLookup.status !== 'idle' && (
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
            <label>브랜드</label>
            <input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="예: HP" />
          </div>
          <div className="form-field">
            <label>모델명{!isRental && <span className="required"> *</span>}</label>
            <input
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="예: EliteBook 840 G7"
            />
          </div>
          <div className="form-field">
            <label>CPU종류</label>
            <input value={form.cpu} onChange={(e) => set('cpu', e.target.value)} placeholder="예: i7-1165G7" />
          </div>
          <div className="form-field">
            <label>사양분류</label>
            <select value={form.spec} onChange={(e) => set('spec', e.target.value)}>
              <option value="">(미정)</option>
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
            <input value={form.storage} onChange={(e) => set('storage', e.target.value)} placeholder="예: 256" />
          </div>
          <div className="form-field">
            <label>화면크기</label>
            <input value={form.screen} onChange={(e) => set('screen', e.target.value)} placeholder="예: 15.6인치" />
          </div>
          <div className="form-field">
            <label>시리얼번호</label>
            <input value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
          </div>

          {!isRental && (
            <div className="form-field">
              <label>발주처</label>
              <input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="예: 다온디지털" />
            </div>
          )}
          <div className="form-field">
            <label>예상입고일</label>
            <input type="date" value={form.expectedDate} onChange={(e) => set('expectedDate', e.target.value)} />
          </div>
          <div className="form-field">
            <label>담당자</label>
            <input value={form.manager} onChange={(e) => set('manager', e.target.value)} />
          </div>
          <div className="form-field">
            <label>위치</label>
            <input
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="예: J1 (입고완료 처리 시 필요)"
            />
          </div>
          {!editing && !isRental && (
            <div className="form-field">
              <label>수량</label>
              <input
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              />
              <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>
                같은 내용으로 {quantity}건을 한 번에 등록해요.
              </div>
            </div>
          )}
          <div className="form-field full">
            <label>비고</label>
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
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
