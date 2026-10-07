'use client';

import { useEffect, useState } from 'react';
import { listAssetMovements, logAssetNote, type AssetNoteEntry } from '@/app/actions';
import { parseHistoryEntries } from '@/lib/inventory/history';
import type { Asset } from '@/lib/types';

type Props = {
  open: boolean;
  item: Asset | null;
  pending: boolean;
  onClose: () => void;
  onReserve: (item: Asset) => void;
  onCancelReservation: (item: Asset) => void;
  onPrint: (items: Asset[]) => void;
};

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="detail-field">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value || '-'}</span>
    </div>
  );
}

export default function AssetDetailModal({
  open,
  item,
  pending,
  onClose,
  onReserve,
  onCancelReservation,
  onPrint,
}: Props) {
  const [movements, setMovements] = useState<AssetNoteEntry[]>([]);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState('');

  const assetId = item?.assetId ?? '';
  const category = item?.category ?? '';

  useEffect(() => {
    if (!open || !assetId) {
      setMovements([]);
      return;
    }
    let cancelled = false;
    listAssetMovements(assetId).then((rows) => {
      if (!cancelled) setMovements(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, assetId]);

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setAddingNote(true);
    setNoteError('');
    const result = await logAssetNote(assetId, category, noteText.trim());
    if (!result.ok) {
      setNoteError(result.error);
    } else {
      setNoteText('');
      setMovements(await listAssetMovements(assetId));
    }
    setAddingNote(false);
  }

  if (!item) return null;

  const historyEntries = parseHistoryEntries(item.history);
  const [ssd, hdd] = item.storage.split(' / ');

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width: '620px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: '22px' }}>{item.assetId || '-'}</h2>
            <div className="sub" style={{ marginBottom: '2px' }}>
              {item.specLabel || '-'}
            </div>
            <div className="sub">
              {item.model} · {item.category}
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <span className={`badge badge-${item.status}`}>{item.status}</span>
          {item.malicious && <span className="badge badge-악성">악성</span>}
          {item.reservedBy ? (
            <button type="button" className="chip" disabled={pending} onClick={() => onCancelReservation(item)}>
              예약됨: {item.reservedBy}
              {item.reservedAt ? ` (${item.reservedAt})` : ''} — 취소
            </button>
          ) : (
            <button type="button" className="chip" disabled={pending} onClick={() => onReserve(item)}>
              예약
            </button>
          )}
        </div>

        <div className="detail-grid">
          <Field label="제조사" value={item.brand} />
          <Field label="구입처" value={item.vendor} />
          <Field label="구매단가" value={item.purchasePrice} />
          <Field label="위치" value={item.location} />
          <Field label="업체명" value={item.clientName} />
          <Field label="종료일" value={item.endDate} />
          <Field label="시리얼번호" value={item.serialNo} />
          <Field label="오버홀날짜" value={item.overhaulDate} />
          <Field label="담당자" value={item.manager} />
          <Field label="OS" value={item.os} />
          <Field label="CPU" value={item.cpu} />
          <Field label="메인보드" value={item.motherboard} />
          <Field label="메모리" value={item.ram} />
          <Field label="그래픽카드" value={item.gpu} />
          <Field label="SSD" value={ssd || ''} />
          <Field label="HDD" value={hdd || ''} />
          <Field label="POWER" value={item.power} />
          <Field label="케이스" value={item.caseName} />
          <Field label="용도구분" value={item.usageClass} />
        </div>

        <div className="detail-section-title">이동/작업 이력</div>
        {historyEntries.length > 0 ? (
          historyEntries.map((entry, i) => (
            <div key={i} className="detail-history-entry">
              {entry}
            </div>
          ))
        ) : (
          <div className="detail-empty">이력이 없어요.</div>
        )}

        <div className="detail-section-title">작업 이력(앱 기록) — 신규등록/위치변경/수리/파손 메모</div>
        {movements.length > 0 ? (
          movements.map((m) => (
            <div key={m.id} className="detail-history-entry">
              <span style={{ color: 'var(--ink-400)', marginRight: '6px' }}>{formatDateTime(m.movedAt)}</span>
              {m.memo || (m.fromLocation || m.toLocation ? `${m.fromLocation || '(신규)'} → ${m.toLocation || '(없음)'}` : '-')}
            </div>
          ))
        ) : (
          <div className="detail-empty">기록이 없어요.</div>
        )}
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="예: 액정 파손 발견, 상세 증상/위치"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-ghost" disabled={addingNote || !noteText.trim()} onClick={handleAddNote}>
            {addingNote ? '저장 중…' : '+ 메모 추가'}
          </button>
        </div>
        {noteError && <div style={{ fontSize: '12px', color: 'var(--red-600)', marginTop: '4px' }}>{noteError}</div>}

        <div className="detail-section-title">AS접수 이력</div>
        <div className="detail-empty">AS접수 이력 기능은 아직 없어요.</div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={() => onPrint([item])}>
            🖨 이 자산번호 인쇄
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
