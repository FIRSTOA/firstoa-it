'use client';

import { Fragment, useMemo, useState } from 'react';
import { addStaffNameIfNew } from '@/app/actions';
import { setQuantityCheck, setStockCheckOverride } from '@/app/inventoryStatus/actions';
import { formatKstDateTime, type StocktakeConfirmation } from '@/lib/stocktake';
import {
  BREAKDOWN_STATUSES,
  buildCategoryBreakdown,
  buildLocationCheckTables,
  buildLocationQuantitySummary,
  isStockCheckExcluded,
  type LocationQuantityRow,
  type QuantityCheck,
  type StockCheckOverride,
} from '@/lib/zoneStatus';
import { STATUSES, type Asset } from '@/lib/types';
import { DonutChart, StackedBar, StatusLegend, statusColor } from './charts';

const CUSTOM_OPTION = '__custom__';

type Props = {
  assets: Asset[];
  stocktakeConfirmations: Record<string, StocktakeConfirmation>;
  staffNames: string[];
  quantityChecks: QuantityCheck[];
  stockCheckOverrides: StockCheckOverride[];
};

export default function InventoryStatusPage({
  assets,
  staffNames,
  stocktakeConfirmations,
  quantityChecks,
  stockCheckOverrides,
}: Props) {
  const [checks, setChecks] = useState(quantityChecks);
  const [overrides, setOverrides] = useState(stockCheckOverrides);
  const [toast, setToast] = useState({ msg: '', show: false });

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  const checkTables = useMemo(
    () => buildLocationCheckTables(assets, stocktakeConfirmations),
    [assets, stocktakeConfirmations],
  );
  const locationQuantityRows = useMemo(() => buildLocationQuantitySummary(assets, checks), [assets, checks]);
  const overrideByLocation = useMemo(() => new Map(overrides.map((o) => [o.location, o.excluded])), [overrides]);
  const breakdown = useMemo(() => buildCategoryBreakdown(assets), [assets]);
  const grandTotal = breakdown.reduce((sum, g) => sum + g.total, 0);

  async function handleSetQuantityCheck(location: string, count: number, checkedBy: string) {
    setChecks((prev) => {
      const next = prev.filter((c) => c.location !== location);
      next.push({ location, countedCount: count, checkedBy, checkedAt: new Date().toISOString() });
      return next;
    });
    const trimmedName = checkedBy.trim();
    if (trimmedName && !staffNames.includes(trimmedName)) {
      addStaffNameIfNew(trimmedName).catch(() => {});
    }
    const result = await setQuantityCheck(location, count, checkedBy);
    showToast(result.ok ? `${location} ${count}대로 기록했어요.` : result.error);
  }

  async function handleToggleExcluded(location: string, excluded: boolean) {
    setOverrides((prev) => [
      ...prev.filter((o) => o.location !== location),
      { location, excluded, updatedBy: '', updatedAt: new Date().toISOString() },
    ]);
    const result = await setStockCheckOverride(location, excluded);
    showToast(result.ok ? `${location} — ${excluded ? '체크 안 함으로 옮겼어요.' : '체크 대상으로 옮겼어요.'}` : result.error);
  }

  return (
    <div className="app">
      <div className="panel" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
          <div style={{ fontWeight: 700, fontSize: '14px' }}>회사 총 재고: {grandTotal}대</div>
          <StatusLegend />
        </div>
        <div className="sub" style={{ marginBottom: '14px' }}>
          품목별로 구분코드(또는 모델명)별 대수와 재고상태를 보여줘요(임대중 포함). 선반 위치는
          지하/2층 밖에 없어서 층별 집계는 따로 안 해요.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '18px' }}>
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

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {breakdown.map(({ category, rows, total, totalByStatus }) => (
            <div key={category} style={{ minWidth: '460px', flex: '1 1 460px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
                {category} ({total}대)
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: '12.5px' }}>
                  <thead>
                    <tr>
                      <th>구분코드</th>
                      <th>총재고</th>
                      {BREAKDOWN_STATUSES.map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                      <th>비율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.detailCode}>
                        <td style={{ fontWeight: 700 }}>{r.detailCode}</td>
                        <td style={{ fontWeight: 700 }}>{r.total}</td>
                        {BREAKDOWN_STATUSES.map((s) => (
                          <td key={s}>{r.byStatus[s] ?? '-'}</td>
                        ))}
                        <td>
                          <StackedBar
                            segments={BREAKDOWN_STATUSES.map((s) => ({ label: s, value: r.byStatus[s] ?? 0, color: statusColor(s) }))}
                            total={r.total}
                          />
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>총계</td>
                      <td style={{ fontWeight: 700 }}>{total}</td>
                      {BREAKDOWN_STATUSES.map((s) => (
                        <td key={s} style={{ fontWeight: 700 }}>
                          {totalByStatus[s] ?? '-'}
                        </td>
                      ))}
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
          ))}
        </div>
        {breakdown.length === 0 && (
          <div className="empty-state">
            <div>📊</div>자산이 없어요.
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>2차 검증 — 실재고조사 비교</div>
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

      <QuantityCheckPanel
        rows={locationQuantityRows}
        overrideByLocation={overrideByLocation}
        staffNames={staffNames}
        onSave={handleSetQuantityCheck}
        onToggleExcluded={handleToggleExcluded}
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

function CountCell({ countedCount, onSave }: { countedCount: number | null; onSave: (count: number) => void }) {
  const [value, setValue] = useState(countedCount === null ? '' : String(countedCount));

  function commit() {
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) {
      setValue(countedCount === null ? '' : String(countedCount));
      return;
    }
    if (n !== countedCount) onSave(n);
  }

  return (
    <input
      type="number"
      min="0"
      value={value}
      placeholder="입력"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      style={{ width: '70px' }}
    />
  );
}

function QuantityCheckRows({
  rows,
  expanded,
  onToggle,
  excludedSection,
  onSaveCount,
  onToggleExcluded,
}: {
  rows: LocationQuantityRow[];
  expanded: string | null;
  onToggle: (location: string) => void;
  excludedSection: boolean;
  onSaveCount: (location: string, count: number) => void;
  onToggleExcluded: (location: string, excluded: boolean) => void;
}) {
  const total = rows.reduce(
    (acc, r) => ({ system: acc.system + r.systemCount, counted: acc.counted + (r.countedCount ?? 0) }),
    { system: 0, counted: 0 },
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ fontSize: '12.5px' }}>
        <thead>
          <tr>
            <th>위치</th>
            <th>전산 수량</th>
            <th>실사수량</th>
            <th>업데이트</th>
            <th>담당자</th>
            <th>비고</th>
            <th>분류</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.location}>
              <tr style={r.mismatch ? { background: 'var(--red-50, #fef2f2)' } : undefined}>
                <td style={{ fontWeight: 700, cursor: 'pointer' }} onClick={() => onToggle(r.location)}>
                  {expanded === r.location ? '▼' : '▶'} {r.location}
                </td>
                <td>{r.systemCount}</td>
                <td>
                  <CountCell countedCount={r.countedCount} onSave={(count) => onSaveCount(r.location, count)} />
                </td>
                <td style={{ fontSize: '11px', color: 'var(--ink-500)' }}>
                  {r.checkedAt ? formatKstDateTime(r.checkedAt) : '-'}
                </td>
                <td>{r.checkedBy || '-'}</td>
                <td
                  style={{
                    fontWeight: 700,
                    color: r.countedCount === null ? 'var(--ink-500)' : r.mismatch ? 'var(--red-600)' : 'var(--green-600)',
                  }}
                >
                  {r.countedCount === null ? '-' : r.mismatch ? '불일치' : '일치'}
                </td>
                <td>
                  <button
                    type="button"
                    className="chip"
                    style={{ fontSize: '10.5px', padding: '1px 6px' }}
                    onClick={() => onToggleExcluded(r.location, !excludedSection)}
                  >
                    {excludedSection ? '체크대상으로' : '체크안함으로'}
                  </button>
                </td>
              </tr>
              {expanded === r.location && (
                <tr>
                  <td colSpan={7} style={{ background: 'var(--ink-50)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 4px' }}>
                      {r.assetIds.map((a) => (
                        <span key={a.assetId} className="chip" style={{ fontSize: '11.5px' }}>
                          <span className="asset-id">{a.assetId}</span> {a.category} {a.model}
                        </span>
                      ))}
                      {r.assetIds.length === 0 && <span className="sub">자산이 없어요.</span>}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          <tr>
            <td style={{ fontWeight: 700 }}>총계</td>
            <td style={{ fontWeight: 700 }}>{total.system}</td>
            <td style={{ fontWeight: 700 }}>{total.counted}</td>
            <td />
            <td />
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function QuantityCheckPanel({
  rows,
  overrideByLocation,
  staffNames,
  onSave,
  onToggleExcluded,
}: {
  rows: LocationQuantityRow[];
  overrideByLocation: Map<string, boolean>;
  staffNames: string[];
  onSave: (location: string, count: number, checkedBy: string) => void;
  onToggleExcluded: (location: string, excluded: boolean) => void;
}) {
  const [checkedBy, setCheckedBy] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);

  function toggleExpanded(loc: string) {
    setExpanded((prev) => (prev === loc ? null : loc));
  }

  // 선반 위치가 아닌 값(파손/판매/분실/반출/폐기/직송-.../김정식프로문의/K열/PM 등 상태·메모성
  // 텍스트)은 기본적으로 실재고 체크 대상이 아니지만, overrideByLocation에 예외가 있으면
  // 양쪽 방향으로 수동으로 뒤집을 수 있습니다("분류" 버튼).
  const shelfRows = rows.filter((r) => !isStockCheckExcluded(r.location, overrideByLocation));
  const excludedRows = rows.filter((r) => isStockCheckExcluded(r.location, overrideByLocation));

  return (
    <div className="panel" style={{ marginBottom: '12px' }}>
      <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>1차 수량 체크 — 자산번호 없이 대수만</div>
      <div className="sub" style={{ marginBottom: '10px' }}>
        품목 구분 없이 위치 하나당 전산 수량과 실사수량(선반을 보고 눈으로 센 대수)만
        비교해요. 전산 수량 오른쪽 실사수량 칸에 직접 입력하면 바로 기록돼요. "분류" 버튼으로
        그 위치를 실재고체크 대상/안 함으로 옮길 수 있어요.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px', alignItems: 'center' }}>
        <span className="sub" style={{ fontSize: '12.5px' }}>
          지금 체크하는 사람:
        </span>
        {customMode || staffNames.length === 0 ? (
          <input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} placeholder="담당자 이름 입력" style={{ width: '110px' }} />
        ) : (
          <select
            value={staffNames.includes(checkedBy) ? checkedBy : ''}
            onChange={(e) => {
              if (e.target.value === CUSTOM_OPTION) {
                setCustomMode(true);
                setCheckedBy('');
              } else {
                setCheckedBy(e.target.value);
              }
            }}
          >
            <option value="">담당자 선택</option>
            {staffNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>➕ 새 이름 입력</option>
          </select>
        )}
        {customMode && staffNames.length > 0 && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              setCustomMode(false);
              setCheckedBy('');
            }}
          >
            목록에서 선택
          </button>
        )}
      </div>

      <QuantityCheckRows
        rows={shelfRows}
        expanded={expanded}
        onToggle={toggleExpanded}
        excludedSection={false}
        onSaveCount={(location, count) => onSave(location, count, checkedBy)}
        onToggleExcluded={onToggleExcluded}
      />
      {shelfRows.length === 0 && (
        <div className="empty-state">
          <div>📋</div>위치가 입력된 가용 자산이 없어요.
        </div>
      )}

      {excludedRows.length > 0 && (
        <div style={{ marginTop: '14px' }}>
          <button type="button" className="chip" onClick={() => setShowExcluded((v) => !v)}>
            {showExcluded ? '▲' : '▶'} 실재고체크안함 ({excludedRows.length}개)
          </button>
          {showExcluded && (
            <div style={{ marginTop: '8px' }}>
              <QuantityCheckRows
                rows={excludedRows}
                expanded={expanded}
                onToggle={toggleExpanded}
                excludedSection={true}
                onSaveCount={(location, count) => onSave(location, count, checkedBy)}
                onToggleExcluded={onToggleExcluded}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
