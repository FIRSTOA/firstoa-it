'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  createBillingLine,
  deleteBillingLine,
  getAllocationReview,
  listBillingLines,
  resolveBillingAllocation,
  updateBillingLine,
} from '@/app/billing/actions';
import { type BillingLine, type BillingLineInput } from '@/lib/billing';
import type { AllocationReview, BillingView, ReviewSummary } from '@/lib/billingAllocationTypes';
import { formatWon } from '@/lib/currency';
import BillingAllocationView, { type ReviewUpdater } from './BillingAllocationView';
import BillingLineModal from './BillingLineModal';

type Props = {
  initialLines: BillingLine[];
  summary: ReviewSummary | null;
  initialView: BillingView;
  review: AllocationReview | null;
};

export default function BillingPage({ initialLines, summary: initialSummary, initialView, review: initialReview }: Props) {
  const router = useRouter();
  const [view, setView] = useState<BillingView>(initialView);
  const [review, setReview] = useState<AllocationReview | null>(initialReview);
  const [summary, setSummary] = useState<ReviewSummary | null>(initialSummary ?? initialReview?.summary ?? null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [allocSearch, setAllocSearch] = useState('');
  // 한쪽 보기에서 바꾼 게 다른 보기 목록에 아직 안 맞을 때 — 그 보기로 갈 때 서버에서 다시 읽음
  const stale = useRef<{ groups: boolean; assignments: boolean }>({ groups: false, assignments: false });

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

  /** 자산번호 확인 자료를 서버에서 읽음. silent = 화면은 그대로 두고 조용히 갱신 */
  async function loadReview(silent: boolean) {
    if (!silent) {
      setReviewLoading(true);
      setReviewError('');
    }
    try {
      const r = await getAllocationReview();
      if (r.ok) {
        setReview(r.data);
        setSummary(r.data.summary);
        stale.current = { groups: false, assignments: false };
        setReviewError('');
      } else if (!silent) {
        setReviewError(r.error);
      } else {
        showToast(r.error);
      }
    } catch {
      if (!silent) setReviewError('불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      if (!silent) setReviewLoading(false);
    }
  }

  // 확인·지정 보기인데 자료가 없으면(보기만 바꿔서 온 경우) 읽어 옴
  useEffect(() => {
    if (view !== 'lines' && !review && !reviewLoading && !reviewError) void loadReview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, review]);

  function switchView(next: BillingView) {
    if (next === view) return;
    setView(next);
    router.replace(next === 'lines' ? '?view=lines' : `?view=${next}`, { scroll: false });
    if (next === 'review' && review && stale.current.groups) void loadReview(true);
    if (next === 'assigned' && review && stale.current.assignments) void loadReview(true);
  }

  const handleReviewChange = (updater: ReviewUpdater, staleFor: 'groups' | 'assignments') => {
    setReview((cur) => {
      if (!cur) return cur;
      const next = updater(cur);
      setSummary(next.summary);
      return next;
    });
    stale.current[staleFor] = true;
  };

  function openRentalReview(vendorName: string) {
    setAllocSearch(vendorName);
    switchView('review');
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

  function handleResolveSubmit(line: BillingLine) {
    if (!resolveAssetId.trim()) return;
    startTransition(async () => {
      // 임대 건 연결은 그대로 둠(null 로 보내면 연결이 지워졌음)
      const result = await resolveBillingAllocation(line.id, resolveAssetId.trim(), line.rentalSheetRow);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setResolvingId(null);
      setResolveAssetId('');
      showToast('배분을 확인했어요.');
      stale.current = { groups: true, assignments: true };
      await refetch();
    });
  }

  const assignedCount = review ? review.assignments.length : null;

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="meta" style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>
          최근 {lines.length}건 표시
          {summary && summary.rentals > 0 && ` · 자산번호 없는 임대 건 ${summary.rentals}개`}
          {summary && summary.orphanLines > 0 && ` · 임대 건 모르는 청구 ${summary.orphanLines}줄`}
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

      <div className="chip-group" style={{ marginBottom: '12px' }}>
        <button type="button" className={`chip${view === 'lines' ? ' active' : ''}`} onClick={() => switchView('lines')}>
          청구 명세
        </button>
        <button type="button" className={`chip${view === 'review' ? ' active' : ''}`} onClick={() => switchView('review')}>
          자산번호 확인{summary ? ` ${summary.rentals}` : ''}
        </button>
        <button type="button" className={`chip${view === 'assigned' ? ' active' : ''}`} onClick={() => switchView('assigned')}>
          지정한 것{assignedCount !== null ? ` ${assignedCount}` : ''}
        </button>
      </div>

      {view !== 'lines' && (
        <>
          {reviewLoading && !review && (
            <div className="empty-state">
              <div>⏳</div>불러오는 중…
            </div>
          )}
          {reviewError && !review && (
            <div className="empty-state">
              <div>⚠️</div>
              {reviewError}
              <div style={{ marginTop: '12px' }}>
                <button type="button" className="btn btn-ghost" onClick={() => void loadReview(false)}>
                  다시 불러오기
                </button>
              </div>
            </div>
          )}
          {review && (
            <BillingAllocationView
              mode={view === 'assigned' ? 'assigned' : 'review'}
              review={review}
              search={allocSearch}
              onSearchChange={setAllocSearch}
              onReviewChange={handleReviewChange}
              onReload={() => loadReview(true)}
              onToast={showToast}
            />
          )}
        </>
      )}

      {view === 'lines' && (
        <>
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
                배분 확인 필요만{summary ? ` (${summary.lines}줄)` : ''}
              </button>
            </div>
          </div>

          {/* 핸드폰에선 카드(m-cards) — data-m 은 components/MobileTableCards.tsx 참고 */}
          <table className="m-cards">
            <thead>
              <tr>
                <th>청구일</th>
                <th data-m="title">자산번호</th>
                <th data-m="sub">거래처</th>
                <th>청구번호</th>
                <th>금액</th>
                <th data-m="badge">상태</th>
                <th>배분</th>
                <th data-m="actions"></th>
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
                    ) : l.sourceInvoiceId === 'works-asset' && l.rentalSheetRow !== null ? (
                      <button type="button" className="chip" onClick={() => openRentalReview(l.vendorName)}>
                        임대 건으로 확인 →
                      </button>
                    ) : resolvingId === l.id ? (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <input
                          value={resolveAssetId}
                          onChange={(e) => setResolveAssetId(e.target.value)}
                          placeholder="자산번호"
                          style={{ width: '90px' }}
                        />
                        <button type="button" className="btn btn-ghost" onClick={() => handleResolveSubmit(l)}>
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
        </>
      )}

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
