'use client';

import { useEffect, useRef, useState } from 'react';
import { ITEM_KIND_RULES } from '@/lib/salesConfirms/itemKind';
import type { SalesSlot, SalesSlotLine, SalesUnitRow, UnitLicenseState } from '@/lib/salesConfirms/types';
import { SlotField } from './DeviceSlotCard';
import { slotDomId, slotMarks, type SaveUnit, type SlotRef, type UnitPatch } from './detailShared';
import LicenseKeyField from './LicenseKeyField';

export interface SoftwareSlotCardProps {
  line: SalesSlotLine;
  slot: SalesSlot;
  disabled: boolean;
  saveUnit: SaveUnit;
  onRecheck: (slot: SalesSlot) => void;
  /** 이 칸의 대장·키 상태 */
  licState: UnitLicenseState | undefined;
  /** 대장에 올린 거래처 이름(없으면 null) */
  clientName: string | null;
  unlocked: boolean | null;
  licLoading: boolean;
  licError: string;
  needContractsSql: boolean;
  onUnlock: () => void;
  onRetryLicense: () => void;
  onSaveKey: (slot: SalesSlot, key: string) => Promise<boolean>;
  /** [대장에 올리기] / [다시 올리기] */
  onPushLedger: (unitId: string) => void;
}

interface Draft {
  model: string;
  maker: string;
  pc: string;
  user: string;
  note: string;
}

function draftOf(u: SalesUnitRow | null): Draft {
  return {
    model: u?.actualModel ?? '',
    maker: u?.actualMaker ?? '',
    pc: u?.extra?.pc ?? '',
    user: u?.extra?.user ?? '',
    note: u?.note ?? '',
  };
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 소프트웨어 칸 하나 = 라이선스 하나 = 계약관리 좌석 하나(D19·D28).
 * 입력 순서: 제품명(모델명) · 제조사 · 설치 PC 자산번호 · 사용자 · 라이선스 키(🔒) · 메모. 아래에 대장 상태.
 */
export default function SoftwareSlotCard(p: SoftwareSlotCardProps) {
  const { line, slot, disabled, saveUnit, onRecheck, licState, clientName } = p;
  const unit = slot.unit;
  const rule = ITEM_KIND_RULES.software;
  const ref: SlotRef = { itemIndex: line.itemIndex, slotKey: slot.slotKey, unitNo: slot.unitNo };
  const marks = slotMarks(slot);
  const rootRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<Draft>(() => draftOf(unit));
  const draftRef = useRef(draft);
  const base = useRef<Draft>(draftOf(unit));
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    const next = draftOf(unit);
    const prev = base.current;
    const d = draftRef.current;
    const merged: Draft = {
      model: d.model === prev.model ? next.model : d.model,
      maker: d.maker === prev.maker ? next.maker : d.maker,
      pc: d.pc === prev.pc ? next.pc : d.pc,
      user: d.user === prev.user ? next.user : d.user,
      note: d.note === prev.note ? next.note : d.note,
    };
    base.current = next;
    draftRef.current = merged;
    setDraft(merged);
  }, [unit]);

  function set(v: Partial<Draft>) {
    draftRef.current = { ...draftRef.current, ...v };
    setDraft(draftRef.current);
  }

  async function commit() {
    const d = draftRef.current;
    const b = base.current;
    const patch: UnitPatch = {};
    if (d.model.trim() !== b.model.trim()) patch.actualModel = d.model.trim();
    if (d.maker.trim() !== b.maker.trim()) patch.actualMaker = d.maker.trim();
    if (d.note.trim() !== b.note.trim()) patch.note = d.note.trim();
    if (d.pc.trim() !== b.pc.trim() || d.user.trim() !== b.user.trim()) {
      patch.extra = { pc: d.pc.trim(), user: d.user.trim() };
    }
    if (Object.keys(patch).length === 0) return;
    setStatus('saving');
    const r = await saveUnit(ref, patch);
    if (r.ok) {
      setStatus('saved');
    } else {
      setStatus('error');
      const first = r.redo?.[0]?.field;
      if (first) rootRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
    }
  }

  const id = slotDomId(line.itemIndex, slot.unitNo);
  const needCount = slot.unackedDiffs.length;
  const statusText = status === 'saving' ? '저장 중…' : status === 'saved' ? '저장됨' : status === 'error' ? '저장 안 됨' : '';

  return (
    <div ref={rootRef} id={id} className={`sc-slot${needCount > 0 ? ' sc-slot-warn' : ''}`}>
      <div className="sc-slot-head">
        <b>{slot.unitNo}번 라이선스</b>
        {statusText && <span className={`sc-save-state ${status}`}>{statusText}</span>}
        {needCount > 0 && unit && (
          <span className="sc-slot-recheck">
            <span className="sc-pill sc-pill-amber">다시 확인 필요 {needCount}</span>
            <button type="button" className="btn btn-ghost sc-btn" disabled={disabled} onClick={() => onRecheck(slot)}>
              확인
            </button>
          </span>
        )}
      </div>

      <div className="sc-slot-grid">
        {rule.fields.includes('model') && (
          <SlotField label="제품명" id={`${id}-f-model`} mark={marks.model}>
            <input
              id={`${id}-f-model`}
              data-field="model"
              className={`sc-in${marks.model ? ` sc-diff-${marks.model.state}` : ''}`}
              value={draft.model}
              placeholder={line.item.model || '제품명'}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => set({ model: e.target.value })}
              onBlur={() => void commit()}
            />
          </SlotField>
        )}
        {rule.fields.includes('maker') && (
          <SlotField label="제조사" id={`${id}-f-maker`} mark={marks.maker}>
            <input
              id={`${id}-f-maker`}
              data-field="maker"
              className={`sc-in${marks.maker ? ` sc-diff-${marks.maker.state}` : ''}`}
              value={draft.maker}
              placeholder={line.item.maker || '제조사'}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => set({ maker: e.target.value })}
              onBlur={() => void commit()}
            />
          </SlotField>
        )}
        <SlotField label="설치 PC 자산번호" id={`${id}-f-pc`}>
          <input
            id={`${id}-f-pc`}
            className="sc-in sc-mono-in"
            value={draft.pc}
            placeholder="예: A0123"
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(e) => set({ pc: e.target.value })}
            onBlur={() => void commit()}
          />
        </SlotField>
        <SlotField label="사용자 (선택)" id={`${id}-f-user`}>
          <input
            id={`${id}-f-user`}
            className="sc-in"
            value={draft.user}
            placeholder="쓰는 사람 이름"
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => set({ user: e.target.value })}
            onBlur={() => void commit()}
          />
        </SlotField>
        <div className="sc-field sc-field-wide">
          <label htmlFor={`${id}-f-key`}>라이선스 키</label>
          <LicenseKeyField
            id={`${id}-f-key`}
            state={licState}
            unlocked={p.unlocked}
            loading={p.licLoading}
            loadError={p.licError}
            needSql={p.needContractsSql}
            disabled={disabled}
            onUnlock={p.onUnlock}
            onRetryLoad={p.onRetryLicense}
            onSave={(k) => p.onSaveKey(slot, k)}
          />
        </div>
      </div>

      <LedgerLine state={licState} clientName={clientName} unlocked={p.unlocked} onPush={p.onPushLedger} />

      <div className="sc-slot-note">
        <label htmlFor={`${id}-f-note`}>메모</label>
        <input
          id={`${id}-f-note`}
          className="sc-in"
          value={draft.note}
          placeholder="이 라이선스에 대해 남길 말"
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => set({ note: e.target.value })}
          onBlur={() => void commit()}
        />
      </div>
    </div>
  );
}

/** 계약관리 소프트웨어 대장과의 연결 상태 한 줄 */
function LedgerLine({
  state,
  clientName,
  unlocked,
  onPush,
}: {
  state: UnitLicenseState | undefined;
  clientName: string | null;
  unlocked: boolean | null;
  onPush: (unitId: string) => void;
}) {
  if (unlocked === null) return null;
  const ledger = state?.ledger ?? 'none';
  const note = state?.ledgerNote ?? '';
  if (ledger === 'none') {
    return <div className="sc-ledger sc-muted">대장에 아직 없어요 — 키를 저장하면 계약관리 소프트웨어 대장에도 올라가요.</div>;
  }
  if (ledger === 'linked') {
    return <div className="sc-ledger good">✓ 대장에 있음{clientName ? ` · ${clientName}` : ''}</div>;
  }
  const canPush = unlocked === true && !!state?.unitId;
  if (ledger === 'pending') {
    return (
      <div className="sc-ledger warn">
        <span>대장에 반영 대기{note ? ` — ${note}` : ''}{unlocked ? '' : ' (비밀번호를 풀면 올릴 수 있어요)'}</span>
        {canPush && state && (
          <button type="button" className="btn btn-ghost sc-btn" onClick={() => onPush(state.unitId)}>
            대장에 올리기
          </button>
        )}
      </div>
    );
  }
  if (ledger === 'changed') {
    return (
      <div className="sc-ledger warn">
        <span>대장에서 바뀜{note ? ` — ${note}` : ''} (대장에서 고친 값은 덮어쓰지 않았어요)</span>
      </div>
    );
  }
  return (
    <div className="sc-ledger bad">
      <span>대장에서 지워졌어요{note ? ` — ${note}` : ''}</span>
      {canPush && state && (
        <button type="button" className="btn btn-ghost sc-btn" onClick={() => onPush(state.unitId)}>
          다시 올리기
        </button>
      )}
    </div>
  );
}
