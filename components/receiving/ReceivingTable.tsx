'use client';

import { useEffect, useState } from 'react';
import { RECEIVING_KINDS, type ReceivingEntry, type ReceivingInput } from '@/lib/receiving';
import { CATEGORIES } from '@/lib/types';

const STATUS_BADGE_CLASS: Record<string, string> = {
  입고완료: 'badge-상품화완료',
  입고대기: 'badge-상품화준비중',
  취소: 'badge-악성',
};

/** 오늘 날짜(YYYY-MM-DD, 로컬 기준) — ISO 형식 문자열끼리는 사전식 비교가 날짜 비교와 같습니다. */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toInput(entry: ReceivingEntry): ReceivingInput {
  const { id, seq, completedAt, ...input } = entry;
  void id;
  void seq;
  void completedAt;
  return input;
}

function isSame(a: ReceivingInput, b: ReceivingInput): boolean {
  return (Object.keys(a) as (keyof ReceivingInput)[]).every((key) => a[key] === b[key]);
}

type RowProps = {
  entry: ReceivingEntry;
  today: string;
  disabled: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onInlineSave: (id: string, entry: ReceivingInput) => void;
  onEdit: (entry: ReceivingEntry) => void;
  onDelete: (id: string) => void;
  onComplete: (entry: ReceivingEntry) => void;
};

function ReceivingRow({
  entry,
  today,
  disabled,
  selected,
  onToggleSelect,
  onInlineSave,
  onEdit,
  onDelete,
  onComplete,
}: RowProps) {
  const [form, setForm] = useState<ReceivingInput>(() => toInput(entry));

  useEffect(() => {
    setForm(toInput(entry));
  }, [entry]);

  function set<K extends keyof ReceivingInput>(key: K, value: ReceivingInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function commit(next: ReceivingInput) {
    if (isSame(next, toInput(entry))) return;
    onInlineSave(entry.id, next);
  }

  function handleBlur() {
    commit(form);
  }

  function handleSelectChange<K extends keyof ReceivingInput>(key: K, value: ReceivingInput[K]) {
    const next = { ...form, [key]: value };
    setForm(next);
    commit(next); // select는 blur를 안 거치므로 바로 반영
  }

  const overdue = entry.status === '입고대기' && !!entry.expectedDate && entry.expectedDate < today;

  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(entry.id)}
          aria-label={`${entry.assetId || entry.seq} 선택`}
        />
      </td>
      <td>{entry.seq}</td>
      <td>
        <select
          className="inline-cell-input"
          value={form.kind}
          onChange={(e) => handleSelectChange('kind', e.target.value)}
          disabled={disabled}
        >
          {RECEIVING_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </td>
      <td>
        <span className={`badge ${STATUS_BADGE_CLASS[entry.status] ?? 'badge-기타'}`}>{entry.status}</span>
      </td>
      <td>
        <select
          className="inline-cell-input"
          value={form.category}
          onChange={(e) => handleSelectChange('category', e.target.value)}
          disabled={disabled}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          className="inline-cell-input"
          value={form.brand}
          onChange={(e) => set('brand', e.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="브랜드"
        />
      </td>
      <td>
        <input
          className="inline-cell-input"
          value={form.model}
          onChange={(e) => set('model', e.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="모델명"
        />
      </td>
      <td>
        <input
          className="inline-cell-input"
          value={form.assetId}
          onChange={(e) => set('assetId', e.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="자산번호"
        />
      </td>
      <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            className="inline-cell-input"
            type="date"
            value={form.expectedDate}
            onChange={(e) => handleSelectChange('expectedDate', e.target.value)}
            disabled={disabled}
          />
          {overdue && (
            <span className="badge badge-악성" style={{ flexShrink: 0 }}>
              지연
            </span>
          )}
        </div>
      </td>
      <td>
        <input
          className="inline-cell-input"
          value={form.manager}
          onChange={(e) => set('manager', e.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="담당자"
        />
      </td>
      <td>
        <input
          className="inline-cell-input"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="예: 거래처로 직송"
        />
      </td>
      <td>
        <div className="row-actions">
          {entry.status === '입고대기' && (
            <button type="button" className="chip" disabled={disabled} onClick={() => onComplete(entry)}>
              입고완료 처리
            </button>
          )}
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
  );
}

type Props = {
  entries: ReceivingEntry[];
  disabled: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onInlineSave: (id: string, entry: ReceivingInput) => void;
  onEdit: (entry: ReceivingEntry) => void;
  onDelete: (id: string) => void;
  onComplete: (entry: ReceivingEntry) => void;
};

export default function ReceivingTable({
  entries,
  disabled,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onInlineSave,
  onEdit,
  onDelete,
  onComplete,
}: Props) {
  const today = todayStr();
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
            <th>유형</th>
            <th>상태</th>
            <th>품목</th>
            <th>브랜드</th>
            <th>모델명</th>
            <th>자산번호</th>
            <th>예상입고일</th>
            <th>담당자</th>
            <th>비고</th>
            <th style={{ width: '150px' }} />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <ReceivingRow
              key={entry.id}
              entry={entry}
              today={today}
              disabled={disabled}
              selected={selectedIds.has(entry.id)}
              onToggleSelect={onToggleSelect}
              onInlineSave={onInlineSave}
              onEdit={onEdit}
              onDelete={onDelete}
              onComplete={onComplete}
            />
          ))}
        </tbody>
      </table>
      {entries.length === 0 && (
        <div className="empty-state">
          <div>📥</div>
          <div>조건에 맞는 입고 건이 없어요. 필터를 조정하거나 새로 등록해 보세요.</div>
        </div>
      )}
    </div>
  );
}
