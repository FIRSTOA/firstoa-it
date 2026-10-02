'use client';

import { useRef, useState, useTransition } from 'react';
import {
  addUnexpectedAssetToSession,
  bulkUpdateStocktakeItems,
  completeStocktake,
  ocrScanAssetLabel,
  updateStocktakeItem,
} from '@/app/stocktake/actions';
import { resizeImageFile } from '@/lib/imageResize';
import { stocktakeSummary, type StocktakeSession } from '@/lib/stocktake';

const STATUS_LABEL: Record<string, string> = {
  미확인: '미확인',
  확인됨: '확인됨',
  목록외발견: '목록외 발견',
};

export default function StocktakeSessionPage({ session }: { session: StocktakeSession }) {
  const [toast, setToast] = useState({ msg: '', show: false });
  const [scanPending, setScanPending] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [unexpectedAssetId, setUnexpectedAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sum = stocktakeSummary(session.results);
  const done = session.status === '완료';

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  function toggleItem(assetId: string, current: string) {
    const next = current === '확인됨' ? '미확인' : '확인됨';
    startTransition(async () => {
      const result = await updateStocktakeItem(session.id, assetId, next as '확인됨' | '미확인');
      if (!result.ok) showToast(result.error);
    });
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanPending(true);
    try {
      const { base64, mediaType } = await resizeImageFile(file);
      const result = await ocrScanAssetLabel(base64, mediaType);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      const assetId = result.assetId;
      const inList = session.results.some((r) => r.assetId === assetId);
      if (inList) {
        startTransition(async () => {
          const upd = await updateStocktakeItem(session.id, assetId, '확인됨');
          showToast(upd.ok ? `${assetId} 확인했어요.` : upd.error);
        });
      } else {
        // 카톡 인앱 브라우저 등에서 window.confirm()이 아예 반응 없이 무시되는 경우가 있어서
        // (버튼을 눌러도 "아무 반응 없음"처럼 보임), 네이티브 다이얼로그 대신 화면 안에서 직접
        // 예/아니오를 받습니다.
        setUnexpectedAssetId(assetId);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '사진을 읽는 중 오류가 났어요.');
    } finally {
      setScanPending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function toggleSelect(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const allSelected = session.results.length > 0 && session.results.every((r) => prev.has(r.assetId));
      if (allSelected) return new Set();
      return new Set(session.results.map((r) => r.assetId));
    });
  }

  function handleBulkConfirm() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const result = await bulkUpdateStocktakeItems(session.id, [...selected], '확인됨');
      showToast(result.ok ? `${selected.size}건 확인 처리했어요.` : result.error);
      if (result.ok) setSelected(new Set());
    });
  }

  function handleComplete() {
    startTransition(async () => {
      const result = await completeStocktake(session.id);
      setConfirmingComplete(false);
      showToast(result.ok ? '조사를 종료했어요.' : result.error);
    });
  }

  function handleAddUnexpected() {
    const assetId = unexpectedAssetId;
    if (!assetId) return;
    setUnexpectedAssetId(null);
    startTransition(async () => {
      const added = await addUnexpectedAssetToSession(session.id, assetId);
      showToast(added.ok ? `${assetId}를 목록외 발견으로 추가했어요.` : added.error);
    });
  }

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <div className="meta" style={{ fontSize: '13px', fontWeight: 700 }}>
          확인 {sum.confirmed} / 전체 {sum.total}
          {sum.unexpected > 0 && <span style={{ color: 'var(--red-600)' }}> · 목록외 발견 {sum.unexpected}</span>}
          {done && <span style={{ marginLeft: '8px' }} className="badge badge-상품화완료">완료</span>}
        </div>
        {!done && (
          <div className="actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleScan}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={scanPending || pending}
              onClick={() => fileInputRef.current?.click()}
            >
              {scanPending ? '인식 중…' : '📷 사진으로 스캔'}
            </button>
            {confirmingComplete ? (
              <>
                <span style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>정말 종료할까요?</span>
                <button type="button" className="btn btn-primary" disabled={pending} onClick={handleComplete}>
                  예, 종료
                </button>
                <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirmingComplete(false)}>
                  아니오
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => setConfirmingComplete(true)}>
                조사 종료
              </button>
            )}
          </div>
        )}
      </div>

      {unexpectedAssetId && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', borderColor: 'var(--red-100)' }}>
          <span style={{ fontSize: '13px' }}>
            <b>&quot;{unexpectedAssetId}&quot;</b>는 이 위치 목록에 없는 자산번호예요. 그래도 여기서 발견된 걸로 추가할까요?
          </span>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={handleAddUnexpected}>
            추가
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setUnexpectedAssetId(null)}>
            무시
          </button>
        </div>
      )}

      {!done && selected.size > 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{selected.size}건 선택됨</span>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={handleBulkConfirm}>
            선택 확인 처리
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      <div className="panel" style={{ paddingTop: '6px' }}>
        <table>
          <thead>
            <tr>
              {!done && (
                <th style={{ width: '32px' }}>
                  <input
                    type="checkbox"
                    checked={session.results.length > 0 && session.results.every((r) => selected.has(r.assetId))}
                    onChange={toggleSelectAll}
                    aria-label="전체 선택"
                  />
                </th>
              )}
              <th>자산번호</th>
              <th>품목</th>
              <th className="hide-mobile">브랜드</th>
              <th>모델명</th>
              <th>상태</th>
              <th className="hide-mobile">비고</th>
              {!done && <th style={{ width: '90px' }} />}
            </tr>
          </thead>
          <tbody>
            {session.results.map((r) => (
              <tr key={r.assetId}>
                {!done && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.assetId)}
                      onChange={() => toggleSelect(r.assetId)}
                      aria-label={`${r.assetId} 선택`}
                    />
                  </td>
                )}
                <td>
                  <span className="asset-id">{r.assetId}</span>
                </td>
                <td>{r.category}</td>
                <td className="hide-mobile">{r.brand}</td>
                <td>{r.model}</td>
                <td>
                  <span
                    className={`badge ${
                      r.status === '확인됨'
                        ? 'badge-상품화완료'
                        : r.status === '목록외발견'
                          ? 'badge-악성'
                          : 'badge-상품화준비중'
                    }`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="hide-mobile" style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{r.note || '-'}</td>
                {!done && (
                  <td>
                    <button type="button" className="chip" disabled={pending} onClick={() => toggleItem(r.assetId, r.status)}>
                      {r.status === '확인됨' ? '취소' : '확인'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {session.results.length === 0 && (
              <tr>
                <td colSpan={done ? 6 : 8} className="empty-state">
                  <div>📋</div>이 위치에 전산상 등록된 자산이 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sum.missing > 0 && done && (
        <div className="panel" style={{ marginTop: '12px', borderColor: 'var(--red-100)' }}>
          <div style={{ fontWeight: 700, color: 'var(--red-600)', marginBottom: '6px' }}>
            ⚠️ 실사에서 확인되지 않은 자산 {sum.missing}건 — 분실 가능성이 있어요
          </div>
          {session.results
            .filter((r) => r.status === '미확인')
            .map((r) => (
              <div key={r.assetId} style={{ fontSize: '12.5px', color: 'var(--ink-700)' }}>
                {r.assetId} · {r.brand} {r.model}
              </div>
            ))}
        </div>
      )}

      <div className={`toast${toast.show ? ' show' : ''}`}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={() => setToast((t) => ({ ...t, show: false }))} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
