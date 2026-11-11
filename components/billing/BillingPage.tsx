'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  createBillingLine,
  deleteBillingLine,
  listBillingLines,
  resolveBillingAllocation,
  updateBillingLine,
} from '@/app/billing/actions';
import { type BillingLine, type BillingLineInput } from '@/lib/billing';
import { formatWon } from '@/lib/currency';
import BillingLineModal from './BillingLineModal';

type Props = { initialLines: BillingLine[] };

export default function BillingPage({ initialLines }: Props) {
  const [lines, setLines] = useState(initialLines);
  const [searchTerm, setSearchTerm] = useState('');
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BillingLine | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveAssetId, setResolveAssetId] = useState('');
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  async function refetch() {
    const fresh = await listBillingLines({ searchTerm, needsReviewOnly });
    setLines(fresh);
  }

  const visible = useMemo(() => {
    let v = lines;
    if (needsReviewOnly) v = v.filter((l) => l.allocationStatus === 'needs_review');
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      v = v.filter((l) => `${l.assetId ?? ''} ${l.vendorName} ${l.sourceInvoiceId}`.toLowerCase().includes(term));
    }
    return v;
  }, [lines, searchTerm, needsReviewOnly]);

  const needsReviewCount = lines.filter((l) => l.allocationStatus === 'needs_review').length;

  function handleSave(input: BillingLineInput) {
    const target = editing;
    startTransition(async () => {
      const result = target ? await updateBillingLine(target.id, input) : await createBillingLine(input);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setModalOpen(false);
      setEditing(null);
      showToast(target ? '수정했어요.' : '등록했어요.');
      await refetch();
    });
  }

  function handleDelete(id: string) {
    if (!confirm('이 청구 명세를 삭제할까요?')) return;
    startTransition(async () => {
      const result = await deleteBillingLine(id);
      showToast(result.ok ? '삭제했어요.' : result.error);
      await refetch();
    });
  }

  function handleResolveSubmit(id: string) {
    if (!resolveAssetId.trim()) return;
    startTransition(async () => {
      const result = await resolveBillingAllocation(id, resolveAssetId.trim(), null);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setResolvingId(null);
      setResolveAssetId('');
      showToast('배분을 확인했어요.');
      await refetch();
    });
  }

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="meta" style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>
          총 {lines.length}건{needsReviewCount > 0 && ` · 배분 확인 필요 ${needsReviewCount}건`}
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            ＋ 청구 명세 추가
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="search-row" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="자산번호 / 거래처 / 청구번호 검색"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className={`chip${needsReviewOnly ? ' active' : ''}`}
            onClick={() => setNeedsReviewOnly((v) => !v)}
          >
            배분 확인 필요만
          </button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>청구일</th>
            <th>자산번호</th>
            <th>거래처</th>
            <th>청구번호</th>
            <th>금액</th>
            <th>상태</th>
            <th>배분</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((l) => (
            <tr key={l.id}>
              <td>{l.billingDate || '-'}</td>
              <td className="asset-id" onClick={() => { setEditing(l); setModalOpen(true); }} style={{ cursor: 'pointer' }}>
                {l.assetId || '(미지정)'}
              </td>
              <td>{l.vendorName || '-'}</td>
              <td>{l.sourceInvoiceId || '-'}</td>
              <td>{formatWon(l.amount)}</td>
              <td>
                <span className={`badge ${l.status === '취소' ? 'badge-미정' : l.status === '조정' ? 'badge-수리중' : 'badge-상품화완료'}`}>
                  {l.status}
                </span>
              </td>
              <td>
                {l.allocationStatus === 'confirmed' ? (
                  <span className="badge badge-상품화완료">확정</span>
                ) : resolvingId === l.id ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      value={resolveAssetId}
                      onChange={(e) => setResolveAssetId(e.target.value)}
                      placeholder="자산번호"
                      style={{ width: '90px' }}
                    />
                    <button type="button" className="btn btn-ghost" onClick={() => handleResolveSubmit(l.id)}>
                      확인
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setResolvingId(l.id);
                      setResolveAssetId(l.assetId ?? '');
                    }}
                  >
                    ⚠️ 배분 확인 필요
                  </button>
                )}
              </td>
              <td>
                <button type="button" className="icon-btn danger" onClick={() => handleDelete(l.id)} aria-label="삭제">
                  ×
                </button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={8} className="empty-state">
                <div>🧾</div>조건에 맞는 청구 명세가 없어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <BillingLineModal
        open={modalOpen}
        editing={editing}
        pending={pending}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <div className={`toast${toast.show ? ' show' : ''}`}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={() => setToast((t) => ({ ...t, show: false }))} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
