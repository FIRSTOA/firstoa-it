'use client';

import { useRef, useState } from 'react';
import { ocrExtractSaleInfo } from '@/app/sales/actions';
import { createAndCompleteReceivingBatch } from '@/app/receiving/actions';
import { normalizeWonInput } from '@/lib/currency';
import { RECEIVING_KINDS, type ReceivingInput } from '@/lib/receiving';
import { CATEGORIES } from '@/lib/types';

type Row = { assetId: string; serialNumber: string };

type Header = {
  kind: string;
  category: string;
  brand: string;
  model: string;
  vendor: string;
  purchasePrice: string;
  location: string;
  manager: string;
};

const BLANK_HEADER: Header = {
  kind: '구매입고예정',
  category: CATEGORIES[0],
  brand: '',
  model: '',
  vendor: '',
  purchasePrice: '',
  location: '',
  manager: '',
};

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

/** "P3613  0YR6HNCL803630H" 같은 줄들을 자산번호/시리얼 쌍으로 파싱합니다. */
function parsePairsFromText(text: string): Row[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tokens = line.split(/\s+/);
      return { assetId: tokens[0] ?? '', serialNumber: tokens[1] ?? '' };
    })
    .filter((r) => r.assetId);
}

export default function PhotoBatchImportModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [header, setHeader] = useState<Header>(BLANK_HEADER);
  const [rows, setRows] = useState<Row[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function setHeaderField<K extends keyof Header>(key: K, value: Header[K]) {
    setHeader((prev) => ({ ...prev, [key]: value }));
  }

  async function scanFiles(files: File[]) {
    setProgress({ done: 0, total: files.length });
    const next: Row[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const { base64, mediaType } = await readFileAsBase64(files[i]);
        const result = await ocrExtractSaleInfo(base64, mediaType);
        if (result.ok) {
          next.push({ assetId: result.fields.assetId, serialNumber: result.fields.serialNumber });
        }
      } catch {
        // 한 장 실패해도 나머지는 계속 진행 — 실패분은 빈 행으로 추가해 사람이 직접 채우게 함
        next.push({ assetId: '', serialNumber: '' });
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setRows((prev) => [...prev, ...next]);
    setProgress(null);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) scanFiles(files);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) scanFiles(files);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      scanFiles(files);
    }
  }

  function applyPastedText() {
    const parsed = parsePairsFromText(pastedText);
    if (parsed.length === 0) return;
    setRows((prev) => [...prev, ...parsed]);
    setPastedText('');
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleClose() {
    setHeader(BLANK_HEADER);
    setRows([]);
    setPastedText('');
    onClose();
  }

  async function handleSubmit() {
    if (!header.location.trim()) {
      onDone('위치를 입력해주세요.');
      return;
    }
    if (rows.length === 0) {
      onDone('등록할 품목이 없어요.');
      return;
    }
    setSubmitting(true);
    try {
      const entries: ReceivingInput[] = rows.map((r) => ({
        kind: header.kind,
        status: '입고대기',
        category: header.category,
        brand: header.brand,
        model: header.model,
        cpu: '',
        spec: '',
        ram: '',
        storage: '',
        screen: '',
        vendor: header.vendor,
        purchasePrice: header.purchasePrice,
        expectedDate: '',
        manager: header.manager,
        notes: '사진 일괄 등록',
        assetId: r.assetId.trim(),
        serialNumber: r.serialNumber.trim(),
        location: header.location,
        quantity: 1,
      }));
      const result = await createAndCompleteReceivingBatch(entries);
      if (!result.ok) {
        onDone(result.error);
        return;
      }
      onDone(
        result.failures.length === 0
          ? `${result.successCount}건 입고완료 처리했어요.`
          : `${result.successCount}건 처리, ${result.failures.length}건 실패 — ${result.failures.slice(0, 2).join(' / ')}`,
      );
      handleClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="modal" style={{ width: '680px' }}>
        <h2>📷 사진으로 일괄 등록</h2>
        <div className="sub">공통 정보를 한 번만 입력하고, 자산 스티커 사진 여러 장을 넣으면 자산번호/시리얼을 순서대로 읽어 행을 만들어요. 위치까지 입력하고 등록하면 바로 입고완료 처리돼요.</div>

        <div className="form-grid" style={{ marginTop: '12px' }}>
          <div className="form-field">
            <label>유형</label>
            <select value={header.kind} onChange={(e) => setHeaderField('kind', e.target.value)}>
              {RECEIVING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>품목</label>
            <select value={header.category} onChange={(e) => setHeaderField('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>브랜드</label>
            <input value={header.brand} onChange={(e) => setHeaderField('brand', e.target.value)} />
          </div>
          <div className="form-field">
            <label>모델명</label>
            <input value={header.model} onChange={(e) => setHeaderField('model', e.target.value)} />
          </div>
          <div className="form-field">
            <label>발주처</label>
            <input value={header.vendor} onChange={(e) => setHeaderField('vendor', e.target.value)} />
          </div>
          <div className="form-field">
            <label>매입가</label>
            <input
              value={header.purchasePrice}
              onChange={(e) => setHeaderField('purchasePrice', e.target.value)}
              onBlur={() => setHeaderField('purchasePrice', normalizeWonInput(header.purchasePrice))}
              placeholder="예: 121,000원 (VAT포함가)"
            />
          </div>
          <div className="form-field">
            <label>위치 *</label>
            <input value={header.location} onChange={(e) => setHeaderField('location', e.target.value)} placeholder="예: J1" />
          </div>
          <div className="form-field">
            <label>담당자</label>
            <input value={header.manager} onChange={(e) => setHeaderField('manager', e.target.value)} />
          </div>
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
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginTop: '12px',
            border: `2px dashed ${dragOver ? 'var(--indigo-600)' : 'var(--ink-200)'}`,
            borderRadius: '12px',
            padding: '16px',
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <div style={{ color: 'var(--ink-500)', fontSize: '13px' }}>
            {progress
              ? `인식 중… (${progress.done}/${progress.total})`
              : '📎 여기를 클릭해서 사진 여러 장 선택, 드래그, 또는 Ctrl+V로 붙여넣기'}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </div>

        <div className="form-field full" style={{ marginTop: '10px' }}>
          <label>또는 텍스트로 자산번호/시리얼 붙여넣기 (한 줄에 하나씩, 예: "P3613  0YR6HNCL803630H")</label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={3}
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
          <button type="button" className="btn btn-ghost" onClick={applyPastedText} style={{ marginTop: '6px', alignSelf: 'flex-start' }}>
            목록에 추가
          </button>
        </div>

        {rows.length > 0 && (
          <table style={{ marginTop: '12px' }}>
            <thead>
              <tr>
                <th>#</th>
                <th>자산번호</th>
                <th>시리얼번호</th>
                <th style={{ width: '50px' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input
                      className="inline-cell-input"
                      value={r.assetId}
                      onChange={(e) => updateRow(i, { assetId: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-cell-input"
                      value={r.serialNumber}
                      onChange={(e) => updateRow(i, { serialNumber: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="icon-btn danger" title="삭제" onClick={() => removeRow(i)}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={submitting}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting || rows.length === 0}>
            {submitting ? '등록 중…' : `${rows.length}건 등록하고 입고완료 처리`}
          </button>
        </div>
      </div>
    </div>
  );
}
