'use client';

import { useMemo, useState } from 'react';
import { markZoneVerified, setZoneVerifier, updateZoneStatus } from '@/app/inventoryStatus/actions';
import { CONDITION_STATUSES, buildZoneMatrix, findCell, type ZoneStatus, type ZoneVerification } from '@/lib/zoneStatus';
import type { Asset } from '@/lib/types';

const CUSTOM_OPTION = '__custom__';

type Props = {
  assets: Asset[];
  zoneStatuses: ZoneStatus[];
  zoneVerifications: ZoneVerification[];
  zoneLocations: string[];
  staffNames: string[];
};

function verifierBadgeStyle(v: ZoneVerification | undefined, currentCount: number): { label: string; cls: string } {
  if (!v || !v.verifierName) return { label: '검증자 미지정', cls: 'badge-기타' };
  if (!v.verified) return { label: `${v.verifierName} 확인대기`, cls: 'badge-상품화준비중' };
  if (v.verifiedCount !== null && v.verifiedCount !== currentCount) {
    return { label: `⚠️ 검증후 변경됨 (${v.verifierName})`, cls: 'badge-악성' };
  }
  return { label: `✅ ${v.verifierName} 검증완료`, cls: 'badge-상품화완료' };
}

export default function InventoryStatusPage({ assets, zoneStatuses, zoneVerifications, zoneLocations, staffNames }: Props) {
  const [statuses, setStatuses] = useState(zoneStatuses);
  const [verifications, setVerifications] = useState(zoneVerifications);
  const [locations, setLocations] = useState(zoneLocations);
  const [selected, setSelected] = useState<{ location: string; category: string } | null>(null);
  const [toast, setToast] = useState({ msg: '', show: false });

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  const zoneByAssetId = useMemo(() => new Map(statuses.map((s) => [s.assetId, s])), [statuses]);
  const matrix = useMemo(() => buildZoneMatrix(assets, zoneByAssetId), [assets, zoneByAssetId]);
  const verificationByKey = useMemo(
    () => new Map(verifications.map((v) => [`${v.location}\u0000${v.category}`, v])),
    [verifications],
  );

  // 태깅 진행률 — "위치 미지정"이 아닌 자산이 전체 가용 자산 중 몇 건인지(= 아직 조사 안 된
  // 건수를 한눈에 보려는 목적).
  const taggingProgress = useMemo(() => {
    const available = assets.filter((a) => a.status !== '임대중');
    const tagged = available.filter((a) => zoneByAssetId.get(a.assetId)?.location.trim());
    return { tagged: tagged.length, total: available.length };
  }, [assets, zoneByAssetId]);

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

            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>자산 목록 (여기서 바로 재태깅 가능)</div>
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
