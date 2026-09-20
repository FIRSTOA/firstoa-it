'use client';

import { useEffect, useState } from 'react';
import { BLANK_CONSUMABLE, type ConsumableInput, type ConsumableItem } from '@/lib/consumables';

type Props = {
  open: boolean;
  editing: ConsumableItem | null;
  pending: boolean;
  onClose: () => void;
  onSave: (entry: ConsumableInput) => void;
};

export default function ConsumableModal({ open, editing, pending, onClose, onSave }: Props) {
  const [form, setForm] = useState<ConsumableInput>(BLANK_CONSUMABLE);

  useEffect(() => {
    if (open) setForm(editing ?? BLANK_CONSUMABLE);
  }, [open, editing]);

  const set = <K extends keyof ConsumableInput>(key: K, value: ConsumableInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    onSave({
      gubun: form.gubun.trim(),
      spec: form.spec.trim(),
      vendor: form.vendor.trim(),
      purchasePrice: form.purchasePrice.trim(),
      item: form.item.trim(),
      model: form.model.trim(),
      manufacturer: form.manufacturer.trim(),
      salePrice: form.salePrice.trim(),
      margin: form.margin.trim(),
      internetPrice: form.internetPrice.trim(),
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
        <h2>{editing ? '소모품 수정' : '소모품 등록'}</h2>
        <div className="sub">구글시트 소모품구매판매 탭에 바로 반영돼요.</div>
        <div className="form-grid">
          <div className="form-field">
            <label>
              품목 <span className="required">*</span>
            </label>
            <input value={form.item} onChange={(e) => set('item', e.target.value)} placeholder="예: 공유기" />
          </div>
          <div className="form-field">
            <label>구분</label>
            <input value={form.gubun} onChange={(e) => set('gubun', e.target.value)} placeholder="예: 공유기" />
          </div>
          <div className="form-field">
            <label>사양</label>
            <input value={form.spec} onChange={(e) => set('spec', e.target.value)} placeholder="예: 무선 300M" />
          </div>
          <div className="form-field">
            <label>모델명</label>
            <input value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="예: N604SR" />
          </div>
          <div className="form-field">
            <label>제조사</label>
            <input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} placeholder="예: IPtime" />
          </div>
          <div className="form-field">
            <label>매입처</label>
            <input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="예: 고인돌" />
          </div>
          <div className="form-field">
            <label>구매단가</label>
            <input
              value={form.purchasePrice}
              onChange={(e) => set('purchasePrice', e.target.value)}
              placeholder="예: ₩ 18,480"
            />
          </div>
          <div className="form-field">
            <label>판매단가</label>
            <input value={form.salePrice} onChange={(e) => set('salePrice', e.target.value)} placeholder="예: ₩ 25,000" />
          </div>
          <div className="form-field">
            <label>마진</label>
            <input value={form.margin} onChange={(e) => set('margin', e.target.value)} placeholder="예: 26.08%" />
          </div>
          <div className="form-field">
            <label>인터넷가격</label>
            <input
              value={form.internetPrice}
              onChange={(e) => set('internetPrice', e.target.value)}
              placeholder="예: ₩ 22,000"
            />
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
