'use client';

import { useEffect, useState } from 'react';
import { listAssetMovements, logAssetNote, type AssetNoteEntry } from '@/app/actions';
import { getAssetAsRecords } from '@/app/asset-history/actions';
import { createBillingLine, getAssetBillingLines, getAssetRentalHistory } from '@/app/billing/actions';
import type { AsRecord } from '@/lib/as/sheet';
import { computeRecoveryRate, type BillingLine, type RentalHistoryEntry } from '@/lib/billing';
import { formatWon, parseKoreanWon } from '@/lib/currency';
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

  const [rentalHistory, setRentalHistory] = useState<RentalHistoryEntry[]>([]);
  const [billingLines, setBillingLines] = useState<BillingLine[]>([]);
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ row: number | null; amount: string; date: string; status: string } | null>(
    null,
  );
  const [quickAddPending, setQuickAddPending] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');

  const assetId = item?.assetId ?? '';
  const category = item?.category ?? '';
  const serialNo = item?.serialNo ?? '';

  const [asRecords, setAsRecords] = useState<AsRecord[] | null>(null);
  useEffect(() => {
    if (!open || !assetId) {
      setAsRecords(null);
      return;
    }
    let cancelled = false;
    getAssetAsRecords(assetId, serialNo).then((rows) => {
      if (!cancelled) setAsRecords(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, assetId, serialNo]);

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

  async function reloadBilling() {
    const [history, lines] = await Promise.all([getAssetRentalHistory(assetId), getAssetBillingLines(assetId)]);
    setRentalHistory(history);
    setBillingLines(lines);
    setBillingLoaded(true);
  }

  useEffect(() => {
    if (!open || !assetId) {
      setRentalHistory([]);
      setBillingLines([]);
      setBillingLoaded(false);
      setExpandedRow(null);
      setQuickAdd(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [history, lines] = await Promise.all([getAssetRentalHistory(assetId), getAssetBillingLines(assetId)]);
      if (!cancelled) {
        setRentalHistory(history);
        setBillingLines(lines);
        setBillingLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assetId]);

  function parsePurchasePrice(raw: string | undefined): number | null {
    if (!raw || !raw.trim()) return null;
    const won = parseKoreanWon(raw);
    if (won !== null) return won;
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : null;
  }

  async function handleQuickAdd() {
    if (!quickAdd || !quickAdd.amount.trim() || !quickAdd.date) {
      setQuickAddError('금액과 청구일을 입력해주세요.');
      return;
    }
    const amount = parsePurchasePrice(quickAdd.amount) ?? Number(quickAdd.amount.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(amount) || amount === 0) {
      setQuickAddError('금액이 올바르지 않아요.');
      return;
    }
    setQuickAddPending(true);
    setQuickAddError('');
    const rental = rentalHistory.find((r) => r.sheetRow === quickAdd.row);
    const result = await createBillingLine({
      sourceInvoiceId: '',
      sourceLineId: '',
      assetId,
      rentalSheetRow: quickAdd.row,
      vendorName: rental?.vendorName ?? '',
      billingDate: quickAdd.date,
      periodStart: '',
      periodEnd: '',
      amount: quickAdd.status === '조정' ? -Math.abs(amount) : Math.abs(amount),
      status: quickAdd.status,
      allocationStatus: 'confirmed',
      note: '',
    });
    setQuickAddPending(false);
    if (!result.ok) {
      setQuickAddError(result.error);
      return;
    }
    setQuickAdd(null);
    await reloadBilling();
  }

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

        <div className="detail-section-title">임대·청구</div>
        {(() => {
          const purchasePrice = parsePurchasePrice(item.purchasePrice);
          const recovery = computeRecoveryRate(purchasePrice, billingLines);
          const activeRentals = rentalHistory.filter((r) => r.status !== '임대종료');
          // billingLoaded 전엔 rentalHistory가 항상 빈 배열이라 "불일치"로 오판할 수 있어서,
          // 로딩이 끝난 뒤에만 판단합니다.
          const mismatch = billingLoaded && item.status === '임대중' && activeRentals.length === 0;

          return (
            <div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <div className="detail-field">
                  <span className="detail-label">구매단가</span>
                  <span className="detail-value">{purchasePrice !== null ? formatWon(purchasePrice) : '구매단가 미입력'}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-label">누적 청구액</span>
                  <span className="detail-value">
                    {recovery.kind === 'ok' || recovery.kind === 'zero_price' || recovery.kind === 'no_price'
                      ? formatWon(billingLines.filter((l) => l.status !== '취소' && l.allocationStatus === 'confirmed').reduce((s, l) => s + l.amount, 0))
                      : '청구 미확인'}
                  </span>
                </div>
                <div className="detail-field">
                  <span className="detail-label">원가회수율(청구 기준)</span>
                  <span className="detail-value">
                    {recovery.kind === 'ok'
                      ? `${recovery.ratePercent.toFixed(1)}%`
                      : recovery.kind === 'no_price'
                        ? '구매단가 미입력'
                        : recovery.kind === 'zero_price'
                          ? '회수율 산정 불가'
                          : '청구 미확인'}
                  </span>
                </div>
              </div>

              {mismatch && (
                <div className="detail-empty" style={{ color: 'var(--red-600)', marginBottom: '10px' }}>
                  ⚠️ 재고 상태(임대중)와 임대리스트 기록이 어긋나요 — 임대리스트를 확인해주세요.
                </div>
              )}

              {(() => {
                const unassigned = billingLines.filter((l) => l.rentalSheetRow === null);
                const unassignedSubtotal = unassigned
                  .filter((l) => l.status !== '취소' && l.allocationStatus === 'confirmed')
                  .reduce((s, l) => s + l.amount, 0);
                return (
                  <>
                    {!billingLoaded ? (
                      <div className="detail-empty">불러오는 중…</div>
                    ) : rentalHistory.length === 0 && unassigned.length === 0 ? (
                      <div className="detail-empty">임대리스트에 이 자산번호로 등록된 임대 건이 없어요.</div>
                    ) : (
                      <>
                        {rentalHistory.map((r) => {
                  const lines = billingLines.filter((l) => l.rentalSheetRow === r.sheetRow);
                  const subtotal = lines.filter((l) => l.status !== '취소' && l.allocationStatus === 'confirmed').reduce((s, l) => s + l.amount, 0);
                  const expanded = expandedRow === r.sheetRow;
                  return (
                    <div key={r.sheetRow} className="detail-history-entry" style={{ cursor: 'pointer' }}>
                      <div onClick={() => setExpandedRow(expanded ? null : r.sheetRow)} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <span>
                          <strong>{r.vendorName || '거래처 미상'}</strong>
                          {r.siteName ? ` · ${r.siteName}` : ''}
                          <span style={{ color: 'var(--ink-400)' }}>
                            {' '}
                            ({r.contractDate || '시작일 미상'} ~ {r.endDate || '진행중'})
                          </span>
                          <span className={`badge ${r.status === '임대종료' ? 'badge-미정' : 'badge-임대중'}`} style={{ marginLeft: '6px' }}>
                            {r.status || '-'}
                          </span>
                        </span>
                        <span style={{ fontWeight: 700 }}>{formatWon(subtotal)}</span>
                      </div>

                      {expanded && (
                        <div style={{ marginTop: '8px', paddingLeft: '4px', borderLeft: '2px solid var(--ink-100)' }}>
                          {lines.length === 0 ? (
                            <div className="sub">이 임대 건에 연결된 청구 명세가 없어요.</div>
                          ) : (
                            lines.map((l) => (
                              <div key={l.id} className="sub" style={{ marginBottom: '4px' }}>
                                {l.billingDate || '날짜 미상'} · {l.sourceInvoiceId || '청구번호 없음'} ·{' '}
                                <span className={l.status === '취소' ? 'badge badge-미정' : l.amount < 0 ? 'badge badge-수리중' : 'badge badge-상품화완료'}>
                                  {l.status}
                                </span>{' '}
                                {formatWon(l.amount)}
                              </div>
                            ))
                          )}

                          {quickAdd?.row === r.sheetRow ? (
                            <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              <input
                                type="date"
                                value={quickAdd.date}
                                onChange={(e) => setQuickAdd({ ...quickAdd, date: e.target.value })}
                                style={{ width: '140px' }}
                              />
                              <input
                                value={quickAdd.amount}
                                onChange={(e) => setQuickAdd({ ...quickAdd, amount: e.target.value })}
                                placeholder="금액(예: 300000)"
                                style={{ width: '140px' }}
                              />
                              <select value={quickAdd.status} onChange={(e) => setQuickAdd({ ...quickAdd, status: e.target.value })}>
                                <option value="확정">확정</option>
                                <option value="조정">조정(감액)</option>
                                <option value="취소">취소</option>
                              </select>
                              <button type="button" className="btn btn-ghost" disabled={quickAddPending} onClick={handleQuickAdd}>
                                {quickAddPending ? '저장 중…' : '저장'}
                              </button>
                              <button type="button" className="btn btn-ghost" onClick={() => setQuickAdd(null)}>
                                취소
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ marginTop: '6px' }}
                              onClick={() =>
                                setQuickAdd({ row: r.sheetRow, amount: '', date: new Date().toISOString().slice(0, 10), status: '확정' })
                              }
                            >
                              + 청구 명세 추가
                            </button>
                          )}
                          {quickAdd?.row === r.sheetRow && quickAddError && (
                            <div style={{ fontSize: '12px', color: 'var(--red-600)', marginTop: '4px' }}>{quickAddError}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                        })}

                        {unassigned.length > 0 && (
                          <div className="detail-history-entry">
                            <div
                              onClick={() => setExpandedRow(expandedRow === -1 ? null : -1)}
                              style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', cursor: 'pointer' }}
                            >
                              <span>
                                <strong>임대 건 미지정</strong>
                                <span style={{ color: 'var(--ink-400)' }}> (특정 임대 건에 연결 안 된 확정 청구)</span>
                              </span>
                              <span style={{ fontWeight: 700 }}>{formatWon(unassignedSubtotal)}</span>
                            </div>
                            {expandedRow === -1 && (
                              <div style={{ marginTop: '8px', paddingLeft: '4px', borderLeft: '2px solid var(--ink-100)' }}>
                                {unassigned.map((l) => (
                                  <div key={l.id} className="sub" style={{ marginBottom: '4px' }}>
                                    {l.billingDate || '날짜 미상'} · {l.sourceInvoiceId || '청구번호 없음'} ·{' '}
                                    <span className={l.status === '취소' ? 'badge badge-미정' : l.amount < 0 ? 'badge badge-수리중' : 'badge badge-상품화완료'}>
                                      {l.status}
                                    </span>{' '}
                                    {formatWon(l.amount)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          );
        })()}

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

        <div className="detail-section-title">
          AS접수 이력{asRecords ? ` ${asRecords.length}건` : ''}{' '}
          <a href={`/asset-history?q=${encodeURIComponent(assetId)}`} target="_blank" rel="noreferrer" style={{ fontSize: '12px', fontWeight: 400 }}>
            통합 조회 ↗
          </a>
        </div>
        {asRecords === null ? (
          <div className="detail-empty">불러오는 중…</div>
        ) : asRecords.length === 0 ? (
          <div className="detail-empty">AS 접수 기록이 없어요.</div>
        ) : (
          asRecords.map((r, i) => (
            <div key={i} className="detail-history-entry">
              <span style={{ color: 'var(--ink-400)', marginRight: '6px' }}>
                {r.receivedDate} · {r.status || '-'} · {r.company || '-'}
              </span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{r.symptom || '-'}</div>
              {r.action && <div className="sub" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-500)' }}>→ {r.action}</div>}
            </div>
          ))
        )}

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
