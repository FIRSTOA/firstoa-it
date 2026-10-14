'use client';

import { useState } from 'react';
import { lookupKnownAsset } from '@/app/actions';
import { registerDeliveryConfirmForm } from '@/app/confirmForm/actions';
import {
  blankDeliveryFormItem,
  DELIVERY_FORM_CATEGORIES,
  resizeUnits,
  type DeliveryConfirmFormInput,
  type DeliveryFormItem,
} from '@/lib/deliveryConfirmForm';

const BLANK: DeliveryConfirmFormInput = {
  company: '',
  orderDate: '',
  deliveryDate: '',
  department: '',
  inflowType: '',
  salesManager: '',
  requestManager: '',
  siteAddress: '',
  specialNotes: '',
  businessType: '',
  consumables: '',
  contractPeriod: '',
  deposit: '',
  paymentNotes: '',
  items: [blankDeliveryFormItem()],
};

export default function DeliveryConfirmFormEditor({ onRegistered }: { onRegistered: (msg: string) => void }) {
  const [form, setForm] = useState<DeliveryConfirmFormInput>(BLANK);
  const [saving, setSaving] = useState(false);
  const [lookupNote, setLookupNote] = useState('');

  function set<K extends keyof DeliveryConfirmFormInput>(key: K, value: DeliveryConfirmFormInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setItem(index: number, patch: Partial<DeliveryFormItem>) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));
  }

  function setQuantity(index: number, quantity: number) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) =>
        i === index ? { ...it, quantity, units: resizeUnits(it.units, quantity) } : it,
      ),
    }));
  }

  function setUnit(itemIndex: number, unitIndex: number, patch: Partial<{ assetId: string; serialNumber: string }>) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) =>
        i === itemIndex
          ? { ...it, units: it.units.map((u, j) => (j === unitIndex ? { ...u, ...patch } : u)) }
          : it,
      ),
    }));
  }

  function addItem() {
    setForm((prev) => ({ ...prev, items: [...prev.items, blankDeliveryFormItem()] }));
  }

  function removeItem(index: number) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  }

  // 자산번호를 입력하고 다른 칸으로 넘어가면 기존 데이터(IT재고 구글시트 → 임대리스트 순서)에서
  // 품목명/제조사/시리얼을 자동으로 채웁니다 — 이미 채워진 값은 덮어쓰지 않습니다
  // (ReceivingModal.handleAssetIdBlur와 동일한 원칙, 같은 lookupKnownAsset 재사용).
  async function handleAssetIdBlur(itemIndex: number, unitIndex: number) {
    const item = form.items[itemIndex];
    const unit = item.units[unitIndex];
    const assetId = unit.assetId.trim();
    if (!assetId) return;
    const result = await lookupKnownAsset(assetId);
    if (!result.found) {
      setLookupNote(`"${assetId}" 기존 데이터를 못 찾았어요 — 직접 입력해주세요.`);
      return;
    }
    setLookupNote(`"${assetId}" 기존 데이터에서 자동으로 채웠어요.`);
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) =>
        i === itemIndex
          ? {
              ...it,
              model: it.model || result.model,
              manufacturer: it.manufacturer || result.brand,
              units: it.units.map((u, j) =>
                j === unitIndex ? { ...u, serialNumber: u.serialNumber || result.serialNo } : u,
              ),
            }
          : it,
      ),
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await registerDeliveryConfirmForm(form);
      if (!result.ok) {
        onRegistered(result.error);
        return;
      }
      onRegistered(result.warning ?? '정식 납품확인서를 등록했어요 — 출고/접수 대장에도 반영됐어요.');
      setForm(BLANK);
      setLookupNote('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="form-grid">
        <div className="form-field">
          <label>
            상호 <span className="required">*</span>
          </label>
          <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="예: 대호건축-여의도 CGV 공사" />
        </div>
        <div className="form-field">
          <label>발주일</label>
          <input type="date" value={form.orderDate} onChange={(e) => set('orderDate', e.target.value)} />
        </div>
        <div className="form-field">
          <label>납품일</label>
          <input type="date" value={form.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} />
        </div>
        <div className="form-field">
          <label>부서/위치</label>
          <input value={form.department} onChange={(e) => set('department', e.target.value)} />
        </div>
        <div className="form-field">
          <label>유입구분</label>
          <input value={form.inflowType} onChange={(e) => set('inflowType', e.target.value)} placeholder="예: 신규/증설/이전" />
        </div>
        <div className="form-field">
          <label>영업담당자</label>
          <input value={form.salesManager} onChange={(e) => set('salesManager', e.target.value)} />
        </div>
        <div className="form-field">
          <label>요청담당자</label>
          <input value={form.requestManager} onChange={(e) => set('requestManager', e.target.value)} />
        </div>
        <div className="form-field">
          <label>업종</label>
          <input value={form.businessType} onChange={(e) => set('businessType', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>사업장주소</label>
          <input value={form.siteAddress} onChange={(e) => set('siteAddress', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>특이사항</label>
          <input value={form.specialNotes} onChange={(e) => set('specialNotes', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>소모품</label>
          <input value={form.consumables} onChange={(e) => set('consumables', e.target.value)} placeholder="예: 키보드마우스 5세트, 그외 듀얼 케이블" />
        </div>
        <div className="form-field">
          <label>계약기간</label>
          <input value={form.contractPeriod} onChange={(e) => set('contractPeriod', e.target.value)} placeholder="예: 약 2개월 (10/13~12/7)" />
        </div>
        <div className="form-field">
          <label>보증금</label>
          <input value={form.deposit} onChange={(e) => set('deposit', e.target.value)} placeholder="예: 무" />
        </div>
        <div className="form-field">
          <label>결제 특이사항</label>
          <input value={form.paymentNotes} onChange={(e) => set('paymentNotes', e.target.value)} />
        </div>
      </div>

      {lookupNote && <div className="sub" style={{ marginTop: '8px' }}>{lookupNote}</div>}

      <h3 style={{ fontSize: '14px', margin: '16px 0 8px' }}>품목</h3>
      {form.items.map((item, itemIndex) => (
        <div key={itemIndex} className="panel" style={{ marginBottom: '10px', background: 'var(--ink-50)' }}>
          <div className="form-grid">
            <div className="form-field">
              <label>구분</label>
              <select value={item.category} onChange={(e) => setItem(itemIndex, { category: e.target.value })}>
                {DELIVERY_FORM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>품목명 *</label>
              <input value={item.model} onChange={(e) => setItem(itemIndex, { model: e.target.value })} placeholder="예: I5-I7일설데(리퍼)" />
            </div>
            <div className="form-field">
              <label>제조사</label>
              <input value={item.manufacturer} onChange={(e) => setItem(itemIndex, { manufacturer: e.target.value })} />
            </div>
            <div className="form-field">
              <label>임대료/단가</label>
              <input value={item.unitPrice} onChange={(e) => setItem(itemIndex, { unitPrice: e.target.value })} placeholder="예: ₩100,000" />
            </div>
            <div className="form-field">
              <label>수량</label>
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => setQuantity(itemIndex, Number(e.target.value) || 1)}
              />
            </div>
            <div className="form-field full">
              <label>하드웨어스펙</label>
              <input
                value={item.hardwareSpec}
                onChange={(e) => setItem(itemIndex, { hardwareSpec: e.target.value })}
                placeholder="예: I5/12/16/512/2/1660S"
              />
            </div>
          </div>

          <table style={{ marginTop: '10px' }}>
            <thead>
              <tr>
                <th>No</th>
                <th>자산번호</th>
                <th>시리얼번호</th>
              </tr>
            </thead>
            <tbody>
              {item.units.map((unit, unitIndex) => (
                <tr key={unitIndex}>
                  <td>{unitIndex + 1}</td>
                  <td>
                    <input
                      className="inline-cell-input"
                      value={unit.assetId}
                      onChange={(e) => setUnit(itemIndex, unitIndex, { assetId: e.target.value })}
                      onBlur={() => handleAssetIdBlur(itemIndex, unitIndex)}
                      placeholder="예: X8226"
                    />
                  </td>
                  <td>
                    <input
                      className="inline-cell-input"
                      value={unit.serialNumber}
                      onChange={(e) => setUnit(itemIndex, unitIndex, { serialNumber: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button type="button" className="icon-btn danger" style={{ marginTop: '8px' }} onClick={() => removeItem(itemIndex)}>
            🗑 이 품목 삭제
          </button>
        </div>
      ))}
      <button type="button" className="chip" onClick={addItem}>
        ＋ 품목 추가
      </button>

      <div className="modal-footer" style={{ borderTop: 'none' }}>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '등록 중…' : '정식 납품확인서로 등록'}
        </button>
      </div>
    </div>
  );
}
