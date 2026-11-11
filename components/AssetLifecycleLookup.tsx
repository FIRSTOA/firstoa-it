'use client';

import { useEffect, useState, useTransition } from 'react';
import { getAssetLifecycle, type AssetLifecycle } from '@/app/asset-history/actions';
import { formatWon } from '@/lib/currency';

type Props = { initialQuery?: string; asSheetUrl: string };

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="detail-field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
      <span className="detail-label">{label}</span>
      <span className="detail-value" style={{ fontWeight: 700, fontSize: '15px' }}>{value || '-'}</span>
      {sub && <span style={{ fontSize: '11.5px', color: 'var(--ink-400)' }}>{sub}</span>}
    </div>
  );
}

function period(from: string, to: string): string {
  if (!from && !to) return '-';
  return `${from || '?'} ~ ${to || '진행중'}`;
}

export default function AssetLifecycleLookup({ initialQuery = '', asSheetUrl }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [data, setData] = useState<AssetLifecycle | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function run(q: string) {
    if (!q.trim()) return;
    setError('');
    startTransition(async () => {
      const res = await getAssetLifecycle(q);
      if (!res.ok) {
        setData(null);
        setError(res.error);
        return;
      }
      setData(res.data);
    });
  }

  useEffect(() => {
    if (initialQuery) run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recovery =
    data && data.purchasePrice && data.purchasePrice > 0
      ? `원가회수율 ${((data.billedTotal / data.purchasePrice) * 100).toFixed(1)}%`
      : undefined;

  return (
    <div className="panel" style={{ marginBottom: '16px' }}>
      <div style={{ fontWeight: 700, marginBottom: '8px' }}>🔎 자산 통합 조회 — 입고 · 매입 · 임대 · AS</div>
      <form
        className="search-row"
        style={{ display: 'flex', gap: '8px' }}
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="자산번호 또는 시리얼번호 (예: X8420, K2302N0031585)"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || !query.trim()}>
          {pending ? '조회 중…' : '조회'}
        </button>
      </form>

      {error && <div style={{ color: 'var(--red-600)', fontSize: '13px', marginTop: '8px' }}>{error}</div>}

      {data && (
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '18px', fontWeight: 800 }}>
            {data.assetCode}
            {data.asset && (
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink-500)', marginLeft: '8px' }}>
                {data.asset.category} · {data.asset.brand} {data.asset.model} · 현재 {data.asset.location || '-'} (
                {data.asset.status})
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--ink-400)', marginBottom: '10px' }}>
            시리얼 {data.serials.join(', ') || '-'}
            {!data.asset && ' · IT재고 목록에는 없는 자산번호예요'}
          </div>

          <div className="detail-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Card label="입고일" value={data.receivedDate || '기록 없음'} sub={data.receivedSource || '앱 입고 대장에 기록이 없어요'} />
            <Card label="매입처" value={data.purchaseVendor || '미입력'} />
            <Card label="매입금액" value={data.purchasePrice !== null ? formatWon(data.purchasePrice) : '미입력'} />
            <Card label="받은 렌탈요금 합계" value={formatWon(data.billedTotal)} sub={recovery} />
            <Card label="AS 접수" value={`${data.asRecords.length}건`} />
          </div>

          <div className="detail-section-title">거래처별 임대 기간 · 받은 렌탈요금</div>
          {data.rentals.length === 0 ? (
            <div className="detail-empty">임대리스트(firstoa-works)에 기록이 없어요.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>거래처</th>
                  <th>현장</th>
                  <th>계약 기간</th>
                  <th>상태</th>
                  <th>청구 기간</th>
                  <th style={{ textAlign: 'right' }}>받은 렌탈요금</th>
                </tr>
              </thead>
              <tbody>
                {data.rentals.map((r, i) => (
                  <tr key={i}>
                    <td>{r.vendorName || '-'}</td>
                    <td>{r.siteName || '-'}</td>
                    <td>{r.contractDate || r.endDate ? period(r.contractDate, r.endDate) : '-'}</td>
                    <td>{r.status || '-'}</td>
                    <td>{r.billedMonths > 0 ? `${period(r.firstBilled, r.lastBilled)} (${r.billedMonths}개월)` : '-'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatWon(r.billedTotal)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} style={{ fontWeight: 700 }}>합계</td>
                  <td style={{ textAlign: 'right', fontWeight: 800 }}>{formatWon(data.billedTotal)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <div style={{ fontSize: '11.5px', color: 'var(--ink-400)', marginTop: '4px' }}>
            firstoa-works 청구 데이터 기준(중지·병합 월 제외). 청구 데이터는 2025-10 이후분만 있어요.
          </div>

          <div className="detail-section-title">
            AS 접수 이력 {data.asRecords.length}건{' '}
            <a href={asSheetUrl} target="_blank" rel="noreferrer" style={{ fontSize: '12px', fontWeight: 400 }}>
              AS접수 시트 ↗
            </a>
          </div>
          {data.asError && <div style={{ color: 'var(--red-600)', fontSize: '12.5px' }}>{data.asError}</div>}
          {data.asRecords.length === 0 ? (
            <div className="detail-empty">AS 접수 기록이 없어요.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>접수일</th>
                  <th>처리여부</th>
                  <th>거래처</th>
                  <th>증상</th>
                  <th>처리내용</th>
                  <th>처리자</th>
                </tr>
              </thead>
              <tbody>
                {data.asRecords.map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.receivedDate}
                      <div style={{ fontSize: '11px', color: 'var(--ink-400)' }}>
                        {r.receivedTime} · {r.channel}
                      </div>
                    </td>
                    <td>{r.status || '-'}</td>
                    <td>{r.company || '-'}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{r.symptom || '-'}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{r.action || '-'}</td>
                    <td>{r.handler || r.receiver || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
