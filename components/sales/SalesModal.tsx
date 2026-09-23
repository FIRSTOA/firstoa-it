'use client';

import { useEffect, useState } from 'react';
import type { SaleEntry, SaleInput } from '@/lib/sales';

const BLANK: SaleInput = {
  purchaseVendor: '',
  purchasePrice: '',
  salePrice: '',
  model: '',
  spec: '',
  assetId: '',
  destination: '',
  saleDate: '',
  notes: '',
};

type Props = {
  open: boolean;
  editing: SaleEntry | null;
  pending: boolean;
  onClose: () => void;
  onSave: (entry: SaleInput) => void;
};

export default function SalesModal({ open, editing, pending, onClose, onSave }: Props) {
  const [form, setForm] = useState<SaleInput>(BLANK);

  useEffect(() => {
    if (open) setForm(editing ?? BLANK);
  }, [open, editing]);

  const set = <K extends keyof SaleInput>(key: K, value: SaleInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    onSave({
      purchaseVendor: form.purchaseVendor.trim(),
      purchasePrice: form.purchasePrice.trim(),
      salePrice: form.salePrice.trim(),
      model: form.model.trim(),
      spec: form.spec.trim(),
      assetId: form.assetId.trim(),
      destination: form.destination.trim(),
      saleDate: form.saleDate,
      notes: form.notes.trim(),
    });
  }

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="modal" style={{ width: '560px' }}>
        <h2>{editing ? '판매 건 수정' : '판매 등록'}</h2>
        <div className="sub">IT재고와 별도로 관리되는 판매 기록이에요.</div>
        <div className="form-grid">
          <div className="form-field full">
            <label>
              모델명 <span className="required">*</span>
            </label>
            <input value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="예: LG그램 15Z90T-GP7DL" />
          </div>
          <div className="form-field full">
            <label>스펙</label>
            <input
              value={form.spec}
              onChange={(e) => set('spec', e.target.value)}
              placeholder="예: 울트라7(S2)-255H/32GB/512GB/내장/15.6인치/윈11프로"
            />
          </div>
          <div className="form-field">
            <label>자산번호</label>
            <input value={form.assetId} onChange={(e) => set('assetId', e.target.value)} placeholder="예: P2400" />
          </div>
          <div className="form-field">
            <label>구매처</label>
            <input value={form.purchaseVendor} onChange={(e) => set('purchaseVendor', e.target.value)} />
          </div>
          <div className="form-field">
            <label>매입금액</label>
            <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} placeholder="예: 대당 220만원" />
          </div>
          <div className="form-field">
            <label>판매금액</label>
            <input value={form.salePrice} onChange={(e) => set('salePrice', e.target.value)} />
          </div>
          <div className="form-field">
            <label>위치(판매한 곳)</label>
            <input
              value={form.destination}
              onChange={(e) => set('destination', e.target.value)}
              placeholder="예: 영인에너지솔루션-상대원 본사"
            />
          </div>
          <div className="form-field">
            <label>판매일</label>
            <input type="date" value={form.saleDate} onChange={(e) => set('saleDate', e.target.value)} />
          </div>
          <div className="form-field full">
            <label>비고</label>
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="주소/담당자 등" />
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
