'use client';

import type { SaleEntry } from '@/lib/sales';

type Props = {
  entries: SaleEntry[];
  disabled: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onEdit: (entry: SaleEntry) => void;
  onDelete: (id: string) => void;
};

export default function SalesTable({ entries, disabled, selectedIds, onToggleSelect, onToggleSelectAll, onEdit, onDelete }: Props) {
  const allSelected = entries.length > 0 && entries.every((e) => selectedIds.has(e.id));
  return (
    <div className="panel" style={{ paddingTop: '6px' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: '32px' }}>
              <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} aria-label="전체 선택" />
            </th>
            <th style={{ width: '50px' }}>순번</th>
            <th>모델명</th>
            <th>스펙</th>
            <th>자산번호</th>
            <th>시리얼번호</th>
            <th>구매처</th>
            <th>매입금액</th>
            <th>판매금액</th>
            <th>위치(판매한 곳)</th>
            <th>판매일</th>
            <th style={{ width: '90px' }} />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selectedIds.has(entry.id)}
                  onChange={() => onToggleSelect(entry.id)}
                  aria-label={`${entry.model || entry.seq} 선택`}
                />
              </td>
              <td>{entry.seq}</td>
              <td>{entry.model || '-'}</td>
              <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{entry.spec || '-'}</td>
              <td>{entry.assetId || '-'}</td>
              <td>{entry.serialNumber || '-'}</td>
              <td>{entry.purchaseVendor || '-'}</td>
              <td>{entry.purchasePrice || '-'}</td>
              <td>{entry.salePrice || '-'}</td>
              <td>{entry.destination || '-'}</td>
              <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{entry.saleDate || '-'}</td>
              <td>
                <div className="row-actions">
                  <button type="button" className="icon-btn" title="수정" disabled={disabled} onClick={() => onEdit(entry)}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="삭제"
                    disabled={disabled}
                    onClick={() => onDelete(entry.id)}
                  >
                    🗑
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && (
        <div className="empty-state">
          <div>💰</div>
          <div>조건에 맞는 판매 건이 없어요. 검색어를 조정하거나 새로 등록해 보세요.</div>
        </div>
      )}
    </div>
  );
}
