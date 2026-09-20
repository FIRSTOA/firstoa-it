'use client';

import { useEffect, useState } from 'react';
import type { ConsumableInput } from '@/lib/consumables';

const FIELD_LABELS: Record<keyof ConsumableInput, string> = {
  gubun: '구분',
  spec: '사양',
  vendor: '매입처',
  purchasePrice: '구매단가',
  item: '품목',
  model: '모델명',
  manufacturer: '제조사',
  salePrice: '판매단가',
  margin: '마진',
  internetPrice: '인터넷가격',
};

const FIELD_ORDER: (keyof ConsumableInput)[] = [
  'gubun',
  'spec',
  'vendor',
  'purchasePrice',
  'item',
  'model',
  'manufacturer',
  'salePrice',
  'margin',
  'internetPrice',
];

type FormState = Record<keyof ConsumableInput, string>;

const BLANK_FORM: FormState = FIELD_ORDER.reduce((acc, key) => {
  acc[key] = '';
  return acc;
}, {} as FormState);

type Props = {
  open: boolean;
  pending: boolean;
  count: number;
  onClose: () => void;
  onSave: (patch: Partial<ConsumableInput>) => void;
};

/** 체크된 필드만 선택된 건들에 한꺼번에 적용합니다(체크 안 한 필드는 각 건 값 그대로 유지). */
export default function ConsumablesBulkEditModal({ open, pending, count, onClose, onSave }: Props) {
  const [enabled, setEnabled] = useState<Record<keyof ConsumableInput, boolean>>(
    () => FIELD_ORDER.reduce((acc, key) => ({ ...acc, [key]: false }), {} as Record<keyof ConsumableInput, boolean>),
  );
  const [form, setForm] = useState<FormState>(BLANK_FORM);

  useEffect(() => {
    if (open) {
      setEnabled(FIELD_ORDER.reduce((acc, key) => ({ ...acc, [key]: false }), {} as Record<keyof ConsumableInput, boolean>));
      setForm(BLANK_FORM);
    }
  }, [open]);

  if (!open) return null;

  const anyEnabled = FIELD_ORDER.some((key) => enabled[key]);

  function toggle(key: keyof ConsumableInput) {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function set(key: keyof ConsumableInput, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    const patch: Partial<ConsumableInput> = {};
    for (const key of FIELD_ORDER) {
      if (enabled[key]) patch[key] = form[key];
    }
    onSave(patch);
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div className="modal" style={{ width: '480px' }}>
        <h2>일괄 수정</h2>
        <div className="sub">선택한 {count}건에 체크한 항목만 같은 값으로 적용돼요. 나머지 값은 그대로 유지돼요.</div>

        <div style={{ display: 'grid', gap: '8px', marginTop: '14px', maxHeight: '55vh', overflowY: 'auto' }}>
          {FIELD_ORDER.map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100px', flexShrink: 0 }}>
                <input type="checkbox" checked={enabled[key]} onChange={() => toggle(key)} />
                <span style={{ fontSize: '12.5px', fontWeight: 700 }}>{FIELD_LABELS[key]}</span>
              </label>
              <div style={{ flex: 1 }}>
                <input value={form[key]} onChange={(e) => set(key, e.target.value)} disabled={!enabled[key]} />
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={pending || !anyEnabled}>
            {pending ? '적용 중…' : `${count}건에 적용`}
          </button>
        </div>
      </div>
    </div>
  );
}
