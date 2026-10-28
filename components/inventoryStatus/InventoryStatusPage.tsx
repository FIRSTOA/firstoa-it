'use client';

import { useMemo, useRef, useState } from 'react';
import { setSafetyStock } from '@/app/inventoryStatus/actions';
import { copyElementAsImage } from '@/lib/captureImage';
import { formatKstDateTime, type StocktakeConfirmation } from '@/lib/stocktake';
import {
  AVAILABLE_BREAKDOWN_STATUSES,
  BREAKDOWN_STATUSES,
  buildCategoryBreakdown,
  buildLocationCheckTables,
  type CategoryBreakdownAssetRef,
  type SafetyStock,
} from '@/lib/zoneStatus';
import { STATUSES, type Asset } from '@/lib/types';
import { DonutChart, StackedBar, StatusLegend, statusColor } from './charts';

type Props = {
  assets: Asset[];
  stocktakeConfirmations: Record<string, StocktakeConfirmation>;
  safetyStock: SafetyStock[];
};

type Drilldown = { title: string; assets: CategoryBreakdownAssetRef[] } | null;

function safetyKey(category: string, detailCode: string): string {
  return `${category}\u0000${detailCode}`;
}

export default function InventoryStatusPage({ assets, stocktakeConfirmations, safetyStock }: Props) {
  const [safety, setSafety] = useState(safetyStock);
  const [drilldown, setDrilldown] = useState<Drilldown>(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [capturing, setCapturing] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const verificationRef = useRef<HTMLDivElement>(null);

  const checkTables = useMemo(
    () => buildLocationCheckTables(assets, stocktakeConfirmations),
    [assets, stocktakeConfirmations],
  );
  const breakdown = useMemo(() => buildCategoryBreakdown(assets), [assets]);
  const grandTotal = breakdown.reduce((sum, g) => sum + g.total, 0);
  const safetyByKey = useMemo(() => new Map(safety.map((s) => [safetyKey(s.category, s.detailCode), s.safetyCount])), [safety]);

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  function openDrilldown(title: string, assetList: CategoryBreakdownAssetRef[]) {
    setDrilldown({ title, assets: assetList });
  }

  async function handleSetSafetyStock(category: string, detailCode: string, count: number) {
    setSafety((prev) => [...prev.filter((s) => !(s.category === category && s.detailCode === detailCode)), { category, detailCode, safetyCount: count }]);
    const result = await setSafetyStock(category, detailCode, count);
    if (!result.ok) showToast(result.error);
  }

  function availableCount(byStatus: Record<string, number>): number {
    return AVAILABLE_BREAKDOWN_STATUSES.reduce((s, st) => s + (byStatus[st] ?? 0), 0);
  }

  function availableAssets(assetList: CategoryBreakdownAssetRef[]): CategoryBreakdownAssetRef[] {
    return assetList.filter((a) => (AVAILABLE_BREAKDOWN_STATUSES as readonly string[]).includes(a.status));
  }

  async function handleCopyImage(key: string, ref: React.RefObject<HTMLDivElement | null>, name: string) {
    if (!ref.current || capturing) return;
    setCapturing(key);
    const result = await copyElementAsImage(ref.current, name);
    setCapturing(null);
    if (!result.ok) {
      showToast(result.error);
    } else {
      showToast(result.downloaded ? '이미지를 다운로드했어요 (클립보드 복사를 지원 안 하는 브라우저예요).' : '이미지를 복사했어요 — 카톡에 붙여넣어 주세요.');
    }
  }

  return (
    <div className="app">
      <div className="panel" style={{ marginBottom: '12px' }}>
        <div ref={summaryRef} style={{ background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px' }}>회사 총 재고: {grandTotal}대</div>
            <StatusLegend />
          </div>
          <div className="sub" style={{ marginBottom: '14px' }}>
            품목별로 구분코드(또는 모델명)별 대수와 재고상태를 보여줘요(임대중 포함). 가용재고는
            상품화준비중·상품화완료·수리중 합계예요. 안전재고를 입력하면 부족재고가 자동으로
            계산돼요. 숫자를 누르면 해당 자산번호/스펙을 볼 수 있어요.
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '10px' }}>
            {breakdown.map(({ category, total, totalByStatus }) => (
              <div
                key={category}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  border: '1px solid var(--ink-100)',
                  borderRadius: '12px',
                  minWidth: '220px',
                  flex: '1 1 220px',
                }}
              >
                <DonutChart segments={STATUSES.map((s) => ({ label: s, value: totalByStatus[s] ?? 0, color: statusColor(s) }))} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px' }}>{category}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--ink-500)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {STATUSES.filter((s) => (totalByStatus[s] ?? 0) > 0).map((s) => (
                      <span key={s}>
                        <span style={{ color: statusColor(s), fontWeight: 700 }}>●</span> {s} {totalByStatus[s]}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost no-capture"
          style={{ marginBottom: '18px' }}
          disabled={capturing === 'summary'}
          onClick={() => handleCopyImage('summary', summaryRef, '회사총재고')}
        >
          {capturing === 'summary' ? '캡처 중…' : '📋 이미지 복사 (카톡 보고용)'}
        </button>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {breakdown.map(({ category, rows, total, totalByStatus }) => {
            const categoryAssets = rows.flatMap((r) => r.assets);
            const totalAvailable = availableCount(totalByStatus);
            let totalSafety = 0;
            let totalShortage = 0;
            for (const r of rows) {
              const s = safetyByKey.get(safetyKey(category, r.detailCode)) ?? 0;
              totalSafety += s;
              totalShortage += Math.max(0, s - availableCount(r.byStatus));
            }

            return (
              <div key={category} style={{ minWidth: '760px', flex: '1 1 760px' }}>
                <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
                  {category} ({total}대)
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr>
                        <th>구분코드</th>
                        <th>총재고</th>
                        {BREAKDOWN_STATUSES.map((s) => (
                          <th key={s}>{s}</th>
                        ))}
                        <th>가용재고</th>
                        <th>안전재고</th>
                        <th>부족재고</th>
                        <th>비율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const available = availableCount(r.byStatus);
                        const safetyCount = safetyByKey.get(safetyKey(category, r.detailCode)) ?? 0;
                        const shortage = Math.max(0, safetyCount - available);
                        return (
                          <tr key={r.detailCode}>
                            <td style={{ fontWeight: 700 }}>{r.detailCode}</td>
                            <td>
                              <button type="button" className="chip" style={{ fontWeight: 700 }} onClick={() => openDrilldown(`${category} · ${r.detailCode} · 총재고`, r.assets)}>
                                {r.total}
                              </button>
                            </td>
                            {BREAKDOWN_STATUSES.map((s) => {
                              const count = r.byStatus[s] ?? 0;
                              return (
                                <td key={s}>
                                  {count > 0 ? (
                                    <button
                                      type="button"
                                      className="chip"
                                      onClick={() => openDrilldown(`${category} · ${r.detailCode} · ${s}`, r.assets.filter((a) => a.status === s))}
                                    >
                                      {count}
                                    </button>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                              );
                            })}
                            <td>
                              {available > 0 ? (
                                <button
                                  type="button"
                                  className="chip"
                                  style={{ fontWeight: 700 }}
                                  onClick={() => openDrilldown(`${category} · ${r.detailCode} · 가용재고`, availableAssets(r.assets))}
                                >
                                  {available}
                                </button>
                              ) : (
                                '0'
                              )}
                            </td>
                            <td>
                              <SafetyStockInput value={safetyCount} onSave={(n) => handleSetSafetyStock(category, r.detailCode, n)} />
                            </td>
                            <td style={{ fontWeight: 700, color: shortage > 0 ? 'var(--red-600)' : 'var(--ink-400)' }}>{shortage}</td>
                            <td>
                              <StackedBar
                                segments={BREAKDOWN_STATUSES.map((s) => ({ label: s, value: r.byStatus[s] ?? 0, color: statusColor(s) }))}
                                total={r.total}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td style={{ fontWeight: 700 }}>총계</td>
                        <td>
                          <button type="button" className="chip" style={{ fontWeight: 700 }} onClick={() => openDrilldown(`${category} · 총재고`, categoryAssets)}>
                            {total}
                          </button>
                        </td>
                        {BREAKDOWN_STATUSES.map((s) => {
                          const count = totalByStatus[s] ?? 0;
                          return (
                            <td key={s} style={{ fontWeight: 700 }}>
                              {count > 0 ? (
                                <button
                                  type="button"
                                  className="chip"
                                  onClick={() => openDrilldown(`${category} · ${s}`, categoryAssets.filter((a) => a.status === s))}
                                >
                                  {count}
                                </button>
                              ) : (
                                '-'
                              )}
                            </td>
                          );
                        })}
                        <td style={{ fontWeight: 700 }}>
                          {totalAvailable > 0 ? (
                            <button type="button" className="chip" style={{ fontWeight: 700 }} onClick={() => openDrilldown(`${category} · 가용재고`, availableAssets(categoryAssets))}>
                              {totalAvailable}
                            </button>
                          ) : (
                            '0'
                          )}
                        </td>
                        <td style={{ fontWeight: 700 }}>{totalSafety}</td>
                        <td style={{ fontWeight: 700, color: totalShortage > 0 ? 'var(--red-600)' : 'var(--ink-400)' }}>{totalShortage}</td>
                        <td>
                          <StackedBar
                            segments={BREAKDOWN_STATUSES.map((s) => ({ label: s, value: totalByStatus[s] ?? 0, color: statusColor(s) }))}
                            total={total}
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
        {breakdown.length === 0 && (
          <div className="empty-state">
            <div>📊</div>자산이 없어요.
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: '12px' }} ref={verificationRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
          <div style={{ fontWeight: 700, fontSize: '14px' }}>2차 검증 — 실재고조사 비교</div>
          <button
            type="button"
            className="btn btn-ghost no-capture"
            disabled={capturing === 'verification'}
            onClick={() => handleCopyImage('verification', verificationRef, '2차검증')}
          >
            {capturing === 'verification' ? '캡처 중…' : '📋 이미지 복사 (카톡 보고용)'}
          </button>
        </div>
        <div className="sub" style={{ marginBottom: '10px' }}>
          위치별 시스템 수량과 실재고조사(자산번호 단위 스캔)로 실제 확인된 수량을 비교해요.
          실재고조사를 아직 안 한 위치는 표시 안 해요 — 일치/불일치만 보여줘요.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {checkTables.map(({ category, rows: allRows, total }) => {
            const rows = allRows.filter((r) => !(r.confirmedCount === 0 && r.lastScannedAt === null));
            if (rows.length === 0) return null;
            return (
              <div key={category} style={{ minWidth: '320px', flex: '1 1 320px' }}>
                <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>{category}</div>
                <table style={{ fontSize: '12.5px' }}>
                  <thead>
                    <tr>
                      <th>위치</th>
                      <th>{category}</th>
                      <th>실재고체크</th>
                      <th>업데이트</th>
                      <th>담당자</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.location} style={r.mismatch ? { background: 'var(--red-50, #fef2f2)' } : undefined}>
                        <td>{r.location}</td>
                        <td>{r.systemCount}</td>
                        <td>{r.confirmedCount}</td>
                        <td style={{ fontSize: '11px', color: 'var(--ink-500)' }}>
                          {r.lastScannedAt ? formatKstDateTime(r.lastScannedAt) : '-'}
                        </td>
                        <td>{r.verifiedBy || '-'}</td>
                        <td style={{ fontWeight: 700, color: r.mismatch ? 'var(--red-600)' : 'var(--green-600)' }}>
                          {r.mismatch ? '불일치' : '일치'}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>총계</td>
                      <td style={{ fontWeight: 700 }}>{total.system}</td>
                      <td style={{ fontWeight: 700 }}>{total.confirmed}</td>
                      <td />
                      <td />
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        {checkTables.every(
          ({ rows }) => rows.filter((r) => !(r.confirmedCount === 0 && r.lastScannedAt === null)).length === 0,
        ) && (
          <div className="empty-state">
            <div>📋</div>아직 실재고조사로 확인된 위치가 없어요.
          </div>
        )}
      </div>

      {drilldown && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setDrilldown(null)}>
          <div className="modal" style={{ width: '480px' }}>
            <h2>{drilldown.title}</h2>
            <div className="sub" style={{ marginBottom: '10px' }}>{drilldown.assets.length}대</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '420px', overflowY: 'auto' }}>
              {drilldown.assets.map((a) => (
                <div key={a.assetId} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12.5px', padding: '4px 0', borderBottom: '1px solid var(--ink-100)' }}>
                  <span className="asset-id">{a.assetId}</span>
                  <span style={{ color: 'var(--ink-500)' }}>{a.model || '-'}</span>
                  <span style={{ color: 'var(--ink-400)', marginLeft: 'auto', fontSize: '11.5px' }}>{a.specLabel || '-'}</span>
                </div>
              ))}
              {drilldown.assets.length === 0 && <div className="sub">해당하는 자산이 없어요.</div>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setDrilldown(null)}>
                닫기
              </button>
            </div>
          </div>
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

function SafetyStockInput({ value, onSave }: { value: number; onSave: (count: number) => void }) {
  const [text, setText] = useState(String(value));

  function commit() {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) {
      setText(String(value));
      return;
    }
    if (n !== value) onSave(n);
  }

  return (
    <input
      type="number"
      min="0"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      style={{ width: '64px' }}
    />
  );
}
