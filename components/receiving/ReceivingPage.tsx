'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { completeReceiving, createReceiving, deleteReceiving, updateReceiving } from '@/app/receiving/actions';
import {
  EMPTY_RECEIVING_FILTERS,
  filterReceivingEntries,
  type ReceivingEntry,
  type ReceivingInput,
} from '@/lib/receiving';
import ReceivingFilters from './ReceivingFilters';
import ReceivingModal from './ReceivingModal';
import ReceivingStats from './ReceivingStats';
import ReceivingTable from './ReceivingTable';

export default function ReceivingPage({ entries }: { entries: ReceivingEntry[] }) {
  const [filters, setFilters] = useState(EMPTY_RECEIVING_FILTERS);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReceivingEntry | null>(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2400);
  }

  const visible = useMemo(
    () => filterReceivingEntries(entries, filters, searchTerm),
    [entries, filters, searchTerm],
  );

  function handleSave(entry: ReceivingInput, quantity: number) {
    const target = editing;
    startTransition(async () => {
      const result = target
        ? await updateReceiving(target.id, entry)
        : await createReceiving(entry, quantity);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setModalOpen(false);
      setEditing(null);
      showToast(target ? '수정했어요.' : quantity > 1 ? `${quantity}건 등록했어요.` : '등록했어요.');
    });
  }

  function handleDelete(id: string) {
    if (!confirm('이 입고 건을 삭제할까요?')) return;
    startTransition(async () => {
      const result = await deleteReceiving(id);
      showToast(result.ok ? '삭제했어요.' : result.error);
    });
  }

  function handleComplete(entry: ReceivingEntry) {
    if (!confirm(`자산번호 "${entry.assetId}"를 IT재고에 등록하고 입고완료 처리할까요?`)) return;
    startTransition(async () => {
      const result = await completeReceiving(entry.id);
      showToast(result.ok ? '입고완료 처리했어요. 재고에 자산이 등록됐어요.' : result.error);
    });
  }

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="meta" style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>
          총 {entries.length}건
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
            ＋ 입고 등록
          </button>
        </div>
      </div>

      <ReceivingStats
        entries={entries}
        statusFilter={filters.status}
        onSelectStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))}
      />

      <ReceivingFilters
        filters={filters}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onKindChange={(value) => setFilters((prev) => ({ ...prev, kind: value }))}
        onCategoryChange={(value) => setFilters((prev) => ({ ...prev, category: value }))}
      />

      <ReceivingTable
        entries={visible}
        disabled={pending}
        onEdit={(entry) => {
          setEditing(entry);
          setModalOpen(true);
        }}
        onDelete={handleDelete}
        onComplete={handleComplete}
      />

      <ReceivingModal
        open={modalOpen}
        editing={editing}
        pending={pending}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <div className={`toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>
    </div>
  );
}
