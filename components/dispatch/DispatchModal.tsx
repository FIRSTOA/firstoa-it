'use client';

import { useEffect, useState } from 'react';
import { DISPATCH_STATUSES, DISPATCH_TYPES, type DispatchEntry, type DispatchInput } from '@/lib/dispatch';

const BLANK: DispatchInput = {
  deliveryDate: '',
  receivedDate: '',
  receivedTime: '',
  startTime: '',
  endTime: '',
  status: '접수',
  receiver: '',
  processor: '',
  type: '납품',
  notes: '',
  company: '',
  contact: '',
  item: '',
  directSpec: '',
  assetId: '',
  remarks: '',
  serialNumber: '',
};

type Props = {
  open: boolean;
  editing: DispatchEntry | null;
  pending: boolean;
  onClose: () => void;
  onSave: (entry: DispatchInput) => void;
};

export default function DispatchModal({ open, editing, pending, onClose, onSave }: Props) {
  const [form, setForm] = useState<DispatchInput>(BLANK);

  useEffect(() => {
    if (open) setForm(editing ?? BLANK);
  }, [open, editing]);

  const set = <K extends keyof DispatchInput>(key: K, value: DispatchInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSave() {
    onSave({
      ...form,
      company: form.company.trim(),
      contact: form.contact.trim(),
      item: form.item.trim(),
      directSpec: form.directSpec.trim(),
      assetId: form.assetId.trim(),
      serialNumber: form.serialNumber.trim(),
      remarks: form.remarks.trim(),
      notes: form.notes.trim(),
      receiver: form.receiver.trim(),
      processor: form.processor.trim(),
      receivedTime: form.receivedTime.trim(),
      startTime: form.startTime.trim(),
      endTime: form.endTime.trim(),
    });
  }

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="modal" style={{ width: '600px' }}>
        <h2>{editing ? '접수 건 수정' : '출고/접수 등록'}</h2>
        <div className="sub">고객사 납품·교체·반출 접수 내용을 기록해요.</div>
        <div className="form-grid">
          <div className="form-field">
            <label>
              상호 <span className="required">*</span>
            </label>
            <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="예: 세안이엔씨" />
          </div>
          <div className="form-field">
            <label>연락처</label>
            <input
              value={form.contact}
              onChange={(e) => set('contact', e.target.value)}
              placeholder="예: 박성철 차장 010-0000-0000"
            />
          </div>
          <div className="form-field">
            <label>구분</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)}>
              {DISPATCH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>처리여부</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {DISPATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>납품/교체일</label>
            <input type="date" value={form.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} />
          </div>
          <div className="form-field">
            <label>접수일</label>
            <input type="date" value={form.receivedDate} onChange={(e) => set('receivedDate', e.target.value)} />
          </div>
          <div className="form-field">
            <label>접수시간</label>
            <input value={form.receivedTime} onChange={(e) => set('receivedTime', e.target.value)} placeholder="예: 16:32" />
          </div>
          <div className="form-field">
            <label>시작 / 종료</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input value={form.startTime} onChange={(e) => set('startTime', e.target.value)} placeholder="시작" />
              <input value={form.endTime} onChange={(e) => set('endTime', e.target.value)} placeholder="종료" />
            </div>
          </div>
          <div className="form-field">
            <label>접수자</label>
            <input value={form.receiver} onChange={(e) => set('receiver', e.target.value)} />
          </div>
          <div className="form-field">
            <label>처리자</label>
            <input value={form.processor} onChange={(e) => set('processor', e.target.value)} />
          </div>
          <div className="form-field">
            <label>자산번호</label>
            <input value={form.assetId} onChange={(e) => set('assetId', e.target.value)} placeholder="예: P2400" />
          </div>
          <div className="form-field">
            <label>시리얼번호</label>
            <input value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
          </div>
          <div className="form-field full">
            <label>품목</label>
            <input
              value={form.item}
              onChange={(e) => set('item', e.target.value)}
              placeholder="예: I7 고급설계/디자인 데탑(리퍼) (3대)"
            />
          </div>
          <div className="form-field full">
            <label>직송(사양 메모)</label>
            <input
              value={form.directSpec}
              onChange={(e) => set('directSpec', e.target.value)}
              placeholder="예: I7, 메모리 32GB 이상, SSD 500GB 이상"
            />
          </div>
          <div className="form-field full">
            <label>소모품/특이사항</label>
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
          <div className="form-field full">
            <label>비고</label>
            <input value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
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
