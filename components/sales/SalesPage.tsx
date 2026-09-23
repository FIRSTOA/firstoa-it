'use client';

import { useMemo, useState, useTransition } from 'react';
import { createSale, createSalesBatch, deleteSale, updateSale } from '@/app/sales/actions';
import { filterSaleEntries, type SaleEntry, type SaleInput } from '@/lib/sales';
import PasteImportModal from './PasteImportModal';
import SalesModal from './SalesModal';
import SalesTable from './SalesTable';

export default function SalesPage({ entries }: { entries: SaleEntry[] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [editing, setEditing] = useState<SaleEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState({ msg: '', show: false });
  const [pending, startTransition] = useTransition();

  function showToast(msg: string) {
    setToast({ msg, show: true });
  }

  function closeToast() {
    setToast((t) => ({ ...t, show: false }));
  }

  const visible = useMemo(() => filterSaleEntries(entries, searchTerm), [entries, searchTerm]);

  function handleSave(entry: SaleInput) {
    const target = editing;
    startTransition(async () => {
      const result = target ? await updateSale(target.id, entry) : await createSale(entry);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setModalOpen(false);
      setEditing(null);
      showToast(target ? '수정했어요.' : '등록했어요.');
    });
  }

  function handlePasteImport(entries: SaleInput[]) {
    startTransition(async () => {
      const result = await createSalesBatch(entries);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setPasteModalOpen(false);
      showToast(`${entries.length}건 등록했어요.`);
    });
  }

  function handleDelete(id: string) {
    if (!confirm('이 판매 건을 삭제할까요?')) return;
    startTransition(async () => {
      const result = await deleteSale(id);
      showToast(result.ok ? '삭제했어요.' : result.error);
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

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 ${selectedIds.size}건을 삭제할까요?`)) return;
    startTransition(async () => {
      let success = 0;
      const failures: string[] = [];
      for (const id of selectedIds) {
        const result = await deleteSale(id);
        if (result.ok) success++;
        else failures.push(result.error);
      }
      clearSelection();
      if (failures.length === 0) showToast(`${success}건 삭제했어요.`);
      else showToast(`${success}건 삭제, ${failures.length}건 실패 — ${failures.slice(0, 2).join(' / ')}`);
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
            ＋ 판매 등록
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="search-row">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="모델명 / 자산번호 / 판매한 곳 / 구매처 / 스펙 검색"
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{selectedIds.size}건 선택됨</span>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={handleBulkDelete}>
            선택 삭제
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={clearSelection}>
            선택 해제
          </button>
        </div>
      )}

      <SalesTable
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
      />

      <SalesModal
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

      <div className={`toast${toast.show ? ' show' : ''}`}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={closeToast} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
