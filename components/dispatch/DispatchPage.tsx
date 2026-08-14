'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { createDispatch, deleteDispatch, updateDispatch } from '@/app/dispatch/actions';
import {
  EMPTY_DISPATCH_FILTERS,
  filterDispatchEntries,
  type DispatchEntry,
  type DispatchInput,
} from '@/lib/dispatch';
import DispatchFilters from './DispatchFilters';
import DispatchModal from './DispatchModal';
import DispatchStats from './DispatchStats';
import DispatchTable from './DispatchTable';

export default function DispatchPage({ entries }: { entries: DispatchEntry[] }) {
  const [filters, setFilters] = useState(EMPTY_DISPATCH_FILTERS);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DispatchEntry | null>(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 1800);
  }

  const visible = useMemo(
    () => filterDispatchEntries(entries, filters, searchTerm),
    [entries, filters, searchTerm],
  );

  function handleSave(entry: DispatchInput) {
    const target = editing;
    startTransition(async () => {
      const result = target ? await updateDispatch(target.id, entry) : await createDispatch(entry);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setModalOpen(false);
      setEditing(null);
      showToast(target ? '수정했어요.' : '등록했어요.');
    });
  }

  function handleDelete(id: string) {
    if (!confirm('이 접수 건을 삭제할까요?')) return;
    startTransition(async () => {
      const result = await deleteDispatch(id);
      showToast(result.ok ? '삭제했어요.' : result.error);
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
            ＋ 접수 등록
          </button>
        </div>
      </div>

      <DispatchStats
        entries={entries}
        statusFilter={filters.status}
        onSelectStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))}
      />

      <DispatchFilters
        filters={filters}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onTypeChange={(value) => setFilters((prev) => ({ ...prev, type: value }))}
      />

      <DispatchTable
        entries={visible}
        disabled={pending}
        onEdit={(entry) => {
          setEditing(entry);
          setModalOpen(true);
        }}
        onDelete={handleDelete}
      />

      <DispatchModal
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
