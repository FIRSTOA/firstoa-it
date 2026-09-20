'use client';

import { useEffect, useState } from 'react';
import { type ConsumableInput, type ConsumableItem } from '@/lib/consumables';

function toInput(item: ConsumableItem): ConsumableInput {
  const { rowNumber, ...input } = item;
  void rowNumber;
  return input;
}

function isSame(a: ConsumableInput, b: ConsumableInput): boolean {
  return (Object.keys(a) as (keyof ConsumableInput)[]).every((key) => a[key] === b[key]);
}

type RowProps = {
  item: ConsumableItem;
  disabled: boolean;
  selected: boolean;
  onToggleSelect: (rowNumber: number) => void;
  onInlineSave: (rowNumber: number, entry: ConsumableInput) => void;
  onEdit: (item: ConsumableItem) => void;
  onDelete: (item: ConsumableItem) => void;
};

const FIELDS: (keyof ConsumableInput)[] = [
  'gubun',
  'spec',
  'item',
  'model',
  'manufacturer',
  'vendor',
  'purchasePrice',
  'salePrice',
  'margin',
  'internetPrice',
];

function ConsumableRow({ item, disabled, selected, onToggleSelect, onInlineSave, onEdit, onDelete }: RowProps) {
  const [form, setForm] = useState<ConsumableInput>(() => toInput(item));

  useEffect(() => {
    setForm(toInput(item));
  }, [item]);

  function set(key: keyof ConsumableInput, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleBlur() {
    if (isSame(form, toInput(item))) return;
    onInlineSave(item.rowNumber, form);
  }

  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.rowNumber)}
          aria-label={`${item.item || item.rowNumber} 선택`}
        />
      </td>
      {FIELDS.map((key) => (
        <td key={key}>
          <input
            className="inline-cell-input"
            value={form[key]}
            onChange={(e) => set(key, e.target.value)}
            onBlur={handleBlur}
            disabled={disabled}
          />
        </td>
      ))}
      <td>
        <div className="row-actions">
          <button type="button" className="icon-btn" title="수정" disabled={disabled} onClick={() => onEdit(item)}>
            ✎
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title="삭제"
            disabled={disabled}
            onClick={() => onDelete(item)}
          >
            🗑
          </button>
        </div>
      </td>
    </tr>
  );
}

type Props = {
  items: ConsumableItem[];
  disabled: boolean;
  selectedRows: Set<number>;
  onToggleSelect: (rowNumber: number) => void;
  onToggleSelectAll: () => void;
  onInlineSave: (rowNumber: number, entry: ConsumableInput) => void;
  onEdit: (item: ConsumableItem) => void;
  onDelete: (item: ConsumableItem) => void;
};

export default function ConsumablesTable({
  items,
  disabled,
  selectedRows,
  onToggleSelect,
  onToggleSelectAll,
  onInlineSave,
  onEdit,
  onDelete,
}: Props) {
  const allSelected = items.length > 0 && items.every((c) => selectedRows.has(c.rowNumber));

  return (
    <div className="panel" style={{ paddingTop: '6px' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: '32px' }}>
              <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} aria-label="전체 선택" />
            </th>
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
          {items.map((item) => (
            <ConsumableRow
              key={item.rowNumber}
              item={item}
              disabled={disabled}
              selected={selectedRows.has(item.rowNumber)}
              onToggleSelect={onToggleSelect}
              onInlineSave={onInlineSave}
              onEdit={onEdit}
              onDelete={onDelete}
            />
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
