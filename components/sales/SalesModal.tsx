'use client';

import { useEffect, useRef, useState } from 'react';
import { ocrExtractSaleInfo } from '@/app/sales/actions';
import { normalizeWonInput } from '@/lib/currency';
import type { SaleEntry, SaleInput } from '@/lib/sales';

const BLANK: SaleInput = {
  purchaseVendor: '',
  purchasePrice: '',
  salePrice: '',
  model: '',
  spec: '',
  assetId: '',
  serialNumber: '',
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

function readFileAsBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:image/jpeg;base64,AAAA..."
      const comma = result.indexOf(',');
      resolve({ base64: result.slice(comma + 1), mediaType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function SalesModal({ open, editing, pending, onClose, onSave }: Props) {
  const [form, setForm] = useState<SaleInput>(BLANK);
  const [ocrPending, setOcrPending] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(editing ?? BLANK);
      setOcrError('');
    }
  }, [open, editing]);

  const set = <K extends keyof SaleInput>(key: K, value: SaleInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function normalizePriceOnBlur(key: 'purchasePrice' | 'salePrice') {
    setForm((prev) => ({ ...prev, [key]: normalizeWonInput(prev[key]) }));
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrPending(true);
    setOcrError('');
    try {
      const { base64, mediaType } = await readFileAsBase64(file);
      const result = await ocrExtractSaleInfo(base64, mediaType);
      if (!result.ok) {
        setOcrError(result.error);
        return;
      }
      // 이미 입력된 값은 안 건드리고 빈 칸만 채웁니다.
      setForm((prev) => ({
        ...prev,
        model: prev.model || result.fields.model,
        spec: prev.spec || result.fields.spec,
        assetId: prev.assetId || result.fields.assetId,
        serialNumber: prev.serialNumber || result.fields.serialNumber,
      }));
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '사진을 읽는 중 오류가 났어요.');
    } finally {
      setOcrPending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleSave() {
    onSave({
      purchaseVendor: form.purchaseVendor.trim(),
      purchasePrice: form.purchasePrice.trim(),
      salePrice: form.salePrice.trim(),
      model: form.model.trim(),
      spec: form.spec.trim(),
      assetId: form.assetId.trim(),
      serialNumber: form.serialNumber.trim(),
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

        <div style={{ margin: '10px 0' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handlePhotoSelected}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending || ocrPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {ocrPending ? '사진 인식 중…' : '📷 사진으로 자동 입력(OCR)'}
          </button>
          {ocrError && <div style={{ fontSize: '12px', color: 'var(--red-600)', marginTop: '6px' }}>{ocrError}</div>}
        </div>

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
            <label>시리얼번호</label>
            <input value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
          </div>
          <div className="form-field">
            <label>구매처</label>
            <input value={form.purchaseVendor} onChange={(e) => set('purchaseVendor', e.target.value)} />
          </div>
          <div className="form-field">
            <label>매입금액</label>
            <input
              value={form.purchasePrice}
              onChange={(e) => set('purchasePrice', e.target.value)}
              onBlur={() => normalizePriceOnBlur('purchasePrice')}
              placeholder="예: 154만원 (자동으로 1,540,000원으로 정리돼요)"
            />
          </div>
          <div className="form-field">
            <label>판매금액</label>
            <input
              value={form.salePrice}
              onChange={(e) => set('salePrice', e.target.value)}
              onBlur={() => normalizePriceOnBlur('salePrice')}
            />
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
