'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyStocktakeReviewBatch,
  bulkUpdateStocktakeItems,
  completeStocktake,
  lookupUnexpectedAsset,
  startStocktake,
  updateStocktakeItem,
  type ReviewApplyInput,
} from '@/app/stocktake/actions';
import { addStaffNameIfNew } from '@/app/actions';
import { resizeImageFile } from '@/lib/imageResize';
import { scanLabelImage } from '@/lib/ocrClient';
import { isLikelyAssetId, stocktakeSummary, type StocktakeSession } from '@/lib/stocktake';
import { CATEGORIES } from '@/lib/types';

const STARTED_BY_KEY = 'firstoa_stocktake_started_by';

const STATUS_LABEL: Record<string, string> = {
  미확인: '미확인',
  확인됨: '확인됨',
  목록외발견: '목록외 발견',
};

type ReviewStatus = '정상' | '위치변경' | '신규등록' | '인식실패';

type ReviewItem = {
  key: string;
  assetId: string;
  status: ReviewStatus;
  currentLocation?: string;
  category: string;
  model: string;
  brand?: string;
  errorNote?: string;
};

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  정상: '정상(확인됨)',
  위치변경: '위치변경 필요',
  신규등록: '신규등록 필요(ERP 미등록)',
  인식실패: '인식 실패',
};

const REVIEW_BADGE: Record<ReviewStatus, string> = {
  정상: 'badge-상품화완료',
  위치변경: 'badge-임대중',
  신규등록: 'badge-악성',
  인식실패: 'badge-기타',
};

type Props = {
  session: StocktakeSession;
  locations: string[];
  staffNames: string[];
  completedTodayLocations: string[];
};

export default function StocktakeSessionPage({ session, locations, staffNames, completedTodayLocations }: Props) {
  const router = useRouter();
  const [toast, setToast] = useState({ msg: '', show: false });
  const [nextLocation, setNextLocation] = useState('');
  const [nextStartedBy, setNextStartedBy] = useState(session.startedBy);
  const [startingNext, setStartingNext] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sum = stocktakeSummary(session.results);
  const done = session.status === '완료';

  // 신규등록 항목의 기본 품목값 — 이 위치에 이미 있던 자산들 중 가장 많은 품목으로 추정.
  const defaultCategory = (() => {
    const counts = new Map<string, number>();
    for (const r of session.results) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    let best = CATEGORIES[0] as string;
    let bestCount = 0;
    for (const [cat, count] of counts) {
      if (count > bestCount) {
        best = cat;
        bestCount = count;
      }
    }
    return best;
  })();

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

  /**
   * 여러 장 사진을 순서대로 OCR 인식해서 전산 재고와 비교한 뒤, 바로 반영하지 않고 검토
   * 목록으로 모아 보여줍니다(인포그래픽 플로우: 찍기 → 업로드 → 비교 → 차이 발견 → 반영).
   * - 이미 이 세션 목록에 있는 자산번호 → "정상"
   * - 전산상 다른 위치에 있는 자산번호 → "위치변경 필요"
   * - 전산 어디에도 없는 자산번호 → "신규등록 필요"
   */
  async function handleScanFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setScanProgress({ done: 0, total: files.length });
    const next: ReviewItem[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const { base64, mediaType } = await resizeImageFile(files[i]);
        const result = await scanLabelImage(base64, mediaType);
        const rawAssetId = result.ok ? result.fields.assetId : '';
        // 위치 라벨("A3" 등)이나 다른 텍스트를 잘못 읽은 경우 걸러냅니다 — 실제 자산번호는
        // 항상 영문자+숫자 3자리 이상 형식(예: P1388)이라 isLikelyAssetId로 한 번 더 검증.
        const assetId = rawAssetId && isLikelyAssetId(rawAssetId) ? rawAssetId : '';

        if (!assetId) {
          next.push({
            key: `fail-${i}`,
            assetId: rawAssetId ? `(인식 오류: "${rawAssetId}")` : '(인식 안 됨)',
            status: '인식실패',
            category: defaultCategory,
            model: '',
            errorNote: !result.ok
              ? result.error
              : rawAssetId
                ? '자산번호 형식이 아니에요(위치 라벨 등을 잘못 읽었을 수 있어요). 다시 찍어주세요.'
                : '사진에서 자산번호를 못 읽었어요.',
          });
        } else if (session.results.some((r) => r.assetId === assetId) || next.some((r) => r.assetId === assetId)) {
          next.push({ key: assetId, assetId, status: '정상', category: '', model: '' });
        } else {
          const lookup = await lookupUnexpectedAsset(assetId);
          if (lookup.ok) {
            next.push({
              key: assetId,
              assetId,
              status: '위치변경',
              currentLocation: lookup.info.location,
              category: lookup.info.category,
              model: lookup.info.model,
              brand: lookup.info.brand,
            });
          } else {
            next.push({
              key: assetId,
              assetId,
              status: '신규등록',
              category: defaultCategory,
              model: result.ok ? result.fields.model : '',
            });
          }
        }
      } catch (err) {
        next.push({
          key: `error-${i}`,
          assetId: '(오류)',
          status: '인식실패',
          category: defaultCategory,
          model: '',
          errorNote: err instanceof Error ? err.message : '사진을 읽는 중 오류가 났어요.',
        });
      }
      setScanProgress({ done: i + 1, total: files.length });
    }

    setReviewItems((prev) => [...prev, ...next]);
    setScanProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function updateReviewCategory(key: string, category: string) {
    setReviewItems((prev) => prev.map((it) => (it.key === key ? { ...it, category } : it)));
  }

  function removeReviewItem(key: string) {
    setReviewItems((prev) => prev.filter((it) => it.key !== key));
  }

  /** "재고 반영하기" — 검토 목록을 한꺼번에 적용합니다. 느린 구글시트 작업(위치변경/신규등록)은
   * 서버에서 병렬로 처리하고, 세션 결과는 한 번만 읽고 쓰도록 배치 액션 하나로 넘깁니다
   * (기존엔 항목마다 왕복해서 느렸고 동시 처리 시 세션 데이터가 덮어써질 위험도 있었음). */
  async function handleApplyReview() {
    setApplying(true);
    const applyItems: ReviewApplyInput[] = reviewItems
      .filter((item): item is ReviewItem & { status: '정상' | '위치변경' | '신규등록' } => item.status !== '인식실패')
      .map((item) => ({ assetId: item.assetId, status: item.status, category: item.category, model: item.model }));

    const result = await applyStocktakeReviewBatch(session.id, applyItems, session.location);

    setApplying(false);
    setReviewItems([]);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    showToast(
      result.failures.length === 0
        ? `${result.successCount}건 재고에 반영했어요. (웹앱 + 구글시트 모두 반영됨)`
        : `${result.successCount}건 반영, ${result.failures.length}건 실패 — ${result.failures.slice(0, 2).join(' / ')}`,
    );
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
      // 뒤로가기 해서 목록 → 새 조사 시작을 다시 누르는 번거로움 없이, 바로 다음 위치로
      // 넘어갈 수 있게 제안합니다(오늘 조사한 위치를 쭉 이어서 도는 현장 작업 흐름).
      if (result.ok) setJustCompleted(true);
    });
  }

  // 오늘 이미 끝낸 위치(방금 끝낸 이 위치 포함)는 다음 위치 후보에서 뺍니다.
  const nextLocationOptions = locations.filter(
    (loc) => loc !== session.location && !completedTodayLocations.includes(loc),
  );

  function handleStartNext() {
    if (!nextLocation.trim()) {
      showToast('다음 위치를 선택해주세요.');
      return;
    }
    setStartingNext(true);
    startTransition(async () => {
      const result = await startStocktake(nextLocation, nextStartedBy);
      setStartingNext(false);
      if (!result.ok || !result.id) {
        showToast(result.ok ? '세션을 만들지 못했어요.' : result.error);
        return;
      }
      const trimmedName = nextStartedBy.trim();
      try {
        localStorage.setItem(STARTED_BY_KEY, trimmedName);
      } catch {
        // 무시
      }
      if (trimmedName && !staffNames.includes(trimmedName)) {
        addStaffNameIfNew(trimmedName).catch(() => {});
      }
      router.push(`/stocktake/${result.id}`);
    });
  }

  const reviewCounts = {
    정상: reviewItems.filter((i) => i.status === '정상').length,
    위치변경: reviewItems.filter((i) => i.status === '위치변경').length,
    신규등록: reviewItems.filter((i) => i.status === '신규등록').length,
    인식실패: reviewItems.filter((i) => i.status === '인식실패').length,
  };

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <div className="meta" style={{ fontSize: '13px', fontWeight: 700 }}>
          확인 {sum.confirmed} / 전체 {sum.total}
          {sum.unexpected > 0 && <span style={{ color: 'var(--red-600)' }}> · 목록외 발견 {sum.unexpected}</span>}
          {done && <span style={{ marginLeft: '8px' }} className="badge badge-상품화완료">완료</span>}
        </div>
        <div className="actions">
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
            disabled={!!scanProgress || pending}
            onClick={() => fileInputRef.current?.click()}
          >
            {scanProgress ? `인식 중… (${scanProgress.done}/${scanProgress.total})` : '📷 사진 올려서 스캔'}
          </button>
          <span style={{ fontSize: '11.5px', color: 'var(--ink-400)' }}>
            {done
              ? '완료된 조사도 오타 등 수정이 필요하면 계속 스캔/체크할 수 있어요'
              : '먼저 카메라로 사진 다 찍어두고, 갤러리에서 여러 장 골라 올리면 한꺼번에 인식해요'}
          </span>
          {!done &&
            (confirmingComplete ? (
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
            ))}
        </div>
      </div>

      {justCompleted && (
        <div className="panel" style={{ marginBottom: '12px', borderColor: 'var(--green-100, #bbf7d0)' }}>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>✅ "{session.location}" 조사 종료 — 바로 다음 위치 시작할까요?</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select value={nextLocation} onChange={(e) => setNextLocation(e.target.value)}>
              <option value="">다음 위치 선택</option>
              {nextLocationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <input
              value={nextStartedBy}
              onChange={(e) => setNextStartedBy(e.target.value)}
              placeholder="담당자"
              style={{ width: '120px' }}
            />
            <button type="button" className="btn btn-primary" disabled={startingNext || pending} onClick={handleStartNext}>
              {startingNext ? '시작 중…' : '다음 위치 조사 시작'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => router.push('/stocktake')}>
              목록으로
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setJustCompleted(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {reviewItems.length > 0 && (
        <div className="panel" style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px' }}>
              차이 발견 — 전체 {reviewItems.length} · 정상 {reviewCounts.정상} · 위치변경 {reviewCounts.위치변경} · 신규등록{' '}
              {reviewCounts.신규등록}
              {reviewCounts.인식실패 > 0 && <span style={{ color: 'var(--ink-400)' }}> · 인식실패 {reviewCounts.인식실패}</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-ghost" disabled={applying} onClick={() => setReviewItems([])}>
                취소
              </button>
              <button type="button" className="btn btn-primary" disabled={applying} onClick={handleApplyReview}>
                {applying ? '반영 중…' : '✅ 재고 반영하기'}
              </button>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--ink-500)', margin: '6px 0 10px' }}>
            반영하면 위치변경·신규등록 건은 웹앱과 구글시트(IT재고 탭) 양쪽에 바로 반영돼요.
          </div>
          <table>
            <thead>
              <tr>
                <th>자산번호</th>
                <th>구분</th>
                <th>상세</th>
                <th style={{ width: '36px' }} />
              </tr>
            </thead>
            <tbody>
              {reviewItems.map((item) => (
                <tr key={item.key}>
                  <td>
                    <span className="asset-id">{item.assetId}</span>
                  </td>
                  <td>
                    <span className={`badge ${REVIEW_BADGE[item.status]}`}>{REVIEW_LABEL[item.status]}</span>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--ink-600)' }}>
                    {item.status === '위치변경' && (
                      <>
                        현재 위치: <b>{item.currentLocation || '위치 미상'}</b> → &quot;{session.location}&quot;(으)로 변경 ·{' '}
                        {item.brand} {item.model}
                      </>
                    )}
                    {item.status === '신규등록' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>품목:</span>
                        <select value={item.category} onChange={(e) => updateReviewCategory(item.key, e.target.value)}>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <span>· 위치: {session.location}</span>
                        {item.model && <span>· 모델명(인식): {item.model}</span>}
                      </div>
                    )}
                    {item.status === '정상' && '이 세션 목록에 있던 자산이에요 — 확인됨으로 처리돼요.'}
                    {item.status === '인식실패' && (item.errorNote || '다시 찍어주세요.')}
                  </td>
                  <td>
                    <button type="button" className="icon-btn" title="목록에서 제외" onClick={() => removeReviewItem(item.key)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected.size > 0 && (
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
              <th style={{ width: '32px' }}>
                <input
                  type="checkbox"
                  checked={session.results.length > 0 && session.results.every((r) => selected.has(r.assetId))}
                  onChange={toggleSelectAll}
                  aria-label="전체 선택"
                />
              </th>
              <th>자산번호</th>
              <th>품목</th>
              <th className="hide-mobile">브랜드</th>
              <th>모델명</th>
              <th>상태</th>
              <th>비고</th>
              <th style={{ width: '90px' }} />
            </tr>
          </thead>
          <tbody>
            {session.results.map((r) => (
              <tr key={r.assetId}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(r.assetId)}
                    onChange={() => toggleSelect(r.assetId)}
                    aria-label={`${r.assetId} 선택`}
                  />
                </td>
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
                <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{r.note || '-'}</td>
                <td>
                  <button type="button" className="chip" disabled={pending} onClick={() => toggleItem(r.assetId, r.status)}>
                    {r.status === '확인됨' ? '취소' : '확인'}
                  </button>
                </td>
              </tr>
            ))}
            {session.results.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-state">
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
