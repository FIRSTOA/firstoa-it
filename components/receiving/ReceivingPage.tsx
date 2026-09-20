'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  completeReceiving,
  createReceiving,
  createReceivingBatch,
  deleteReceiving,
  updateReceiving,
} from '@/app/receiving/actions';
import {
  EMPTY_RECEIVING_FILTERS,
  filterReceivingEntries,
  type ReceivingEntry,
  type ReceivingInput,
} from '@/lib/receiving';
import { expandParsedGroup, type ParsedReceivingGroup } from '@/lib/receivingParser';
import BulkEditModal from './BulkEditModal';
import PasteImportModal from './PasteImportModal';
import PurchaseEntryModal from './PurchaseEntryModal';
import ReceivingFilters from './ReceivingFilters';
import ReceivingModal from './ReceivingModal';
import ReceivingStats from './ReceivingStats';
import ReceivingTable from './ReceivingTable';

export default function ReceivingPage({ entries }: { entries: ReceivingEntry[] }) {
  const [filters, setFilters] = useState(EMPTY_RECEIVING_FILTERS);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReceivingEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, duration = 2400) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), duration);
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

  function handlePasteImport(groups: ParsedReceivingGroup[]) {
    const entries: ReceivingInput[] = groups.flatMap(expandParsedGroup);
    startTransition(async () => {
      const result = await createReceivingBatch(entries);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setPasteModalOpen(false);
      showToast(`${entries.length}건 등록했어요.`);
    });
  }

  function handlePurchaseEntrySave(entries: ReceivingInput[]) {
    startTransition(async () => {
      const result = await createReceivingBatch(entries);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setPurchaseModalOpen(false);
      showToast(`${entries.length}건 등록했어요. (구매입고예정으로 자동 생성)`);
    });
  }

  function handleComplete(entry: ReceivingEntry) {
    if (!confirm(`자산번호 "${entry.assetId}"를 IT재고에 등록하고 입고완료 처리할까요?`)) return;
    startTransition(async () => {
      const result = await completeReceiving(entry.id);
      showToast(result.ok ? '입고완료 처리했어요. 재고에 자산이 등록됐어요.' : result.error);
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected = visible.length > 0 && visible.every((e) => prev.has(e.id));
      if (allSelected) return new Set();
      return new Set(visible.map((e) => e.id));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const selectedEntries = entries.filter((e) => selectedIds.has(e.id));

  function handleBulkComplete() {
    const targets = selectedEntries.filter((e) => e.status === '입고대기');
    if (targets.length === 0) {
      showToast('선택한 건 중에 입고대기 상태가 없어요.');
      return;
    }
    if (!confirm(`선택한 ${targets.length}건을 IT재고에 등록하고 입고완료 처리할까요?`)) return;
    startTransition(async () => {
      let success = 0;
      const failures: string[] = [];
      for (const entry of targets) {
        const result = await completeReceiving(entry.id);
        if (result.ok) success++;
        else failures.push(`${entry.assetId || entry.model || entry.seq}: ${result.error}`);
      }
      clearSelection();
      if (failures.length === 0) {
        showToast(`${success}건 입고완료 처리했어요.`);
      } else {
        showToast(`${success}건 처리, ${failures.length}건 실패 — ${failures.slice(0, 2).join(' / ')}`);
      }
    });
  }

  function handleBulkEditSave(patch: Partial<ReceivingInput>) {
    if (selectedEntries.length === 0) return;
    startTransition(async () => {
      let success = 0;
      const failures: string[] = [];
      for (const entry of selectedEntries) {
        const { id, seq, completedAt, ...base } = entry;
        void id;
        void seq;
        void completedAt;
        const result = await updateReceiving(entry.id, { ...base, ...patch });
        if (result.ok) success++;
        else failures.push(`${entry.assetId || entry.model || entry.seq}: ${result.error}`);
      }
      setBulkEditOpen(false);
      clearSelection();
      if (failures.length === 0) {
        showToast(`${success}건 일괄 수정했어요.`);
      } else {
        showToast(`${success}건 수정, ${failures.length}건 실패 — ${failures.slice(0, 2).join(' / ')}`);
      }
    });
  }

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="meta" style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>
          총 {entries.length}건
        </div>
        <div className="actions">
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setPasteModalOpen(true)}>
            📋 붙여넣기로 등록
          </button>
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
        onOpenPurchaseEntry={() => setPurchaseModalOpen(true)}
      />

      {selectedIds.size > 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{selectedIds.size}건 선택됨</span>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={handleBulkComplete}>
            입고완료 처리
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setBulkEditOpen(true)}>
            일괄 수정
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={clearSelection}>
            선택 해제
          </button>
        </div>
      )}

      <ReceivingTable
        entries={visible}
        disabled={pending}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onEdit={(entry) => {
          setEditing(entry);
          setModalOpen(true);
        }}
        onDelete={handleDelete}
        onComplete={handleComplete}
      />

      <BulkEditModal
        open={bulkEditOpen}
        pending={pending}
        count={selectedIds.size}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkEditSave}
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

      <PasteImportModal
        open={pasteModalOpen}
        pending={pending}
        onClose={() => setPasteModalOpen(false)}
        onImport={handlePasteImport}
      />

      <PurchaseEntryModal
        open={purchaseModalOpen}
        pending={pending}
        onClose={() => setPurchaseModalOpen(false)}
        onSave={handlePurchaseEntrySave}
      />

      <div className={`toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>
    </div>
  );
}
