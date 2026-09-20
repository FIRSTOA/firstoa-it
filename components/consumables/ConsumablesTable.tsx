'use client';

import type { ConsumableItem } from '@/lib/consumables';

type Props = {
  items: ConsumableItem[];
  disabled: boolean;
  onEdit: (item: ConsumableItem) => void;
  onDelete: (item: ConsumableItem) => void;
};

export default function ConsumablesTable({ items, disabled, onEdit, onDelete }: Props) {
  return (
    <div className="panel" style={{ paddingTop: '6px' }}>
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>사양</th>
            <th>품목</th>
            <th>모델명</th>
            <th>제조사</th>
            <th>매입처</th>
            <th>구매단가</th>
            <th>판매단가</th>
            <th>마진</th>
            <th>인터넷가격</th>
            <th style={{ width: '70px' }} />
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.rowNumber}>
              <td>{c.gubun || '-'}</td>
              <td>{c.spec || '-'}</td>
              <td>{c.item || '-'}</td>
              <td>{c.model || '-'}</td>
              <td>{c.manufacturer || '-'}</td>
              <td>{c.vendor || '-'}</td>
              <td>{c.purchasePrice || '-'}</td>
              <td>{c.salePrice || '-'}</td>
              <td>{c.margin || '-'}</td>
              <td>{c.internetPrice || '-'}</td>
              <td>
                <div className="row-actions">
                  <button type="button" className="icon-btn" title="수정" disabled={disabled} onClick={() => onEdit(c)}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="삭제"
                    disabled={disabled}
                    onClick={() => onDelete(c)}
                  >
                    🗑
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <div className="empty-state">
          <div>🧰</div>
          <div>조건에 맞는 소모품이 없어요. 검색어를 조정하거나 새로 등록해 보세요.</div>
        </div>
      )}
    </div>
  );
}
