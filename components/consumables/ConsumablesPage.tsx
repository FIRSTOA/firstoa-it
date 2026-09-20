'use client';

import { useMemo, useState, useTransition } from 'react';
import { createConsumable, deleteConsumable, updateConsumable } from '@/app/consumables/actions';
import { filterConsumables, type ConsumableInput, type ConsumableItem } from '@/lib/consumables';
import ConsumableModal from './ConsumableModal';
import ConsumablesTable from './ConsumablesTable';

export default function ConsumablesPage({ items }: { items: ConsumableItem[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConsumableItem | null>(null);
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

  function handleDelete(item: ConsumableItem) {
    if (!confirm(`"${item.item || item.model}" 항목을 삭제할까요?`)) return;
    startTransition(async () => {
      const result = await deleteConsumable(item.rowNumber);
      showToast(result.ok ? '삭제했어요.' : result.error);
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

      <ConsumablesTable
        items={visible}
        disabled={pending}
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

      <div className={`toast${toast.show ? ' show' : ''}`}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={closeToast} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
