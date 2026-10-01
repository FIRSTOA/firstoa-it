'use client';

import { useRef, useState } from 'react';
import { ocrScanConfirmFormImage, ocrScanConfirmFormText, registerConfirmForm } from '@/app/confirmForm/actions';
import { CONFIRM_FORM_TABS, type ConfirmFormTab } from '@/lib/confirmForm';
import type { DispatchEntry } from '@/lib/dispatch';
import type { WithdrawalFormFields, WithdrawalFormItem } from '@/lib/ocr';
import { CATEGORIES } from '@/lib/types';

const PC_ITEMS = ['모니터', '데스크탑', '노트북'];

const BLANK_FIELDS: WithdrawalFormFields = { companyName: '', date: '', requester: '', reason: '', items: [] };
const BLANK_ITEM: WithdrawalFormItem = { category: CATEGORIES[0], model: '', serialNumber: '', assetId: '' };

function readFileAsBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve({ base64: result.slice(comma + 1), mediaType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function ConfirmFormPage({ initialEntries: entries }: { initialEntries: DispatchEntry[] }) {
  const [tab, setTab] = useState<ConfirmFormTab>('철수');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'pc' | string>('all');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [fields, setFields] = useState<WithdrawalFormFields>(BLANK_FIELDS);
  const [scanning, setScanning] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState({ msg: '', show: false });
  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  async function scanFile(file: File) {
    setScanning(true);
    try {
      const { base64, mediaType } = await readFileAsBase64(file);
      setImagePreview(`data:${mediaType};base64,${base64}`);
      const result = await ocrScanConfirmFormImage(base64, mediaType);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setFields(result.fields.items.length > 0 ? result.fields : { ...result.fields, items: [BLANK_ITEM] });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '사진을 읽는 중 오류가 났어요.');
    } finally {
      setScanning(false);
    }
  }

  async function scanText() {
    if (!pastedText.trim()) {
      showToast('텍스트를 입력해주세요.');
      return;
    }
    setScanning(true);
    try {
      const result = await ocrScanConfirmFormText(pastedText);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setFields(result.fields.items.length > 0 ? result.fields : { ...result.fields, items: [BLANK_ITEM] });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '텍스트를 읽는 중 오류가 났어요.');
    } finally {
      setScanning(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          scanFile(file);
          return;
        }
      }
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) scanFile(file);
  }

  function updateField<K extends keyof WithdrawalFormFields>(key: K, value: WithdrawalFormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function updateItem(index: number, patch: Partial<WithdrawalFormItem>) {
    setFields((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));
  }

  function addItem() {
    setFields((prev) => ({ ...prev, items: [...prev.items, BLANK_ITEM] }));
  }

  function removeItem(index: number) {
    setFields((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  }

  function resetAll() {
    setImagePreview(null);
    setPastedText('');
    setFields(BLANK_FIELDS);
  }

  async function handleRegister() {
    setRegistering(true);
    try {
      const result = await registerConfirmForm(tab, fields);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast(
        tab === '철수'
          ? '등록했어요 — 출고 대장과 입고 대장(렌탈입고예정)에 모두 반영됐어요.'
          : '등록했어요 — 출고 대장에 반영됐어요.',
      );
      resetAll();
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="app">
      <div className="panel">
        <div className="chip-group" style={{ marginBottom: '14px' }}>
          {CONFIRM_FORM_TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="sub" style={{ marginBottom: '10px' }}>
          {tab === '철수'
            ? '철수 확인서는 등록하면 출고 대장 + 입고 대장(렌탈입고예정)에 같이 반영돼요.'
            : `${tab} 확인서는 등록하면 출고 대장에 반영돼요.`}
        </div>

        <div
          onPaste={handlePaste}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          tabIndex={0}
          style={{
            border: `2px dashed ${dragOver ? 'var(--indigo-600)' : 'var(--ink-200)'}`,
            borderRadius: '12px',
            padding: '20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'var(--indigo-50, #eef2ff)' : 'transparent',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt="확인서 미리보기" style={{ maxHeight: '220px', maxWidth: '100%' }} />
          ) : (
            <div style={{ color: 'var(--ink-500)', fontSize: '13px' }}>
              📎 여기를 클릭해서 파일 선택, 사진을 드래그, 또는 Ctrl+V로 붙여넣기
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) scanFile(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="form-field full" style={{ marginTop: '12px' }}>
          <label>또는 텍스트로 붙여넣기</label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={4}
            placeholder="확인서 내용을 텍스트로 옮겨 적었다면 여기 붙여넣고 아래 버튼을 눌러주세요."
            style={{
              width: '100%',
              fontFamily: 'inherit',
              fontSize: '13px',
              padding: '10px',
              border: '1px solid var(--ink-200)',
              borderRadius: '8px',
              resize: 'vertical',
            }}
          />
          <button type="button" className="btn btn-ghost" disabled={scanning} onClick={scanText} style={{ marginTop: '6px', alignSelf: 'flex-start' }}>
            {scanning ? '읽는 중…' : '텍스트에서 읽기'}
          </button>
        </div>
      </div>

      {fields.items.length > 0 && (
        <div className="panel" style={{ marginTop: '14px' }}>
          <h2 style={{ fontSize: '15px', margin: '0 0 10px' }}>인식 결과 (등록 전에 확인/수정하세요)</h2>
          <div className="form-grid">
            <div className="form-field">
              <label>상호(거래처명) *</label>
              <input value={fields.companyName} onChange={(e) => updateField('companyName', e.target.value)} />
            </div>
            <div className="form-field">
              <label>날짜</label>
              <input type="date" value={fields.date} onChange={(e) => updateField('date', e.target.value)} />
            </div>
            <div className="form-field">
              <label>요청자/담당자</label>
              <input value={fields.requester} onChange={(e) => updateField('requester', e.target.value)} />
            </div>
            <div className="form-field full">
              <label>사유 및 특이사항</label>
              <input value={fields.reason} onChange={(e) => updateField('reason', e.target.value)} />
            </div>
          </div>

          <table style={{ marginTop: '12px' }}>
            <thead>
              <tr>
                <th>품목</th>
                <th>모델명</th>
                <th>기번(시리얼)</th>
                <th>자산번호</th>
                <th style={{ width: '50px' }} />
              </tr>
            </thead>
            <tbody>
              {fields.items.map((item, i) => (
                <tr key={i}>
                  <td>
                    <select
                      className="inline-cell-input"
                      value={item.category}
                      onChange={(e) => updateItem(i, { category: e.target.value })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="inline-cell-input"
                      value={item.model}
                      onChange={(e) => updateItem(i, { model: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-cell-input"
                      value={item.serialNumber}
                      onChange={(e) => updateItem(i, { serialNumber: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-cell-input"
                      value={item.assetId}
                      onChange={(e) => updateItem(i, { assetId: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="icon-btn danger" title="삭제" onClick={() => removeItem(i)}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="chip" onClick={addItem} style={{ marginTop: '8px' }}>
            ＋ 품목 추가
          </button>

          <div className="modal-footer" style={{ borderTop: 'none' }}>
            <button type="button" className="btn btn-ghost" onClick={resetAll} disabled={registering}>
              초기화
            </button>
            <button type="button" className="btn btn-primary" onClick={handleRegister} disabled={registering}>
              {registering ? '등록 중…' : `${tab} 확인서로 등록`}
            </button>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: '14px' }}>
        <h2 style={{ fontSize: '15px', margin: '0 0 10px' }}>이 도구로 등록한 내역 (최근 100건)</h2>
        <div className="chip-group" style={{ marginBottom: '10px' }}>
          <button type="button" className={`chip${historyFilter === 'all' ? ' active' : ''}`} onClick={() => setHistoryFilter('all')}>
            전체
          </button>
          <button type="button" className={`chip${historyFilter === 'pc' ? ' active' : ''}`} onClick={() => setHistoryFilter('pc')}>
            🖥️ PC관련(모니터·데스크탑·노트북)
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${historyFilter === c ? ' active' : ''}`}
              onClick={() => setHistoryFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>구분</th>
              <th>품목</th>
              <th>모델명</th>
              <th>자산번호</th>
              <th>거래처</th>
              <th>날짜</th>
            </tr>
          </thead>
          <tbody>
            {entries
              .filter((e) => {
                if (historyFilter === 'all') return true;
                if (historyFilter === 'pc') return PC_ITEMS.includes(e.item);
                return e.item === historyFilter;
              })
              .map((e) => (
                <tr key={e.id}>
                  <td>{e.type}</td>
                  <td>{e.item}</td>
                  <td>{e.directSpec || '-'}</td>
                  <td>{e.assetId || '-'}</td>
                  <td>{e.company}</td>
                  <td style={{ fontSize: '12px' }}>{e.deliveryDate || '-'}</td>
                </tr>
              ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  <div>📋</div>아직 등록한 내역이 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={`toast${toast.show ? ' show' : ''}`}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={() => setToast((t) => ({ ...t, show: false }))} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
