'use client';

import { useRef, useState, useTransition } from 'react';
import {
  addUnexpectedAssetToSession,
  completeStocktake,
  ocrScanAssetLabel,
  updateStocktakeItem,
} from '@/app/stocktake/actions';
import { stocktakeSummary, type StocktakeSession } from '@/lib/stocktake';

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

const STATUS_LABEL: Record<string, string> = {
  미확인: '미확인',
  확인됨: '확인됨',
  목록외발견: '목록외 발견',
};

export default function StocktakeSessionPage({ session }: { session: StocktakeSession }) {
  const [toast, setToast] = useState({ msg: '', show: false });
  const [scanPending, setScanPending] = useState(false);
  const [pending, startTransition] = useTransition();
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
      const { base64, mediaType } = await readFileAsBase64(file);
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
        const addIt = confirm(
          `"${assetId}"는 이 위치 목록에 없는 자산번호예요. 그래도 여기서 발견된 걸로 추가할까요?`,
        );
        if (!addIt) return;
        startTransition(async () => {
          const added = await addUnexpectedAssetToSession(session.id, assetId);
          showToast(added.ok ? `${assetId}를 목록외 발견으로 추가했어요.` : added.error);
        });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '사진을 읽는 중 오류가 났어요.');
    } finally {
      setScanPending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleComplete() {
    if (!confirm('조사를 종료할까요? 종료 후에도 목록은 볼 수 있지만 더 이상 체크할 수 없어요.')) return;
    startTransition(async () => {
      const result = await completeStocktake(session.id);
      showToast(result.ok ? '조사를 종료했어요.' : result.error);
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
            <button type="button" className="btn btn-primary" disabled={pending} onClick={handleComplete}>
              조사 종료
            </button>
          </div>
        )}
      </div>

      <div className="panel" style={{ paddingTop: '6px' }}>
        <table>
          <thead>
            <tr>
              <th>자산번호</th>
              <th>품목</th>
              <th>브랜드</th>
              <th>모델명</th>
              <th>상태</th>
              <th>비고</th>
              {!done && <th style={{ width: '90px' }} />}
            </tr>
          </thead>
          <tbody>
            {session.results.map((r) => (
              <tr key={r.assetId}>
                <td>
                  <span className="asset-id">{r.assetId}</span>
                </td>
                <td>{r.category}</td>
                <td>{r.brand}</td>
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
                <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{r.note || '-'}</td>
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
                <td colSpan={done ? 6 : 7} className="empty-state">
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
