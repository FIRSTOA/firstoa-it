'use client';

import { useEffect, useState } from 'react';
import { RECEIVING_KINDS, RECEIVING_STATUSES, type ReceivingInput } from '@/lib/receiving';
import { CATEGORIES, SPECS } from '@/lib/types';

/** 일괄 수정 대상 필드 — 자산번호/시리얼번호는 건마다 달라야 해서 뺐습니다. */
type BulkField = Exclude<keyof ReceivingInput, 'assetId' | 'serialNumber'>;

const FIELD_LABELS: Record<BulkField, string> = {
  kind: '유형',
  status: '상태',
  category: '품목',
  brand: '브랜드',
  model: '모델명',
  cpu: 'CPU종류',
  spec: '사양분류',
  ram: 'RAM(GB)',
  storage: '저장용량(GB)',
  screen: '화면크기',
  vendor: '발주처',
  purchasePrice: '매입가',
  expectedDate: '예상입고일',
  manager: '담당자',
  location: '위치',
  notes: '비고',
};

const FIELD_ORDER: BulkField[] = [
  'kind',
  'status',
  'category',
  'brand',
  'model',
  'cpu',
  'spec',
  'ram',
  'storage',
  'screen',
  'vendor',
  'purchasePrice',
  'expectedDate',
  'manager',
  'location',
  'notes',
];

type FormState = Record<BulkField, string>;

const BLANK_FORM: FormState = FIELD_ORDER.reduce((acc, key) => {
  acc[key] = '';
  return acc;
}, {} as FormState);

type Props = {
  open: boolean;
  pending: boolean;
  count: number;
  onClose: () => void;
  onSave: (patch: Partial<ReceivingInput>) => void;
};

/**
 * 체크된 필드만 선택된 건들에 한꺼번에 적용합니다(체크 안 한 필드는 각 건 값 그대로 유지).
 * 자산번호/시리얼번호처럼 건마다 달라야 하는 값은 대상에서 뺐습니다.
 */
export default function BulkEditModal({ open, pending, count, onClose, onSave }: Props) {
  const [enabled, setEnabled] = useState<Record<BulkField, boolean>>(
    () => FIELD_ORDER.reduce((acc, key) => ({ ...acc, [key]: false }), {} as Record<BulkField, boolean>),
  );
  const [form, setForm] = useState<FormState>(BLANK_FORM);

  useEffect(() => {
    if (open) {
      setEnabled(FIELD_ORDER.reduce((acc, key) => ({ ...acc, [key]: false }), {} as Record<BulkField, boolean>));
      setForm(BLANK_FORM);
    }
  }, [open]);

  if (!open) return null;

  const anyEnabled = FIELD_ORDER.some((key) => enabled[key]);

  function toggle(key: BulkField) {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function set(key: BulkField, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    const patch: Partial<ReceivingInput> = {};
    for (const key of FIELD_ORDER) {
      if (enabled[key]) (patch as Record<string, string>)[key] = form[key];
    }
    onSave(patch);
  }

  function renderInput(key: BulkField) {
    if (key === 'kind') {
      return (
        <select value={form.kind} onChange={(e) => set('kind', e.target.value)} disabled={!enabled.kind}>
          {RECEIVING_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      );
    }
    if (key === 'status') {
      return (
        <select value={form.status} onChange={(e) => set('status', e.target.value)} disabled={!enabled.status}>
          {RECEIVING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }
    if (key === 'category') {
      return (
        <select value={form.category} onChange={(e) => set('category', e.target.value)} disabled={!enabled.category}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    }
    if (key === 'spec') {
      return (
        <select value={form.spec} onChange={(e) => set('spec', e.target.value)} disabled={!enabled.spec}>
          <option value="">(미정)</option>
          {SPECS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }
    if (key === 'expectedDate') {
      return (
        <input
          type="date"
          value={form.expectedDate}
          onChange={(e) => set('expectedDate', e.target.value)}
          disabled={!enabled.expectedDate}
        />
      );
    }
    return <input value={form[key]} onChange={(e) => set(key, e.target.value)} disabled={!enabled[key]} />;
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div className="modal" style={{ width: '560px' }}>
        <h2>일괄 수정</h2>
        <div className="sub">선택한 {count}건에 체크한 항목만 같은 값으로 적용돼요. 나머지 값은 그대로 유지돼요.</div>

        <div style={{ display: 'grid', gap: '8px', marginTop: '14px', maxHeight: '55vh', overflowY: 'auto' }}>
          {FIELD_ORDER.map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '110px', flexShrink: 0 }}>
                <input type="checkbox" checked={enabled[key]} onChange={() => toggle(key)} />
                <span style={{ fontSize: '12.5px', fontWeight: 700 }}>{FIELD_LABELS[key]}</span>
              </label>
              <div style={{ flex: 1 }}>{renderInput(key)}</div>
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
