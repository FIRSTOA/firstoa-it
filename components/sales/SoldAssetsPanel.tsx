'use client';

import { useMemo, useState } from 'react';
import { parseHistoryEntries } from '@/lib/inventory/history';
import type { Asset } from '@/lib/types';

/**
 * IT재고 시트에서 위치값이 "판매"로 직접 기록된 자산 — 정식 판매 등록(it_sales_log) 없이
 * 재고 쪽에서 바로 판매 처리된 건들이라, 별도 테이블이 아니라 자산 데이터를 그대로
 * 읽기 전용으로 보여줍니다. 이동 이력(비고)에 언제 어느 거래처로 나갔는지가 남아있어서,
 * 판매한 지 오래된 자산을 추려 교체영업 대상으로 삼는 용도예요.
 */
export default function SoldAssetsPanel({ assets }: { assets: Asset[] }) {
  const [searchTerm, setSearchTerm] = useState('');

  const sorted = useMemo(
    () => [...assets].sort((a, b) => a.category.localeCompare(b.category, 'ko') || a.model.localeCompare(b.model, 'ko')),
    [assets],
  );

  const visible = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((a) => `${a.model} ${a.assetId} ${a.serialNo} ${a.brand} ${a.history}`.toLowerCase().includes(term));
  }, [sorted, searchTerm]);

  return (
    <div className="panel" style={{ marginTop: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px' }}>📦 재고에서 판매로 표시된 자산 ({assets.length}건)</div>
      </div>
      <div className="sub" style={{ marginBottom: '10px' }}>
        IT재고 시트에서 위치가 "판매"로 바로 기록된 자산이에요(정식 판매 등록과 별개). 이동 이력에
        언제 어느 거래처로 나갔는지 남아있으니, 판매한 지 오래된 건은 교체영업 대상으로 살펴보세요.
      </div>
      <div className="search-row" style={{ marginBottom: '10px' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="모델명 / 자산번호 / 시리얼번호 / 거래처(이력) 검색"
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '12.5px' }}>
          <thead>
            <tr>
              <th>품목</th>
              <th>브랜드</th>
              <th>모델명</th>
              <th>자산번호</th>
              <th>시리얼번호</th>
              <th>이동 이력(거래처/날짜)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const historyEntries = parseHistoryEntries(a.history);
              return (
                <tr key={a.assetId}>
                  <td>{a.category}</td>
                  <td>{a.brand || '-'}</td>
                  <td>{a.model || '-'}</td>
                  <td className="asset-id">{a.assetId}</td>
                  <td>{a.serialNo || '-'}</td>
                  <td>
                    {historyEntries.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {historyEntries.map((h, i) => (
                          <span key={i}>{h}</span>
                        ))}
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (
        <div className="empty-state">
          <div>📦</div>
          <div>{assets.length === 0 ? '재고에 판매로 표시된 자산이 없어요.' : '조건에 맞는 자산이 없어요.'}</div>
        </div>
      )}
    </div>
  );
}
