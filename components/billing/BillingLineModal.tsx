'use client';

import { useEffect, useState } from 'react';
import { lookupKnownAsset } from '@/app/actions';
import { BILLING_STATUSES, type BillingLine, type BillingLineInput } from '@/lib/billing';
import { normalizeWonInput } from '@/lib/currency';

const BLANK: BillingLineInput = {
  sourceInvoiceId: '',
  sourceLineId: '',
  assetId: '',
  rentalSheetRow: null,
  vendorName: '',
  billingDate: '',
  periodStart: '',
  periodEnd: '',
  amount: 0,
  status: '확정',
  allocationStatus: 'confirmed',
  note: '',
};

type Props = {
  open: boolean;
  editing: BillingLine | null;
  pending: boolean;
  onClose: () => void;
  onSave: (input: BillingLineInput) => void;
};

export default function BillingLineModal({ open, editing, pending, onClose, onSave }: Props) {
  const [form, setForm] = useState<BillingLineInput>(BLANK);
  const [amountText, setAmountText] = useState('');
  const [lookupMsg, setLookupMsg] = useState('');

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          sourceInvoiceId: editing.sourceInvoiceId,
          sourceLineId: editing.sourceLineId,
          assetId: editing.assetId,
          rentalSheetRow: editing.rentalSheetRow,
          vendorName: editing.vendorName,
          billingDate: editing.billingDate,
          periodStart: editing.periodStart,
          periodEnd: editing.periodEnd,
          amount: editing.amount,
          status: editing.status,
          allocationStatus: editing.allocationStatus,
          note: editing.note,
        });
        setAmountText(String(editing.amount));
      } else {
        setForm(BLANK);
        setAmountText('');
      }
      setLookupMsg('');
    }
  }, [open, editing]);

  const set = <K extends keyof BillingLineInput>(key: K, value: BillingLineInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleAssetIdBlur() {
    const assetId = (form.assetId ?? '').trim();
    if (!assetId || form.vendorName.trim()) return; // 거래처가 이미 있으면 덮어쓰지 않음
    const result = await lookupKnownAsset(assetId);
    setLookupMsg(result.found ? `${assetId} 자산을 찾았어요(${result.category}·${result.model}).` : `${assetId}을(를) 찾지 못했어요 — 자산번호를 확인해주세요.`);
  }

  function handleSave() {
    const assetId = (form.assetId ?? '').trim();
    onSave({
      ...form,
      assetId: assetId || null,
      allocationStatus: assetId ? 'confirmed' : 'needs_review',
      amount: Number(amountText.replace(/[^0-9.-]/g, '')) || 0,
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
        <h2>{editing ? '청구 명세 수정' : '청구 명세 추가'}</h2>
        <div className="sub">자산번호를 비워두면 "배분 확인 필요"로 저장돼요.</div>
        <div className="form-grid">
          <div className="form-field">
            <label>자산번호</label>
            <input
              value={form.assetId ?? ''}
              onChange={(e) => set('assetId', e.target.value)}
              onBlur={handleAssetIdBlur}
              placeholder="예: X8420"
            />
            {lookupMsg && <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>{lookupMsg}</div>}
          </div>
          <div className="form-field">
            <label>거래처</label>
            <input value={form.vendorName} onChange={(e) => set('vendorName', e.target.value)} placeholder="예: 주식회사 유디임팩트" />
          </div>
          <div className="form-field">
            <label>
              청구일 <span className="required">*</span>
            </label>
            <input type="date" value={form.billingDate} onChange={(e) => set('billingDate', e.target.value)} />
          </div>
          <div className="form-field">
            <label>대상기간 시작</label>
            <input type="date" value={form.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
          </div>
          <div className="form-field">
            <label>대상기간 끝</label>
            <input type="date" value={form.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
          </div>
          <div className="form-field">
            <label>청구번호</label>
            <input value={form.sourceInvoiceId} onChange={(e) => set('sourceInvoiceId', e.target.value)} placeholder="원본 전표 식별자(선택)" />
          </div>
          <div className="form-field">
            <label>
              금액 <span className="required">*</span>
            </label>
            <input
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={() => setAmountText(normalizeWonInput(amountText))}
              placeholder="예: 300000 (조정/감액은 음수로)"
            />
          </div>
          <div className="form-field">
            <label>상태</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {BILLING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field full">
            <label>비고</label>
            <input value={form.note} onChange={(e) => set('note', e.target.value)} />
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
