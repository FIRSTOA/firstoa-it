'use client';

import { useEffect, useState } from 'react';
import { applyRentalSheetSync, compareRentalSheet, type ApplyResult, type CompareResult } from '@/app/rentals/actions';

type Props = {
  open: boolean;
  sheetUrl: string | null;
  onClose: () => void;
  onApplied: () => void;
};

type State =
  | { status: 'comparing' }
  | { status: 'compared'; result: Extract<CompareResult, { ok: true }> }
  | { status: 'applying' }
  | { status: 'applied'; result: Extract<ApplyResult, { ok: true }> }
  | { status: 'error'; message: string };

/** 원본 ERP 화면의 "구글시트 대조" 다이얼로그와 동일한 흐름: 열리면 바로 비교, 반영은 따로 누름. */
export default function RentalSyncModal({ open, sheetUrl, onClose, onApplied }: Props) {
  const [state, setState] = useState<State>({ status: 'comparing' });

  async function runCompare() {
    setState({ status: 'comparing' });
    const result = await compareRentalSheet();
    if (!result.ok) {
      setState({ status: 'error', message: result.error });
      return;
    }
    setState({ status: 'compared', result });
  }

  useEffect(() => {
    if (open) runCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleApply() {
    setState({ status: 'applying' });
    const result = await applyRentalSheetSync();
    if (!result.ok) {
      setState({ status: 'error', message: result.error });
      return;
    }
    setState({ status: 'applied', result });
    onApplied();
  }

  if (!open) return null;

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '440px' }}>
        <h2>🔄 구글시트 대조</h2>
        {sheetUrl && (
          <div className="sub">
            <a href={sheetUrl} target="_blank" rel="noreferrer">
              시트 열기 ↗
            </a>
          </div>
        )}

        <div style={{ margin: '18px 0', minHeight: '90px' }}>
          {(state.status === 'comparing' || state.status === 'applying') && (
            <div style={{ color: 'var(--ink-500)', fontSize: '13px' }}>
              {state.status === 'comparing' ? '구글시트와 대조하는 중…' : '반영하는 중…(행이 많아 시간이 좀 걸려요)'}
            </div>
          )}
          {state.status === 'compared' && (
            <div style={{ display: 'grid', gap: '6px', fontSize: '13px' }}>
              <div>시트 전체: <b>{state.result.totalSheetRows.toLocaleString()}건</b></div>
              <div>🆕 신규: <b>{state.result.newCount.toLocaleString()}건</b></div>
              <div>✏️ 변경: <b>{state.result.changedCount.toLocaleString()}건</b></div>
              <div>🗑 삭제됨: <b>{state.result.removedCount.toLocaleString()}건</b></div>
              <div style={{ color: 'var(--ink-400)' }}>변동없음: {state.result.unchangedCount.toLocaleString()}건</div>
            </div>
          )}
          {state.status === 'applied' && (
            <div style={{ fontSize: '13px' }}>
              ✅ 반영 완료 — {state.result.upserted.toLocaleString()}건 갱신, {state.result.deleted.toLocaleString()}건 삭제
            </div>
          )}
          {state.status === 'error' && (
            <div className="setup-alert" style={{ fontSize: '13px' }}>
              {state.message}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={runCompare}
            disabled={state.status === 'comparing' || state.status === 'applying'}
          >
            🔄 다시 대조
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApply}
            disabled={state.status !== 'compared'}
          >
            ✓ 반영
          </button>
        </div>
      </div>
    </div>
  );
}
