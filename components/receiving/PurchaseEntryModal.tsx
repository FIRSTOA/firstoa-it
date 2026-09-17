'use client';

import { useState } from 'react';
import type { ReceivingInput } from '@/lib/receiving';
import { CATEGORIES } from '@/lib/types';

type LineItem = {
  category: string;
  model: string;
  quantity: number;
  unitPrice: number;
};

const BLANK_LINE: LineItem = { category: CATEGORIES[0], model: '', quantity: 1, unitPrice: 0 };

type Props = {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (entries: ReceivingInput[]) => void;
};

/**
 * 실제 회사 ERP "구매입력" 화면(일자/거래처/담당자 + 품목/수량/단가/합계 줄)을 참고한
 * 간이 매입 전표 입력 폼입니다. 부가세 자동계산·결제주기/상태·거래명세서 첨부 같은 회계
 * 기능은 1차 구현 범위 밖이라 뺐습니다 — 저장하면 전표 자체를 따로 저장하지 않고, 줄마다
 * 수량만큼 펼쳐서 구매입고예정 건을 바로 만듭니다(createReceivingBatch 재사용).
 */
export default function PurchaseEntryModal({ open, pending, onClose, onSave }: Props) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState('');
  const [manager, setManager] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ ...BLANK_LINE }]);

  function reset() {
    setDate(new Date().toISOString().slice(0, 10));
    setVendor('');
    setManager('');
    setLines([{ ...BLANK_LINE }]);
  }

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...BLANK_LINE }]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const total = lines.reduce((sum, l) => sum + Math.max(l.quantity, 0) * Math.max(l.unitPrice, 0), 0);

  function handleSave() {
    if (!vendor.trim()) return;
    const validLines = lines.filter((l) => l.model.trim());
    if (validLines.length === 0) return;

    const entries: ReceivingInput[] = validLines.flatMap((line) => {
      const quantity = Math.max(Math.trunc(line.quantity) || 1, 1);
      const lineTotal = quantity * Math.max(line.unitPrice, 0);
      const base: Omit<ReceivingInput, 'assetId'> = {
        kind: '구매입고예정',
        status: '입고대기',
        category: line.category,
        brand: '',
        model: line.model.trim(),
        cpu: '',
        spec: '',
        ram: '',
        storage: '',
        screen: '',
        vendor: vendor.trim(),
        purchasePrice: `${line.unitPrice.toLocaleString()}원 x ${quantity} = ${lineTotal.toLocaleString()}원`,
        expectedDate: '',
        manager: manager.trim(),
        notes: `구매입력 전표 (일자: ${date})`,
        serialNumber: '',
        location: '',
      };
      return Array.from({ length: quantity }, () => ({ ...base, assetId: '' }));
    });

    onSave(entries);
  }

  if (!open) return null;

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) {
          reset();
          onClose();
        }
      }}
    >
      <div className="modal" style={{ width: '820px', maxWidth: '95vw' }}>
        <h2>구매입력</h2>
        <div className="sub">
          실제 매입 확정 전표예요 — 저장하면 아래 품목들이 그대로 구매입고예정 건으로 만들어져요.
        </div>
        <div className="form-grid">
          <div className="form-field">
            <label>일자</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="form-field">
            <label>
              거래처 <span className="required">*</span>
            </label>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="예: 다온디지털" />
          </div>
          <div className="form-field">
            <label>담당자</label>
            <input value={manager} onChange={(e) => setManager(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: '14px', overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>No</th>
                <th style={{ width: '140px' }}>품목</th>
                <th>품목명</th>
                <th style={{ width: '90px' }}>수량</th>
                <th style={{ width: '120px' }}>단가</th>
                <th style={{ width: '130px' }}>합계</th>
                <th style={{ width: '40px' }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <select value={line.category} onChange={(e) => updateLine(i, { category: e.target.value })}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={line.model}
                      onChange={(e) => updateLine(i, { model: e.target.value })}
                      placeholder="예: LS24D304GAKXKR"
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={line.unitPrice}
                      onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) || 0 })}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td style={{ fontSize: '13px', color: 'var(--ink-500)' }}>
                    {(Math.max(line.quantity, 0) * Math.max(line.unitPrice, 0)).toLocaleString()}원
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="줄 삭제"
                      disabled={lines.length <= 1}
                      onClick={() => removeLine(i)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
          <button type="button" className="btn btn-ghost" onClick={addLine}>
            + 행 추가
          </button>
          <div style={{ fontSize: '13px', fontWeight: 700 }}>합계 {total.toLocaleString()}원</div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={pending}
          >
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={pending}>
            {pending ? '저장 중…' : '전표 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
