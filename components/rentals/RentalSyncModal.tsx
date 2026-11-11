'use client';

import { useEffect, useState } from 'react';
import { applyWorksSync, compareWorksSync, type ApplyResult, type CompareResult } from '@/app/rentals/actions';

type Props = {
  open: boolean;
  sheetUrl: string | null;
  onClose: () => void;
  onApplied: () => void;
};

type State =
  | { status: 'comparing' }
  | { status: 'compared'; result: Extract<CompareResult, { ok: true }> }
  | { status: 'applying'; round: number; written: number }
  | { status: 'applied'; result: Extract<ApplyResult, { ok: true }> }
  | { status: 'error'; message: string };

/** 원본 ERP 화면의 "구글시트 대조" 다이얼로그와 동일한 흐름: 열리면 바로 비교, 반영은 따로 누름. */
export default function RentalSyncModal({ open, sheetUrl, onClose, onApplied }: Props) {
  const [state, setState] = useState<State>({ status: 'comparing' });

  async function runCompare() {
    setState({ status: 'comparing' });
    const result = await compareWorksSync();
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

  // 한 번 호출에 다 못 쓰면(서버 시간 상한) done:false가 오므로, 끝날 때까지 이어서 호출합니다.
  async function handleApply() {
    const MAX_ROUNDS = 15;
    const total = { upserted: 0, deleted: 0, billingInserted: 0, billingUpdated: 0, billingDeleted: 0 };
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      setState({ status: 'applying', round, written: total.upserted + total.billingInserted + total.billingUpdated });
      const result = await applyWorksSync();
      if (!result.ok) {
        setState({ status: 'error', message: result.error });
        return;
      }
      total.upserted += result.upserted;
      total.deleted += result.deleted;
      total.billingInserted += result.billingInserted;
      total.billingUpdated += result.billingUpdated;
      total.billingDeleted += result.billingDeleted;
      if (result.done) {
        setState({ status: 'applied', result: { ...result, ...total } });
        onApplied();
        return;
      }
    }
    setState({ status: 'error', message: '반영이 너무 오래 걸려 중단했어요. "다시 대조" 후 "반영"을 한 번 더 눌러주세요(이어서 반영돼요).' });
  }

  if (!open) return null;

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '440px' }}>
        <h2>🔄 firstoa-works 대조</h2>
        {sheetUrl && (
          <div className="sub">
            <a href={sheetUrl} target="_blank" rel="noreferrer">
              firstoa-works 열기 ↗
            </a>
          </div>
        )}

        <div style={{ margin: '18px 0', minHeight: '90px' }}>
          {(state.status === 'comparing' || state.status === 'applying') && (
            <div style={{ color: 'var(--ink-500)', fontSize: '13px' }}>
              {state.status === 'comparing'
                ? 'firstoa-works와 대조하는 중…'
                : `반영하는 중…(${state.round}회차${state.written ? ` · 지금까지 ${state.written.toLocaleString()}건 저장` : ''}) — 행이 많아 몇 분 걸릴 수 있어요, 창을 닫지 마세요`}
            </div>
          )}
          {state.status === 'compared' && (
            <div style={{ display: 'grid', gap: '6px', fontSize: '13px' }}>
              <div>임대리스트 전체: <b>{state.result.totalSheetRows.toLocaleString()}건</b></div>
              <div>🆕 신규: <b>{state.result.newCount.toLocaleString()}건</b></div>
              <div>✏️ 변경: <b>{state.result.changedCount.toLocaleString()}건</b></div>
              <div>🗑 삭제됨: <b>{state.result.removedCount.toLocaleString()}건</b></div>
              <div style={{ color: 'var(--ink-400)' }}>변동없음: {state.result.unchangedCount.toLocaleString()}건</div>
              <div style={{ borderTop: '1px solid var(--line, #e5e5e5)', marginTop: '4px', paddingTop: '8px' }}>
                청구 명세 — 🆕 신규 <b>{state.result.billingNewCount.toLocaleString()}건</b> · ✏️ 변경{' '}
                <b>{state.result.billingChangedCount.toLocaleString()}건</b> · 🗑 삭제{' '}
                <b>{state.result.billingRemovedCount.toLocaleString()}건</b>
                <span style={{ color: 'var(--ink-400)' }}> · 변동없음 {state.result.billingUnchangedCount.toLocaleString()}건</span>
              </div>
            </div>
          )}
          {state.status === 'applied' && (
            <div style={{ fontSize: '13px' }}>
              ✅ 반영 완료 — 임대리스트 {state.result.upserted.toLocaleString()}건 갱신,{' '}
              {state.result.deleted.toLocaleString()}건 삭제 · 청구 명세 신규 {state.result.billingInserted.toLocaleString()}건,
              변경 {state.result.billingUpdated.toLocaleString()}건, 삭제 {state.result.billingDeleted.toLocaleString()}건
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
