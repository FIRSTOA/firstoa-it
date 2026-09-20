'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  createConsumable,
  deleteConsumable,
  deleteConsumables,
  updateConsumable,
  updateConsumablesBulk,
} from '@/app/consumables/actions';
import { filterConsumables, type ConsumableInput, type ConsumableItem } from '@/lib/consumables';
import ConsumableModal from './ConsumableModal';
import ConsumablesBulkEditModal from './ConsumablesBulkEditModal';
import ConsumablesTable from './ConsumablesTable';

export default function ConsumablesPage({ items }: { items: ConsumableItem[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConsumableItem | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  function closeToast() {
    setToast((t) => ({ ...t, show: false }));
  }

  const visible = useMemo(() => filterConsumables(items, searchTerm), [items, searchTerm]);

  function handleSave(entry: ConsumableInput) {
    const target = editing;
    startTransition(async () => {
      const result = target ? await updateConsumable(target.rowNumber, entry) : await createConsumable(entry);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setModalOpen(false);
      setEditing(null);
      showToast(target ? '수정했어요.' : '등록했어요.');
    });
  }

  function handleInlineSave(rowNumber: number, entry: ConsumableInput) {
    startTransition(async () => {
      const result = await updateConsumable(rowNumber, entry);
      showToast(result.ok ? '수정했어요.' : result.error);
    });
  }

  function handleDelete(item: ConsumableItem) {
    if (!confirm(`"${item.item || item.model}" 항목을 삭제할까요?`)) return;
    startTransition(async () => {
      const result = await deleteConsumable(item.rowNumber);
      showToast(result.ok ? '삭제했어요.' : result.error);
    });
  }

  function toggleSelect(rowNumber: number) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedRows((prev) => {
      const allSelected = visible.length > 0 && visible.every((c) => prev.has(c.rowNumber));
      if (allSelected) return new Set();
      return new Set(visible.map((c) => c.rowNumber));
    });
  }

  function clearSelection() {
    setSelectedRows(new Set());
  }

  const selectedItems = items.filter((c) => selectedRows.has(c.rowNumber));

  function handleBulkDelete() {
    if (selectedRows.size === 0) return;
    if (!confirm(`선택한 ${selectedRows.size}건을 삭제할까요?`)) return;
    startTransition(async () => {
      const result = await deleteConsumables(Array.from(selectedRows));
      clearSelection();
      showToast(result.ok ? `${selectedRows.size}건 삭제했어요.` : result.error);
    });
  }

  function handleBulkEditSave(patch: Partial<ConsumableInput>) {
    if (selectedItems.length === 0) return;
    startTransition(async () => {
      const updates = selectedItems.map((item) => {
        const { rowNumber, ...base } = item;
        void rowNumber;
        return { rowNumber: item.rowNumber, entry: { ...base, ...patch } };
      });
      const result = await updateConsumablesBulk(updates);
      setBulkEditOpen(false);
      clearSelection();
      showToast(result.ok ? `${updates.length}건 일괄 수정했어요.` : result.error);
    });
  }

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="meta" style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>
          총 {items.length}건
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            ＋ 소모품 등록
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="search-row">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="구분 / 품목 / 모델명 / 제조사 / 매입처 검색"
          />
        </div>
      </div>

      {selectedRows.size > 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{selectedRows.size}건 선택됨</span>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setBulkEditOpen(true)}>
            일괄 수정
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={handleBulkDelete}>
            선택 삭제
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={clearSelection}>
            선택 해제
          </button>
        </div>
      )}

      <ConsumablesTable
        items={visible}
        disabled={pending}
        selectedRows={selectedRows}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onInlineSave={handleInlineSave}
        onEdit={(item) => {
          setEditing(item);
          setModalOpen(true);
        }}
        onDelete={handleDelete}
      />

      <ConsumableModal
        open={modalOpen}
        editing={editing}
        pending={pending}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <ConsumablesBulkEditModal
        open={bulkEditOpen}
        pending={pending}
        count={selectedRows.size}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkEditSave}
      />

      <div className={`toast${toast.show ? ' show' : ''}`}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={closeToast} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
