'use client';

import { useEffect, useRef, useState } from 'react';
import { resizeImageFile } from '@/lib/imageResize';
import { scanLabelImage } from '@/lib/ocrClient';
import type { ReceivingEntry } from '@/lib/receiving';
import { isLikelyAssetId } from '@/lib/stocktake';

type Row = {
  id: string;
  category: string;
  brand: string;
  model: string;
  quantity: number;
  originalLocation: string;
  assetId: string;
  serialNumber: string;
};

export type CompleteUpdate = { id: string; location: string; assetId: string; serialNumber: string };

type Props = {
  open: boolean;
  entries: ReceivingEntry[];
  locations: string[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (updates: CompleteUpdate[]) => void;
};

function rowsFromEntries(entries: ReceivingEntry[]): Row[] {
  return entries.map((e) => ({
    id: e.id,
    category: e.category,
    brand: e.brand,
    model: e.model,
    quantity: e.quantity,
    originalLocation: e.location,
    assetId: e.assetId,
    serialNumber: e.serialNumber,
  }));
}

export default function ReceivingCompleteModal({ open, entries, locations, pending, onClose, onSubmit }: Props) {
  const [location, setLocation] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanNote, setScanNote] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setRows(rowsFromEntries(entries));
      setLocation(entries.find((e) => e.location.trim())?.location ?? '');
      setScanNote('');
      setScanProgress(null);
    }
    // entries는 매 렌더 새 배열이라 open에만 반응 — 모달이 열릴 때 한 번만 초기화합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || entries.length === 0) return null;

  const allConsumable = entries.every((e) => e.category === '기타주변기기');
  const neededRows = rows.filter((r) => r.category !== '기타주변기기');

  function setRowField(id: string, field: 'assetId' | 'serialNumber', value: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function handleScanFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setScanProgress({ done: 0, total: files.length });
    setScanNote('');
    let cursor = 0; // 빈 자산번호 행을 순서대로 채웁니다.
    let skipped = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const { base64, mediaType } = await resizeImageFile(files[i]);
        const result = await scanLabelImage(base64, mediaType);
        const assetId = result.ok && isLikelyAssetId(result.fields.assetId) ? result.fields.assetId : '';
        const serialNumber = result.ok ? result.fields.serialNumber : '';

        if (!assetId) {
          skipped++;
        } else {
          setRows((prev) => {
            const next = [...prev];
            while (cursor < next.length && (next[cursor].category === '기타주변기기' || next[cursor].assetId.trim())) {
              cursor++;
            }
            if (cursor >= next.length) {
              skipped++;
              return prev;
            }
            next[cursor] = { ...next[cursor], assetId, serialNumber: serialNumber || next[cursor].serialNumber };
            cursor++;
            return next;
          });
        }
      } catch {
        skipped++;
      }
      setScanProgress({ done: i + 1, total: files.length });
    }

    setScanProgress(null);
    if (skipped > 0) setScanNote(`${skipped}장은 자산번호를 못 읽었어요 — 직접 입력해주세요.`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const filledCount = neededRows.filter((r) => r.assetId.trim()).length;
  const missingCount = neededRows.length - filledCount;
  const locationReady = allConsumable || location.trim() !== '';
  const canSubmit = !pending && locationReady && missingCount === 0;

  function buildUpdates(): CompleteUpdate[] {
    return rows.map((r) =>
      r.category === '기타주변기기'
        ? { id: r.id, location: r.originalLocation, assetId: r.assetId, serialNumber: r.serialNumber }
        : { id: r.id, location, assetId: r.assetId.trim(), serialNumber: r.serialNumber.trim() },
    );
  }

  function handleSubmit() {
    onSubmit(buildUpdates());
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div className="modal" style={{ width: '620px' }}>
        <h2>입고완료 처리</h2>
        <div className="sub">
          {allConsumable
            ? `선택한 ${entries.length}건을 재고에 반영(입고완료 처리)하시겠습니까?`
            : `위치와 자산번호를 입력하고 재고에 반영(입고완료 처리)하시겠습니까?`}
        </div>

        {allConsumable ? (
          <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rows.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  padding: '6px 8px',
                  background: 'var(--ink-50)',
                  borderRadius: '6px',
                }}
              >
                <span>
                  {r.brand} {r.model}
                </span>
                <span style={{ color: 'var(--ink-500)' }}>{r.quantity}개</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="form-grid" style={{ marginTop: '10px' }}>
              <div className="form-field full">
                <label>
                  위치 <span className="required">*</span>
                </label>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">위치 선택</option>
                  {locations.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '12px 0' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleScanFiles}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!!scanProgress}
                onClick={() => fileInputRef.current?.click()}
              >
                {scanProgress ? `인식 중… (${scanProgress.done}/${scanProgress.total})` : '📷 사진으로 스캔해서 채우기'}
              </button>
              <span style={{ fontSize: '11.5px', color: 'var(--ink-400)' }}>
                자산번호 스티커 사진을 여러 장 올리면 순서대로 자동으로 채워요
              </span>
            </div>
            {scanNote && <div className="setup-alert" style={{ marginBottom: '10px' }}>{scanNote}</div>}
            {missingCount > 0 && (
              <div className="setup-alert" style={{ marginBottom: '10px' }}>
                ⚠️ {neededRows.length}대 중 {filledCount}대만 입력됐어요. {missingCount}대 더 입력해주세요.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '40vh', overflowY: 'auto' }}>
              {rows.map((r) =>
                r.category === '기타주변기기' ? (
                  <div key={r.id} style={{ fontSize: '12.5px', color: 'var(--ink-500)', padding: '6px 2px' }}>
                    {r.brand} {r.model} — 소모성 재고라 자산번호/위치 입력 없이 완료돼요.
                  </div>
                ) : (
                  <div
                    key={r.id}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', alignItems: 'center' }}
                  >
                    <span style={{ fontSize: '12.5px', color: 'var(--ink-600)' }}>
                      {r.brand} {r.model}
                    </span>
                    <input
                      value={r.assetId}
                      onChange={(e) => setRowField(r.id, 'assetId', e.target.value)}
                      placeholder="자산번호 *"
                    />
                    <input
                      value={r.serialNumber}
                      onChange={(e) => setRowField(r.id, 'serialNumber', e.target.value)}
                      placeholder="시리얼번호"
                    />
                  </div>
                ),
              )}
            </div>
          </>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
            {pending ? '처리 중…' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}
