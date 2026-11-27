'use client';

import { useEffect, useMemo, useState } from 'react';
import { lookupKnownAsset } from '@/app/actions';
import {
  clearRentalAllocation,
  confirmRentalAllocation,
  confirmRentalAllocations,
  resolveBillingAllocation,
  suggestFromInventory,
} from '@/app/billing/actions';
import type { BillingLine } from '@/lib/billing';
import type {
  AllocationGroup,
  AllocationReview,
  AllocationSuggestion,
  AssignmentState,
} from '@/lib/billingAllocationTypes';
import { formatWon } from '@/lib/currency';

const ASSIGNED_BY_KEY = 'firstoa-it.billing-assigned-by';
const PAGE_SIZE = 100;
const BULK_MAX = 100;

const STATE_BADGE: Record<AssignmentState, { cls: string; label: string }> = {
  active: { cls: 'badge-상품화완료', label: '적용 중' },
  works_same: { cls: 'badge-임대중', label: 'works에도 같은 번호' },
  works_differs: { cls: 'badge-상품화준비중', label: 'works와 다름 — works 번호로 집계 중' },
  rental_gone: { cls: 'badge-미정', label: '임대 건 없어짐' },
};

const normalizeId = (v: string) => v.trim().toUpperCase();

/** 지정한 사람 이름 — 한 번만 묻고 이 브라우저에 기억(로그인 기능 전이라) */
function getAssignedBy(): string | null {
  let saved = '';
  try {
    saved = localStorage.getItem(ASSIGNED_BY_KEY) ?? '';
  } catch {
    /* 저장소 막힘 — 매번 물어봄 */
  }
  if (saved.trim()) return saved.trim();
  const typed = (window.prompt('지정하는 분 이름을 적어 주세요. (한 번만 물어봐요)') ?? '').trim();
  if (!typed) return null;
  try {
    localStorage.setItem(ASSIGNED_BY_KEY, typed);
  } catch {
    /* 무시 */
  }
  return typed;
}

function distinctIds(suggestions: AllocationSuggestion[]): string[] {
  return Array.from(new Set(suggestions.map((s) => s.assetId)));
}

export type ReviewUpdater = (r: AllocationReview) => AllocationReview;

type Props = {
  mode: 'review' | 'assigned';
  review: AllocationReview;
  search: string;
  onSearchChange: (v: string) => void;
  /** 화면에서 바로 바꾼 결과를 위(BillingPage)에 알림 — stale = 다른 보기는 다시 읽어야 함 */
  onReviewChange: (updater: ReviewUpdater, stale: 'groups' | 'assignments') => void;
  /** 서버에서 다시 읽기(화면은 그대로 두고) */
  onReload: () => Promise<void>;
  onToast: (msg: string) => void;
};

export default function BillingAllocationView({ mode, review, search, onSearchChange, onReviewChange, onReload, onToast }: Props) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [hints, setHints] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extra, setExtra] = useState<Record<number, AllocationSuggestion[]>>({});
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [finding, setFinding] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const disabledAll = review.tableMissing;

  // 검색어가 바뀌면 처음 100개부터 다시
  useEffect(() => {
    setShown(PAGE_SIZE);
  }, [search]);

  function markBusy(row: number, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(row);
      else next.delete(row);
      return next;
    });
  }

  const suggestionsOf = (g: AllocationGroup): AllocationSuggestion[] => {
    const merged = [...g.suggestions, ...(extra[g.rentalSheetRow] ?? [])];
    const seen = new Set<string>();
    return merged.filter((s) => {
      const key = `${s.assetId}|${s.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const inputOf = (g: AllocationGroup): string => {
    const typed = inputs[g.rentalSheetRow];
    if (typed !== undefined) return typed;
    const ids = distinctIds(suggestionsOf(g));
    return ids.length === 1 ? ids[0] : '';
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? review.groups.filter((g) =>
          `${g.vendorName} ${g.siteName} ${g.item} ${g.manufacturer} ${g.modelName} ${g.serialNumber}`.toLowerCase().includes(term),
        )
      : review.groups.slice();
    return list.sort((a, b) => b.lastMonth.localeCompare(a.lastMonth) || b.amountSum - a.amountSum);
  }, [review.groups, search]);

  const visible = filtered.slice(0, shown);

  async function handleBlur(g: AllocationGroup) {
    const value = normalizeId(inputOf(g));
    if (!value) {
      setHints((h) => ({ ...h, [g.rentalSheetRow]: '' }));
      return;
    }
    try {
      const r = await lookupKnownAsset(value);
      const msg = r.found
        ? `${r.source === 'inventory' ? 'IT재고' : '임대리스트'}에 있음 (${[r.category, r.model].filter(Boolean).join('·')})`
        : 'IT재고에 없음 — 확인해 주세요';
      setHints((h) => ({ ...h, [g.rentalSheetRow]: msg }));
    } catch {
      setHints((h) => ({ ...h, [g.rentalSheetRow]: '' })); // 안내만이라 실패해도 조용히
    }
  }

  async function handleConfirm(g: AllocationGroup) {
    const assetId = normalizeId(inputOf(g));
    if (!assetId) {
      onToast('자산번호를 입력해 주세요.');
      return;
    }
    if (!window.confirm(`이 임대 건 청구 ${g.lineCount}줄을 ${assetId}로 확정할까요?`)) return;
    const who = getAssignedBy();
    if (!who) {
      onToast('이름을 적어야 확정할 수 있어요.');
      return;
    }
    markBusy(g.rentalSheetRow, true);
    try {
      const r = await confirmRentalAllocation(g.rentalSheetRow, assetId, who);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      onReviewChange(
        (cur) => ({
          ...cur,
          groups: cur.groups.filter((x) => x.rentalSheetRow !== g.rentalSheetRow),
          summary: {
            ...cur.summary,
            rentals: Math.max(0, cur.summary.rentals - 1),
            lines: Math.max(0, cur.summary.lines - r.lines),
          },
        }),
        'assignments',
      );
      setSelected((s) => {
        const next = new Set(s);
        next.delete(g.rentalSheetRow);
        return next;
      });
      onToast(`${r.lines}줄 확정했어요.`);
    } catch {
      onToast('확정하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      markBusy(g.rentalSheetRow, false);
    }
  }

  async function handleFindFromInventory() {
    const serials = Array.from(
      new Set(
        visible
          .map((g) => g.serialNumber.trim())
          .filter((s) => s.length >= 4 && s !== '-'),
      ),
    );
    if (serials.length === 0) {
      onToast('시리얼이 있는 임대 건이 없어요.');
      return;
    }
    setFinding(true);
    try {
      const r = await suggestFromInventory(serials);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      let found = 0;
      const add: Record<number, AllocationSuggestion[]> = {};
      for (const g of visible) {
        const ids = r.matches[g.serialNumber.trim()] ?? [];
        if (ids.length === 0) continue;
        found += 1;
        add[g.rentalSheetRow] = ids.map((assetId) => ({ assetId, source: 'inventory_serial', detail: 'IT재고에서 같은 시리얼을 찾음' }));
      }
      setExtra((prev) => ({ ...prev, ...add }));
      // 못 읽은 탭이 있으면 "못 찾음"이 진짜 없는 건지 모르므로 이유를 같이(r.warning)
      onToast(
        (found > 0 ? `${found}건에서 IT재고 추천을 찾았어요.` : 'IT재고에서 같은 시리얼을 찾지 못했어요.') +
          (r.warning ? ` ⚠️ ${r.warning}` : ''),
      );
    } catch {
      onToast('IT재고를 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setFinding(false);
    }
  }

  // 추천이 딱 한 가지인 임대 건만 체크 가능
  const oneSuggestion = (g: AllocationGroup): string | null => {
    const ids = distinctIds(suggestionsOf(g));
    return ids.length === 1 ? ids[0] : null;
  };

  const selectable = visible.filter((g) => oneSuggestion(g) !== null);
  const selectedGroups = review.groups.filter((g) => selected.has(g.rentalSheetRow) && oneSuggestion(g) !== null);

  function toggleSelect(row: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else if (next.size < BULK_MAX) next.add(row);
      else onToast(`한 번에 ${BULK_MAX}건까지만 고를 수 있어요.`);
      return next;
    });
  }

  function toggleSelectAll() {
    const allOn = selectable.length > 0 && selectable.every((g) => selected.has(g.rentalSheetRow));
    setSelected(allOn ? new Set() : new Set(selectable.slice(0, BULK_MAX).map((g) => g.rentalSheetRow)));
  }

  async function handleBulk() {
    const items = selectedGroups.map((g) => ({ rentalSheetRow: g.rentalSheetRow, assetId: oneSuggestion(g) as string }));
    if (items.length === 0) return;
    if (!window.confirm(`선택한 ${items.length}건을 추천 번호대로 확정할까요?`)) return;
    const who = getAssignedBy();
    if (!who) {
      onToast('이름을 적어야 확정할 수 있어요.');
      return;
    }
    setBulkBusy(true);
    try {
      const r = await confirmRentalAllocations(items, who);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      onToast(r.failed > 0 ? `${r.succeeded}건 확정(${r.lines}줄) · ${r.failed}건은 못 했어요.` : `${r.succeeded}건 확정했어요 (${r.lines}줄).`);
      setSelected(new Set());
      await onReload(); // 어느 건이 됐는지 서버 기준으로 다시 읽음
    } catch {
      onToast('일괄 확정하지 못했어요. 목록을 다시 확인해 주세요.');
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleClear(a: AllocationReview['assignments'][number]) {
    if (
      !window.confirm(
        `${a.vendorName || '이 임대 건'}의 지정(${a.assetId})을 되돌릴까요?\n되돌리면 이 번호로 확정됐던 청구 줄 중 works에 번호가 없는 줄이 다시 "확인 필요"로 돌아가요.`,
      )
    )
      return;
    markBusy(a.rentalSheetRow, true);
    try {
      const r = await clearRentalAllocation(a.rentalSheetRow);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      onReviewChange((cur) => ({ ...cur, assignments: cur.assignments.filter((x) => x.rentalSheetRow !== a.rentalSheetRow) }), 'groups');
      onToast(`되돌렸어요 (${r.lines}줄).`);
    } catch {
      onToast('되돌리지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      markBusy(a.rentalSheetRow, false);
    }
  }

  const tableNotice = disabledAll && (
    <div className="panel" style={{ borderColor: 'var(--amber-600)', color: 'var(--amber-600)', fontSize: '13px', fontWeight: 600 }}>
      Supabase SQL Editor에서 supabase/rental_asset_assignments_schema.sql 을 한 번 실행해 주세요. 그 전에는 확정·되돌리기를 할 수 없어요.
    </div>
  );

  // ---------- 지정한 것 ----------
  if (mode === 'assigned') {
    return (
      <>
        {tableNotice}
        <table className="m-cards">
          <thead>
            <tr>
              <th data-m="title" data-label="거래처">거래처·현장</th>
              <th data-m="badge">상태</th>
              <th data-m="inline" data-label="지정 번호">지정 번호</th>
              <th data-m="inline" data-label="기기">기기</th>
              <th data-m="sub" data-label="지정">지정한 사람·날짜</th>
              <th data-m="actions"></th>
            </tr>
          </thead>
          <tbody>
            {review.assignments.map((a) => {
              const st = STATE_BADGE[a.state];
              return (
                <tr key={a.rentalSheetRow}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{a.vendorName || '-'}</div>
                    {a.siteName && <div style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{a.siteName}</div>}
                  </td>
                  <td>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="asset-id" style={{ cursor: 'default' }}>
                    {a.assetId}
                    {a.state === 'works_differs' && a.worksAssetCode && (
                      <div style={{ fontSize: '11.5px', color: 'var(--amber-600)', fontWeight: 600 }}>works 번호 {a.worksAssetCode}</div>
                    )}
                  </td>
                  <td>
                    {[a.modelName, a.serialNumber && `S/N ${a.serialNumber}`].filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td>
                    {a.assignedBy || '-'} · {a.createdAt ? a.createdAt.slice(0, 10) : '-'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={disabledAll || busy.has(a.rentalSheetRow)}
                      onClick={() => handleClear(a)}
                    >
                      {busy.has(a.rentalSheetRow) ? '되돌리는 중…' : '되돌리기'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {review.assignments.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  <div>📋</div>아직 지정한 자산번호가 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </>
    );
  }

  // ---------- 자산번호 확인 ----------
  const allOn = selectable.length > 0 && selectable.every((g) => selected.has(g.rentalSheetRow));

  return (
    <>
      {tableNotice}
      <div className="panel">
        <div className="search-row" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: 0 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="거래처 / 모델 / 시리얼 검색"
            style={{ flex: '1 1 220px', minWidth: 0 }}
          />
          <button type="button" className="btn btn-ghost" disabled={finding || visible.length === 0} onClick={handleFindFromInventory}>
            {finding ? 'IT재고 읽는 중…' : 'IT재고에서 시리얼로 찾기'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabledAll || bulkBusy || selectedGroups.length === 0}
            onClick={handleBulk}
          >
            {bulkBusy ? '확정 중…' : `선택한 ${selectedGroups.length}건 추천대로 확정`}
          </button>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--ink-500)', marginTop: '8px' }}>
          추천 번호가 한 가지인 건만 체크할 수 있어요(한 번에 {BULK_MAX}건까지). 확정하기 전에 꼭 확인 창이 떠요.
        </div>
      </div>

      <table className="m-cards">
        <thead>
          <tr>
            <th data-m="check">
              <input type="checkbox" checked={allOn} disabled={selectable.length === 0 || disabledAll} onChange={toggleSelectAll} aria-label="추천 한 가지인 건 모두 선택" />
            </th>
            <th data-m="title" data-label="거래처">거래처·현장</th>
            <th data-m="badge">상태</th>
            <th data-m="inline" data-label="모델">품목·모델</th>
            <th data-m="inline" data-label="시리얼">시리얼</th>
            <th data-m="sub" data-label="계약">계약</th>
            <th data-m="sub" data-label="청구">청구 기간·줄·합계</th>
            <th data-m="full" data-label="추천">추천</th>
            <th data-m="actions">자산번호 확인</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((g) => {
            const sugg = suggestionsOf(g);
            const ids = distinctIds(sugg);
            const one = ids.length === 1;
            const row = g.rentalSheetRow;
            const value = inputOf(g);
            const model = [g.item, g.manufacturer, g.modelName].filter(Boolean).join(' ');
            return (
              <tr key={row}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(row)}
                    disabled={!one || disabledAll}
                    onChange={() => toggleSelect(row)}
                    aria-label={`${g.vendorName} 선택`}
                  />
                </td>
                <td>
                  <div style={{ fontWeight: 700 }}>{g.vendorName || '(거래처 없음)'}</div>
                  {g.siteName && <div style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{g.siteName}</div>}
                </td>
                <td>{g.rentalStatus ? <span className="badge badge-미정" style={{ whiteSpace: 'nowrap' }}>{g.rentalStatus}</span> : null}</td>
                <td>{model || '-'}</td>
                <td>{g.serialNumber && g.serialNumber !== '-' ? g.serialNumber : '-'}</td>
                <td>
                  {g.contractDate || '-'}
                  {g.endDate ? ` ~ ${g.endDate}` : ''}
                </td>
                <td>
                  {g.firstMonth === g.lastMonth ? g.firstMonth : `${g.firstMonth} ~ ${g.lastMonth}`} · {g.lineCount}줄 · {formatWon(g.amountSum)}
                </td>
                <td>
                  {sugg.length === 0 ? (
                    <span style={{ fontSize: '12px', color: 'var(--ink-400)' }}>추천 없음</span>
                  ) : one ? (
                    // detail 이 이미 출처를 말함("같은 시리얼 — 임대리스트 …") — 앞에 출처 이름을 또 붙이면 겹침
                    <span style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{sugg[0].detail}</span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
                      {ids.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={`chip${normalizeId(value) === id ? ' active' : ''}`}
                          title={sugg.filter((s) => s.assetId === id).map((s) => s.detail).join(' / ')}
                          onClick={() => setInputs((p) => ({ ...p, [row]: id }))}
                        >
                          {id}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        value={value}
                        onChange={(e) => setInputs((p) => ({ ...p, [row]: e.target.value }))}
                        onBlur={() => handleBlur(g)}
                        placeholder="자산번호"
                        style={{ flex: '1 1 auto', minWidth: '110px', width: '130px' }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
                        disabled={disabledAll || busy.has(row) || bulkBusy || !value.trim()}
                        onClick={() => handleConfirm(g)}
                      >
                        {busy.has(row) ? '확정 중…' : '확정'}
                      </button>
                    </div>
                    {hints[row] && (
                      <div style={{ fontSize: '11.5px', color: hints[row].includes('없음') ? 'var(--amber-600)' : 'var(--green-600)' }}>{hints[row]}</div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={9} className="empty-state">
                <div>✅</div>
                {review.groups.length === 0 ? '자산번호 없는 임대 건이 없어요' : '검색 조건에 맞는 임대 건이 없어요.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {filtered.length > shown && (
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            더 보기 ({shown}/{filtered.length})
          </button>
        </div>
      )}

      <OrphanLines lines={review.orphanLines} onReviewChange={onReviewChange} onToast={onToast} />
    </>
  );
}

/** 임대 건을 모르는 확인 필요 줄 — 줄마다 자산번호 지정(임대 건 연결은 원래 없음) */
function OrphanLines({
  lines,
  onReviewChange,
  onToast,
}: {
  lines: BillingLine[];
  onReviewChange: Props['onReviewChange'];
  onToast: (msg: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  if (lines.length === 0) return null;

  async function submit(l: BillingLine) {
    const assetId = (values[l.id] ?? '').trim();
    if (!assetId) return;
    setBusyId(l.id);
    try {
      const r = await resolveBillingAllocation(l.id, assetId, null);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      onReviewChange(
        (cur) => ({
          ...cur,
          orphanLines: cur.orphanLines.filter((x) => x.id !== l.id),
          summary: {
            ...cur.summary,
            orphanLines: Math.max(0, cur.summary.orphanLines - 1),
            lines: Math.max(0, cur.summary.lines - 1),
          },
        }),
        'groups',
      );
      onToast('자산번호를 지정했어요.');
    } catch {
      onToast('지정하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <details style={{ marginTop: '18px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '13.5px', color: 'var(--ink-500)', padding: '8px 0' }}>
        임대 건 모르는 청구 {lines.length}줄
      </summary>
      <div style={{ fontSize: '12px', color: 'var(--ink-500)', marginBottom: '8px' }}>
        기기와 연결이 없는 청구 줄이에요. 줄마다 자산번호를 적어 주세요.
      </div>
      <table className="m-cards">
        <thead>
          <tr>
            <th data-m="sub" data-label="청구일">청구일</th>
            <th data-m="title" data-label="거래처">거래처</th>
            <th data-m="badge">금액</th>
            <th data-m="hide">청구번호</th>
            <th data-m="actions">자산번호</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.billingDate || '-'}</td>
              <td>{l.vendorName || '(거래처 없음)'}</td>
              <td>{formatWon(l.amount)}</td>
              <td>{l.sourceInvoiceId || '-'}</td>
              <td>
                <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
                  <input
                    value={values[l.id] ?? ''}
                    onChange={(e) => setValues((p) => ({ ...p, [l.id]: e.target.value }))}
                    placeholder="자산번호"
                    style={{ flex: '1 1 auto', minWidth: '110px', width: '130px' }}
                  />
                  <button type="button" className="btn btn-ghost" disabled={busyId === l.id || !(values[l.id] ?? '').trim()} onClick={() => submit(l)}>
                    {busyId === l.id ? '저장 중…' : '지정'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
