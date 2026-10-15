'use client';

import { Fragment, useMemo, useState } from 'react';
import { setQuantityCheck } from '@/app/inventoryStatus/actions';
import { formatKstDateTime, type StocktakeConfirmation } from '@/lib/stocktake';
import {
  BREAKDOWN_STATUSES,
  buildCategoryBreakdown,
  buildLocationCheckTables,
  buildLocationQuantitySummary,
  type LocationQuantityRow,
  type QuantityCheck,
} from '@/lib/zoneStatus';
import type { Asset } from '@/lib/types';

type Props = {
  assets: Asset[];
  stocktakeConfirmations: Record<string, StocktakeConfirmation>;
  staffNames: string[];
  quantityChecks: QuantityCheck[];
  shelfLocations: string[];
};

export default function InventoryStatusPage({
  assets,
  staffNames,
  stocktakeConfirmations,
  quantityChecks,
  shelfLocations,
}: Props) {
  const [checks, setChecks] = useState(quantityChecks);
  const [toast, setToast] = useState({ msg: '', show: false });

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  const checkTables = useMemo(
    () => buildLocationCheckTables(assets, stocktakeConfirmations),
    [assets, stocktakeConfirmations],
  );
  const locationQuantityRows = useMemo(() => buildLocationQuantitySummary(assets, checks), [assets, checks]);
  const breakdown = useMemo(() => buildCategoryBreakdown(assets), [assets]);
  const grandTotal = breakdown.reduce((sum, g) => sum + g.total, 0);

  async function handleSetQuantityCheck(location: string, count: number, checkedBy: string) {
    setChecks((prev) => {
      const next = prev.filter((c) => c.location !== location);
      next.push({ location, countedCount: count, checkedBy, checkedAt: new Date().toISOString() });
      return next;
    });
    const result = await setQuantityCheck(location, count, checkedBy);
    showToast(result.ok ? `${location} ${count}대로 기록했어요.` : result.error);
  }

  return (
    <div className="app">
      <div className="panel" style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
          회사 총 가용 재고: {grandTotal}대 (렌탈 중 제외)
        </div>
        <div className="sub" style={{ marginBottom: '10px' }}>
          품목별로 구분코드(또는 모델명)별 대수와 재고상태를 보여줘요. 선반 위치는 지하/2층
          밖에 없어서 층별 집계는 따로 안 해요.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {breakdown.map(({ category, rows, total, totalByStatus }) => (
            <div key={category} style={{ minWidth: '420px', flex: '1 1 420px' }}>
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
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
        {breakdown.length === 0 && (
          <div className="empty-state">
            <div>📊</div>가용 자산이 없어요.
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
        locations={shelfLocations}
        staffNames={staffNames}
        onSave={handleSetQuantityCheck}
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

function QuantityCheckPanel({
  rows,
  locations,
  staffNames,
  onSave,
}: {
  rows: LocationQuantityRow[];
  locations: string[];
  staffNames: string[];
  onSave: (location: string, count: number, checkedBy: string) => void;
}) {
  const [location, setLocation] = useState('');
  const [count, setCount] = useState('');
  const [checkedBy, setCheckedBy] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  function handleSubmit() {
    const n = Number(count);
    if (!location.trim() || !Number.isFinite(n) || count.trim() === '') return;
    onSave(location.trim(), n, checkedBy);
    setCount('');
  }

  const total = rows.reduce(
    (acc, r) => ({ system: acc.system + r.systemCount, counted: acc.counted + (r.countedCount ?? 0) }),
    { system: 0, counted: 0 },
  );

  return (
    <div className="panel" style={{ marginBottom: '12px' }}>
      <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>1차 수량 체크 — 자산번호 없이 대수만</div>
      <div className="sub" style={{ marginBottom: '10px' }}>
        품목 구분 없이 위치 하나당 전산 수량과 실사수량(선반을 보고 눈으로 센 대수)만
        비교해요. 위치를 누르면 그 위치에 어떤 자산번호가 있는지 펼쳐볼 수 있어요.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px', alignItems: 'center' }}>
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">위치 선택</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          placeholder="실사수량"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          style={{ width: '90px' }}
        />
        <select value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)}>
          <option value="">담당자 선택</option>
          {staffNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={handleSubmit}>
          기록
        </button>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.location}>
                <tr
                  style={{
                    cursor: 'pointer',
                    ...(r.mismatch ? { background: 'var(--red-50, #fef2f2)' } : undefined),
                  }}
                  onClick={() => setExpanded((prev) => (prev === r.location ? null : r.location))}
                >
                  <td style={{ fontWeight: 700 }}>
                    {expanded === r.location ? '▼' : '▶'} {r.location}
                  </td>
                  <td>{r.systemCount}</td>
                  <td>{r.countedCount ?? '-'}</td>
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
                </tr>
                {expanded === r.location && (
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--ink-50)' }}>
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
            </tr>
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="empty-state">
          <div>📋</div>위치가 입력된 가용 자산이 없어요.
        </div>
      )}
    </div>
  );
}
