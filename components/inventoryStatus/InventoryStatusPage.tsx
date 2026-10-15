'use client';

import { useMemo, useState } from 'react';
import { markZoneVerified, setLocationFloor, setZoneVerifier, updateZoneStatus } from '@/app/inventoryStatus/actions';
import { formatKstDateTime, type StocktakeConfirmation } from '@/lib/stocktake';
import {
  buildLocationCheckTables,
  buildZoneMatrix,
  CONDITION_STATUSES,
  findCell,
  type LocationFloorMap,
  type ZoneStatus,
  type ZoneVerification,
} from '@/lib/zoneStatus';
import type { Asset } from '@/lib/types';

const CUSTOM_OPTION = '__custom__';

type Props = {
  assets: Asset[];
  zoneStatuses: ZoneStatus[];
  zoneVerifications: ZoneVerification[];
  stocktakeConfirmations: Record<string, StocktakeConfirmation>;
  zoneLocations: string[];
  staffNames: string[];
  locationFloorMap: LocationFloorMap[];
};

function verifierBadgeStyle(v: ZoneVerification | undefined, currentCount: number): { label: string; cls: string } {
  if (!v || !v.verifierName) return { label: '검증자 미지정', cls: 'badge-기타' };
  if (!v.verified) return { label: `${v.verifierName} 확인대기`, cls: 'badge-상품화준비중' };
  if (v.verifiedCount !== null && v.verifiedCount !== currentCount) {
    return { label: `⚠️ 검증후 변경됨 (${v.verifierName})`, cls: 'badge-악성' };
  }
  return { label: `✅ ${v.verifierName} 검증완료`, cls: 'badge-상품화완료' };
}

export default function InventoryStatusPage({
  assets,
  zoneStatuses,
  zoneVerifications,
  zoneLocations,
  staffNames,
  locationFloorMap,
  stocktakeConfirmations,
}: Props) {
  const [statuses, setStatuses] = useState(zoneStatuses);
  const [verifications, setVerifications] = useState(zoneVerifications);
  const [locations, setLocations] = useState(zoneLocations);
  const [floorMap, setFloorMap] = useState(locationFloorMap);
  const [selected, setSelected] = useState<{ location: string; category: string } | null>(null);
  const [showAllMappings, setShowAllMappings] = useState(false);
  const [toast, setToast] = useState({ msg: '', show: false });

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  const zoneByAssetId = useMemo(() => new Map(statuses.map((s) => [s.assetId, s])), [statuses]);
  const floorByCode = useMemo(() => new Map(floorMap.map((m) => [m.code, m.floor])), [floorMap]);
  const checkTables = useMemo(
    () => buildLocationCheckTables(assets, stocktakeConfirmations),
    [assets, stocktakeConfirmations],
  );
  const matrix = useMemo(
    () => buildZoneMatrix(assets, zoneByAssetId, floorByCode),
    [assets, zoneByAssetId, floorByCode],
  );
  const verificationByKey = useMemo(
    () => new Map(verifications.map((v) => [`${v.location}\u0000${v.category}`, v])),
    [verifications],
  );

  // 태깅(=위치 해결) 진행률 — "(위치 미지정)"/"미분류 (코드)"로 안 묶인 자산이 전체 가용
  // 자산 중 몇 건인지. 코드 하나를 매핑하면 그 코드를 쓰는 자산 전부가 한꺼번에 해결됩니다.
  const taggingProgress = useMemo(() => {
    const total = matrix.cells.reduce((s, c) => s + c.total, 0);
    const unresolved = matrix.cells
      .filter((c) => c.location === '(위치 미지정)' || c.location.startsWith('미분류'))
      .reduce((s, c) => s + c.total, 0);
    return { tagged: total - unresolved, total };
  }, [matrix.cells]);

  async function handleSetFloor(code: string, floor: string) {
    setFloorMap((prev) => [...prev.filter((m) => m.code !== code), { code, floor }]);
    if (floor.trim() && !locations.includes(floor.trim())) {
      setLocations((prev) => [...prev, floor.trim()].sort((a, b) => a.localeCompare(b, 'ko')));
    }
    const result = await setLocationFloor(code, floor);
    if (!result.ok) showToast(result.error);
  }

  // 위치별 검증 진행률 — 그 위치에 걸친 품목(셀) 중 몇 개가 검증완료인지(한 셀이라도 안
  // 됐으면 그 위치는 "검증 진행중"으로 보입니다).
  const verificationProgressByLocation = useMemo(() => {
    const result: Record<string, { done: number; total: number }> = {};
    for (const cell of matrix.cells) {
      const key = `${cell.location}\u0000${cell.category}`;
      const v = verificationByKey.get(key);
      const entry = result[cell.location] ?? { done: 0, total: 0 };
      entry.total += 1;
      if (v?.verified && v.verifiedCount === cell.total) entry.done += 1;
      result[cell.location] = entry;
    }
    return result;
  }, [matrix.cells, verificationByKey]);

  const rowTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const cell of matrix.cells) totals[cell.location] = (totals[cell.location] ?? 0) + cell.total;
    return totals;
  }, [matrix.cells]);
  const colTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const cell of matrix.cells) totals[cell.category] = (totals[cell.category] ?? 0) + cell.total;
    return totals;
  }, [matrix.cells]);
  const grandTotal = matrix.cells.reduce((sum, c) => sum + c.total, 0);

  async function handleRetag(assetId: string, location: string, conditionStatus: string) {
    setStatuses((prev) => {
      const next = prev.filter((s) => s.assetId !== assetId);
      next.push({ assetId, location, conditionStatus, note: '', updatedBy: '', updatedAt: new Date().toISOString() });
      return next;
    });
    if (location.trim() && !locations.includes(location.trim())) {
      setLocations((prev) => [...prev, location.trim()].sort((a, b) => a.localeCompare(b, 'ko')));
    }
    const result = await updateZoneStatus(assetId, location, conditionStatus);
    if (!result.ok) showToast(result.error);
  }

  async function handleSetVerifier(location: string, category: string, verifierName: string) {
    setVerifications((prev) => {
      const key = `${location}\u0000${category}`;
      const existing = prev.find((v) => `${v.location}\u0000${v.category}` === key);
      const next = prev.filter((v) => `${v.location}\u0000${v.category}` !== key);
      next.push({
        location,
        category,
        verifierName,
        verified: existing?.verified ?? false,
        verifiedAt: existing?.verifiedAt ?? null,
        verifiedCount: existing?.verifiedCount ?? null,
      });
      return next;
    });
    const result = await setZoneVerifier(location, category, verifierName);
    if (!result.ok) showToast(result.error);
  }

  async function handleMarkVerified(location: string, category: string, count: number) {
    setVerifications((prev) => {
      const key = `${location}\u0000${category}`;
      const existing = prev.find((v) => `${v.location}\u0000${v.category}` === key);
      const next = prev.filter((v) => `${v.location}\u0000${v.category}` !== key);
      next.push({
        location,
        category,
        verifierName: existing?.verifierName ?? '',
        verified: true,
        verifiedAt: new Date().toISOString(),
        verifiedCount: count,
      });
      return next;
    });
    const result = await markZoneVerified(location, category, count);
    showToast(result.ok ? '검증 완료로 표시했어요.' : result.error);
  }

  const selectedCell = selected ? findCell(matrix.cells, selected.location, selected.category) : null;
  const selectedVerification = selected
    ? verificationByKey.get(`${selected.location}\u0000${selected.category}`)
    : undefined;

  return (
    <div className="app">
      {matrix.unmappedCodes.length > 0 && (
        <div className="panel" style={{ marginBottom: '12px', borderColor: 'var(--red-100)' }}>
          <div style={{ fontWeight: 700, color: 'var(--red-600)', marginBottom: '4px' }}>
            ⚠️ 층 매핑이 안 된 위치 코드 {matrix.unmappedCodes.length}개
          </div>
          <div className="sub" style={{ marginBottom: '10px' }}>
            코드 하나당 한 번만 층을 지정하면, 그 코드를 쓰는 자산 전부가 한꺼번에 집계에 반영돼요.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {matrix.unmappedCodes.map(({ code, count }) => (
              <div key={code} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <span className="asset-id" style={{ width: '90px' }}>
                  {code}
                </span>
                <span style={{ color: 'var(--ink-500)', width: '70px' }}>{count}대</span>
                <select defaultValue="" onChange={(e) => e.target.value && handleSetFloor(code, e.target.value)}>
                  <option value="">층 선택</option>
                  {locations.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="또는 새 층 이름 입력 후 Enter"
                  style={{ fontSize: '12.5px' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      handleSetFloor(code, e.currentTarget.value.trim());
                      e.currentTarget.value = '';
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {floorMap.length > 0 && (
        <div className="panel" style={{ marginBottom: '12px' }}>
          <button
            type="button"
            className="chip"
            onClick={() => setShowAllMappings((v) => !v)}
            style={{ marginBottom: showAllMappings ? '10px' : 0 }}
          >
            {showAllMappings ? '▲' : '▼'} 매핑된 위치 코드 전체 보기/수정 ({floorMap.length}개)
          </button>
          {showAllMappings && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[...floorMap]
                .sort((a, b) => a.code.localeCompare(b.code, 'ko'))
                .map(({ code, floor }) => (
                  <div key={code} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                    <span className="asset-id" style={{ width: '90px' }}>
                      {code}
                    </span>
                    <select value={floor} onChange={(e) => handleSetFloor(code, e.target.value)}>
                      {locations.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
          회사 총 가용 재고: {grandTotal}대 (렌탈 중 제외)
        </div>
        <div style={{ fontSize: '12.5px', color: 'var(--ink-500)', marginBottom: '8px' }}>
          위치 태깅: {taggingProgress.tagged}/{taggingProgress.total}건 완료
          {taggingProgress.tagged < taggingProgress.total &&
            ` (${taggingProgress.total - taggingProgress.tagged}건 아직 위치 미지정)`}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>위치</th>
                {matrix.categories.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th>합계</th>
                <th>검증 진행률</th>
              </tr>
            </thead>
            <tbody>
              {matrix.locations.map((location) => {
                const progress = verificationProgressByLocation[location] ?? { done: 0, total: 0 };
                const allVerified = progress.total > 0 && progress.done === progress.total;
                return (
                <tr key={location} className={location === '(위치 미지정)' ? 'empty-state' : undefined}>
                  <td style={{ fontWeight: 700 }}>{location}</td>
                  {matrix.categories.map((category) => {
                    const cell = findCell(matrix.cells, location, category);
                    const v = verificationByKey.get(`${location}\u0000${category}`);
                    return (
                      <td key={category}>
                        {cell ? (
                          <button
                            type="button"
                            className="chip"
                            onClick={() => setSelected({ location, category })}
                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}
                          >
                            <span style={{ fontWeight: 700 }}>{cell.total}</span>
                            {v?.verified && <span style={{ fontSize: '10px' }}>✅</span>}
                          </button>
                        ) : (
                          '-'
                        )}
                      </td>
                    );
                  })}
                  <td style={{ fontWeight: 700 }}>{rowTotals[location] ?? 0}</td>
                  <td>
                    <span className={`badge ${allVerified ? 'badge-상품화완료' : 'badge-상품화준비중'}`}>
                      {progress.total === 0 ? '-' : allVerified ? `✅ ${progress.done}/${progress.total}` : `${progress.done}/${progress.total}`}
                    </span>
                  </td>
                </tr>
                );
              })}
              <tr>
                <td style={{ fontWeight: 700 }}>합계</td>
                {matrix.categories.map((c) => (
                  <td key={c} style={{ fontWeight: 700 }}>
                    {colTotals[c] ?? 0}
                  </td>
                ))}
                <td style={{ fontWeight: 700 }}>{grandTotal}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        {matrix.locations.length === 0 && (
          <div className="empty-state">
            <div>📊</div>아직 위치가 태깅된 자산이 없어요.
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>1차 수량 체크</div>
        <div className="sub" style={{ marginBottom: '10px' }}>
          위치별 시스템 수량과 실재고조사(2차 검증)로 실제 확인된 수량을 비교해요. 숫자가
          다르면 빨갛게 표시돼요 — 실재고조사를 아직 안 했거나 위치가 바뀌었을 수 있어요.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {checkTables.map(({ category, rows, total }) => (
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
                        {r.confirmedCount === 0 && r.lastScannedAt === null ? '미확인' : r.mismatch ? '불일치' : '일치'}
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
          ))}
        </div>
        {checkTables.length === 0 && (
          <div className="empty-state">
            <div>📋</div>위치가 입력된 가용 자산이 없어요.
          </div>
        )}
      </div>

      {selected && selectedCell && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="modal" style={{ width: '560px' }}>
            <h2>
              {selected.location} · {selected.category} ({selectedCell.total}대)
            </h2>
            <div className="chip-group" style={{ marginBottom: '10px' }}>
              {CONDITION_STATUSES.map((cs) => (
                <span key={cs} className="chip">
                  {cs} {selectedCell.byCondition[cs] ?? 0}
                </span>
              ))}
            </div>

            <div className="panel" style={{ marginBottom: '12px', background: 'var(--ink-50)' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>검증</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className={`badge ${verifierBadgeStyle(selectedVerification, selectedCell.total).cls}`}>
                  {verifierBadgeStyle(selectedVerification, selectedCell.total).label}
                </span>
                <select
                  value={selectedVerification?.verifierName ?? ''}
                  onChange={(e) => handleSetVerifier(selected.location, selected.category, e.target.value)}
                >
                  <option value="">검증자 선택</option>
                  {staffNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!selectedVerification?.verifierName}
                  onClick={() => handleMarkVerified(selected.location, selected.category, selectedCell.total)}
                >
                  확인 완료
                </button>
              </div>
            </div>

            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
              자산 목록 (위치는 기존 재고 데이터에서 자동으로 가져와요 — 특정 자산만 예외로
              다른 위치에 두려면 여기서 수동으로 바꿀 수 있어요)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto' }}>
              {selectedCell.assetIds.map((assetId) => {
                const asset = assets.find((a) => a.assetId === assetId);
                const zone = zoneByAssetId.get(assetId);
                return (
                  <AssetTagRow
                    key={assetId}
                    assetId={assetId}
                    label={asset ? `${asset.brand} ${asset.model}` : ''}
                    location={zone?.location ?? selected.location}
                    conditionStatus={zone?.conditionStatus ?? '가용'}
                    locations={locations}
                    onSave={(loc, cond) => handleRetag(assetId, loc, cond)}
                  />
                );
              })}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
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

function AssetTagRow({
  assetId,
  label,
  location,
  conditionStatus,
  locations,
  onSave,
}: {
  assetId: string;
  label: string;
  location: string;
  conditionStatus: string;
  locations: string[];
  onSave: (location: string, conditionStatus: string) => void;
}) {
  const [loc, setLoc] = useState(location);
  const [customMode, setCustomMode] = useState(!locations.includes(location) && location !== '(위치 미지정)');
  const [cond, setCond] = useState(conditionStatus);

  function commit(nextLoc: string, nextCond: string) {
    setLoc(nextLoc);
    setCond(nextCond);
    if (nextLoc.trim()) onSave(nextLoc, nextCond);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 110px', gap: '6px', alignItems: 'center', fontSize: '12.5px' }}>
      <span className="asset-id">{assetId}</span>
      <span style={{ color: 'var(--ink-500)' }}>{label || '-'}</span>
      {customMode ? (
        <input
          value={loc}
          placeholder="새 위치 입력"
          onChange={(e) => setLoc(e.target.value)}
          onBlur={() => commit(loc, cond)}
        />
      ) : (
        <select
          value={loc}
          onChange={(e) => {
            if (e.target.value === CUSTOM_OPTION) {
              setCustomMode(true);
              setLoc('');
              return;
            }
            commit(e.target.value, cond);
          }}
        >
          <option value="">위치 선택</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          <option value={CUSTOM_OPTION}>➕ 새 위치 입력</option>
        </select>
      )}
      <select value={cond} onChange={(e) => commit(loc, e.target.value)}>
        {CONDITION_STATUSES.map((cs) => (
          <option key={cs} value={cs}>
            {cs}
          </option>
        ))}
      </select>
    </div>
  );
}
