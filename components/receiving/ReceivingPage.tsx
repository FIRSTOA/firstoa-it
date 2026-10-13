'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  completeReceivingWithDetails,
  createReceiving,
  createReceivingBatch,
  deleteReceiving,
  updateReceiving,
  type ActionResult,
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
import PhotoBatchImportModal from './PhotoBatchImportModal';
import PurchaseEntryModal from './PurchaseEntryModal';
import ReceivingCompleteModal, { type CompleteUpdate } from './ReceivingCompleteModal';
import ReceivingFilters from './ReceivingFilters';
import ReceivingModal from './ReceivingModal';
import ReceivingStats from './ReceivingStats';
import ReceivingTable from './ReceivingTable';

/**
 * 여러 건을 한꺼번에 처리할 때 하나씩 순서대로 기다리면(특히 구글시트 API 호출이 끼면) 너무
 * 느려서, limit개씩 동시에 돌립니다. 개별 호출이 실패/타임아웃나도 catch로 감싸서 나머지
 * 항목 처리가 끊기지 않게 합니다(기존엔 for..await라 하나가 오래 걸리면 전체가 멈췄음).
 */
async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export default function ReceivingPage({
  entries,
  locations,
}: {
  entries: ReceivingEntry[];
  locations: string[];
}) {
  const [filters, setFilters] = useState(EMPTY_RECEIVING_FILTERS);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReceivingEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [completeTargets, setCompleteTargets] = useState<ReceivingEntry[]>([]);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  function closeToast() {
    setToast((t) => ({ ...t, show: false }));
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
      const isConsumable = entry.category === '기타주변기기';
      showToast(
        target
          ? '수정했어요.'
          : isConsumable
            ? '등록했어요.'
            : quantity > 1
              ? `${quantity}건 등록했어요.`
              : '등록했어요.',
      );
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

  function handleInlineSave(id: string, entry: ReceivingInput) {
    startTransition(async () => {
      const result = await updateReceiving(id, entry);
      showToast(result.ok ? '수정했어요.' : result.error);
    });
  }

  // 입고완료 처리는 더 이상 confirm()으로 바로 처리하지 않고, 위치/자산번호/시리얼을
  // 채우는 팝업(ReceivingCompleteModal)을 먼저 띄웁니다. 자세한 이유: 1) 이 값들이 아직 안
  // 채워진 건이 많아서 바로 처리하면 "필수값 누락"으로 조용히 실패했었고, 2) confirm()은
  // 카카오톡 인앱 브라우저 등에서 무시될 수 있어 이 앱 전반에서 피하는 패턴입니다.
  function handleComplete(entry: ReceivingEntry) {
    setCompleteTargets([entry]);
  }

  function handleCompleteSubmit(updates: CompleteUpdate[]) {
    startTransition(async () => {
      const results = await runWithConcurrency(updates, 3, async (u): Promise<ActionResult> => {
        try {
          return await completeReceivingWithDetails(u.id, u);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : '처리 중 오류가 났어요(시간 초과일 수 있어요).' };
        }
      });
      let success = 0;
      const failures: string[] = [];
      updates.forEach((u, i) => {
        const r = results[i];
        if (r.ok) success++;
        else failures.push(`${u.assetId || u.id}: ${r.error}`);
      });
      setCompleteTargets([]);
      clearSelection();
      if (failures.length === 0) {
        showToast(`${success}건 입고완료 처리했어요. 재고에 반영됐어요.`);
      } else {
        showToast(`${success}건 처리, ${failures.length}건 실패 — ${failures.slice(0, 2).join(' / ')}`);
      }
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
    setCompleteTargets(targets);
  }

  function handleBulkDelete() {
    if (selectedEntries.length === 0) return;
    if (!confirm(`선택한 ${selectedEntries.length}건을 삭제할까요?`)) return;
    startTransition(async () => {
      let success = 0;
      const failures: string[] = [];
      for (const entry of selectedEntries) {
        const result = await deleteReceiving(entry.id);
        if (result.ok) success++;
        else failures.push(`${entry.assetId || entry.model || entry.seq}: ${result.error}`);
      }
      clearSelection();
      if (failures.length === 0) {
        showToast(`${success}건 삭제했어요.`);
      } else {
        showToast(`${success}건 삭제, ${failures.length}건 실패 — ${failures.slice(0, 2).join(' / ')}`);
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
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setPhotoModalOpen(true)}>
            📷 사진으로 일괄 등록
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
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={handleBulkDelete}>
            선택 삭제
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
        onInlineSave={handleInlineSave}
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
        locations={locations}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkEditSave}
      />

      <ReceivingModal
        open={modalOpen}
        editing={editing}
        pending={pending}
        locations={locations}
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

      <PhotoBatchImportModal
        open={photoModalOpen}
        locations={locations}
        onClose={() => setPhotoModalOpen(false)}
        onDone={showToast}
      />

      <ReceivingCompleteModal
        open={completeTargets.length > 0}
        entries={completeTargets}
        locations={locations}
        pending={pending}
        onClose={() => setCompleteTargets([])}
        onSubmit={handleCompleteSubmit}
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
