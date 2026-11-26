'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ITEM_KIND_RULES, type ItemKind } from '@/lib/salesConfirms/itemKind';
import { hasSpec, specKeys } from '@/lib/salesConfirms/salesForm/confirm';
import { salesConfirmHref, type SalesSlot, type SalesSlotLine, type SalesSpecKey, type SalesUnitRow } from '@/lib/salesConfirms/types';
import ChecklistPanel from './ChecklistPanel';
import {
  cleanSpec,
  sameDraftSpec,
  slotDomId,
  slotMarks,
  specToDraft,
  type AssetUse,
  type LookupAsset,
  type SaveUnit,
  type SlotRef,
  type UnitPatch,
} from './detailShared';
import SpecDiffEditor from './SpecDiffEditor';

export interface DeviceSlotCardProps {
  line: SalesSlotLine;
  slot: SalesSlot;
  /** 장비 · 모니터 · 유지보수 · 기타 (소프트웨어는 SoftwareSlotCard) */
  kind: Exclude<ItemKind, 'software'>;
  /** SQL 블록 A 전 등 — 입력을 막음 */
  disabled: boolean;
  saveUnit: SaveUnit;
  lookupAsset: LookupAsset;
  /** "다시 확인 필요" [확인] */
  onRecheck: (slot: SalesSlot) => void;
  /** 이 기기의 체크 항목(없으면 체크 칸 없음) */
  checkItems: { label: string }[];
  /** 이 확인서 안 다른 칸에도 같은 자산번호가 있음 */
  dupAsset: boolean;
  /** 열 때 서버가 준 "다른 확인서에도 있는 자산번호"(대문자 자산번호 → 다른 확인서들) */
  assetElsewhere?: Record<string, AssetUse[]>;
}

interface Draft {
  maker: string;
  model: string;
  asset: string;
  serial: string;
  note: string;
  spec: Record<string, string>;
}

function draftOf(u: SalesUnitRow | null): Draft {
  return {
    maker: u?.actualMaker ?? '',
    model: u?.actualModel ?? '',
    asset: u?.assetId ?? '',
    serial: u?.serial ?? '',
    note: u?.note ?? '',
    spec: specToDraft(u?.specOverride),
  };
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 장비·모니터·유지보수·기타 기기 칸 하나 — 입력 순서 제조사 · 모델명 · 자산번호 · 시리얼 · 출고사양(D18).
 * 칸을 나가면 저장(onBlur), 자산번호를 넣고 나가면 IT재고에서 빈 칸(제조사·모델명·시리얼)만 채움.
 * 제조사·모델명·사양 칸은 비어 있는 게 기본 — 흐린 글씨가 영업 요청 값. 영업과 다른 칸은 노란색.
 */
export default function DeviceSlotCard({ line, slot, kind, disabled, saveUnit, lookupAsset, onRecheck, checkItems, dupAsset, assetElsewhere }: DeviceSlotCardProps) {
  const unit = slot.unit;
  const rule = ITEM_KIND_RULES[kind];
  const has = (f: (typeof rule.fields)[number]) => rule.fields.includes(f);
  const showSpec = has('spec') && hasSpec(line.item.cat);
  const keys = (showSpec ? specKeys(line.item.cat) : []) as SalesSpecKey[];
  const ref: SlotRef = { itemIndex: line.itemIndex, slotKey: slot.slotKey, unitNo: slot.unitNo };
  const marks = slotMarks(slot);
  const rootRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<Draft>(() => draftOf(unit));
  const draftRef = useRef(draft);
  const base = useRef<Draft>(draftOf(unit));
  const [status, setStatus] = useState<Status>('idle');
  const [hint, setHint] = useState<{ text: string; warn: boolean } | null>(null);
  // 자산번호를 넣고 나간 뒤 조회로 알게 된 "다른 확인서에도 있어요"(그 자산번호일 때만 씀)
  const [looked, setLooked] = useState<{ asset: string; dupes: AssetUse[]; error: string } | null>(null);
  const assetKey = draft.asset.trim().toUpperCase();
  const dupUses: AssetUse[] = looked && looked.asset === assetKey ? looked.dupes : (assetElsewhere?.[assetKey] ?? []);
  const dupError = looked && looked.asset === assetKey ? looked.error : '';

  // 서버에서 새 값이 오면 초안에 반영 — 내가 고치는 중인 칸(저장된 값과 다른 초안)은 그대로 둠
  useEffect(() => {
    const next = draftOf(unit);
    const prev = base.current;
    const d = draftRef.current;
    const merged: Draft = {
      maker: d.maker === prev.maker ? next.maker : d.maker,
      model: d.model === prev.model ? next.model : d.model,
      asset: d.asset === prev.asset ? next.asset : d.asset,
      serial: d.serial === prev.serial ? next.serial : d.serial,
      note: d.note === prev.note ? next.note : d.note,
      spec: sameDraftSpec(d.spec, prev.spec) ? next.spec : d.spec,
    };
    base.current = next;
    draftRef.current = merged;
    setDraft(merged);
  }, [unit]);

  function set(p: Partial<Draft>) {
    draftRef.current = { ...draftRef.current, ...p };
    setDraft(draftRef.current);
  }

  function focusField(field: string) {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`);
    el?.focus();
  }

  async function commit(over?: Partial<Draft>) {
    const d = { ...draftRef.current, ...over };
    const b = base.current;
    const patch: UnitPatch = {};
    if (d.maker.trim() !== b.maker.trim()) patch.actualMaker = d.maker.trim();
    if (d.model.trim() !== b.model.trim()) patch.actualModel = d.model.trim();
    if (d.asset.trim() !== b.asset.trim()) patch.assetId = d.asset.trim();
    if (d.serial.trim() !== b.serial.trim()) patch.serial = d.serial.trim();
    if (d.note.trim() !== b.note.trim()) patch.note = d.note.trim();
    if (!sameDraftSpec(d.spec, b.spec)) patch.specOverride = cleanSpec(d.spec);
    if (Object.keys(patch).length === 0) return;
    setStatus('saving');
    const r = await saveUnit(ref, patch);
    if (r.ok) {
      setStatus('saved');
    } else {
      setStatus('error');
      if (r.redo && r.redo.length > 0) focusField(r.redo[0].field);
    }
  }

  async function onAssetBlur() {
    const d = draftRef.current;
    const asset = d.asset.trim();
    if (!asset || asset === base.current.asset.trim() || !has('model')) {
      // 자산번호가 그대로이거나 비었거나 우리 장비 조회가 필요 없는 칸 → 그냥 저장
      if (!asset) setHint(null);
      await commit();
      return;
    }
    setStatus('saving');
    setHint({ text: 'IT재고에서 찾는 중…', warn: false });
    let found = false;
    const over: Partial<Draft> = {};
    try {
      const res = await lookupAsset(asset, d.serial.trim() || d.model.trim());
      if (res.ok) {
        setLooked({ asset: asset.toUpperCase(), dupes: res.dupes ?? [], error: res.dupesError ?? '' });
        found = true;
        const cur = draftRef.current;
        if (!cur.maker.trim() && res.maker) over.maker = res.maker;
        if (!cur.model.trim() && res.model) over.model = res.model;
        if (!cur.serial.trim() && res.serials[0]) over.serial = res.serials[0];
        setHint({ text: res.specHint ? `IT재고: ${res.specHint}` : 'IT재고에서 찾았어요.', warn: false });
      } else {
        // 못 찾아도 다른 확인서에 같은 자산번호가 있으면 링크 경고는 그대로
        if (res.dupes) {
          setLooked({ asset: asset.toUpperCase(), dupes: res.dupes, error: res.dupesError ?? '' });
        }
        setHint({ text: res.error || 'IT재고에서 못 찾았어요. 직접 적어 주세요.', warn: true });
      }
    } catch {
      setHint({ text: 'IT재고를 읽지 못했어요. 직접 적어 주세요.', warn: true });
    }
    if (found) set(over);
    await commit(over);
  }

  const place = line.item.place;
  const needCount = slot.unackedDiffs.length;
  const statusText = status === 'saving' ? '저장 중…' : status === 'saved' ? '저장됨' : status === 'error' ? '저장 안 됨' : '';
  const id = slotDomId(line.itemIndex, slot.unitNo);
  const idp = `${id}-f`;

  return (
    <div ref={rootRef} id={id} className={`sc-slot${needCount > 0 ? ' sc-slot-warn' : ''}`}>
      <div className="sc-slot-head">
        <b>{slot.unitNo}번{kind === 'maintenance' ? ' (유지보수 대상)' : ''}</b>
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
        {has('maker') && (
          <Field label="제조사" id={`${idp}-maker`} mark={marks.maker}>
            <input
              id={`${idp}-maker`}
              data-field="maker"
              className={`sc-in${marks.maker ? ` sc-diff-${marks.maker.state}` : ''}`}
              value={draft.maker}
              placeholder={line.item.maker || '제조사'}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => set({ maker: e.target.value })}
              onBlur={() => void commit()}
            />
          </Field>
        )}
        {has('model') && (
          <Field label="모델명" id={`${idp}-model`} mark={marks.model}>
            <input
              id={`${idp}-model`}
              data-field="model"
              className={`sc-in${marks.model ? ` sc-diff-${marks.model.state}` : ''}`}
              value={draft.model}
              placeholder={line.item.model || '모델명'}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => set({ model: e.target.value })}
              onBlur={() => void commit()}
            />
          </Field>
        )}
        <Field label={kind === 'maintenance' ? '대상 기기 자산번호' : '자산번호'} id={`${idp}-asset`}>
          <input
            id={`${idp}-asset`}
            data-field="asset"
            className={`sc-in sc-mono-in${dupAsset ? ' sc-diff-need' : ''}`}
            value={draft.asset}
            placeholder="예: A0123"
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(e) => set({ asset: e.target.value })}
            onBlur={() => void onAssetBlur()}
          />
          {dupAsset && <div className="sc-diff-cap need">이 확인서의 다른 칸에도 같은 자산번호가 있어요.</div>}
          {kind !== 'maintenance' &&
            dupUses.map((u) => (
              <div key={u.confirmId} className="sc-diff-cap need">
                다른 확인서{' '}
                <Link href={salesConfirmHref(u.confirmId)} className="sc-link">
                  {u.docNo || '(순번 없음)'}
                  {u.company ? `(${u.company})` : ''}
                </Link>
                에도 있어요.
              </div>
            ))}
          {kind !== 'maintenance' && dupError && <div className="sc-diff-cap ack">같은 자산번호 확인을 못 했어요.</div>}
        </Field>
        <Field label={kind === 'maintenance' ? '시리얼 (우리 장비가 아니면 이것만)' : '시리얼'} id={`${idp}-serial`}>
          <input
            id={`${idp}-serial`}
            data-field="serial"
            className="sc-in sc-mono-in"
            value={draft.serial}
            placeholder="S/N"
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => set({ serial: e.target.value })}
            onBlur={() => void commit()}
          />
        </Field>
      </div>
      {hint && <div className={`sc-hint${hint.warn ? ' warn' : ''}`}>{hint.text}</div>}

      {showSpec && (
        <div className="sc-slot-spec">
          <div className="sc-sub-title">출고사양 <span className="sc-muted">(비워 두면 영업 요청 그대로)</span></div>
          <SpecDiffEditor
            keys={keys}
            sales={line.item.spec}
            value={draft.spec}
            marks={marks}
            disabled={disabled}
            idPrefix={`${idp}-spec`}
            onChange={(k, v) => set({ spec: { ...draftRef.current.spec, [k]: v } })}
            onBlur={() => void commit()}
          />
        </div>
      )}

      {has('note') && (
        <div className="sc-slot-note">
          <label htmlFor={`${idp}-note`}>메모</label>
          <input
            id={`${idp}-note`}
            className="sc-in"
            value={draft.note}
            placeholder="이 기기에 대해 남길 말"
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => set({ note: e.target.value })}
            onBlur={() => void commit()}
          />
        </div>
      )}

      {checkItems.length > 0 && (
        <ChecklistPanel
          items={checkItems}
          checks={unit?.checks ?? {}}
          disabled={disabled}
          onToggle={async (label, on) => (await saveUnit(ref, { checks: [{ label, on }] })).ok}
        />
      )}
      {place && kind !== 'maintenance' && <div className="sc-muted sc-slot-place">설치장소·요청: {place}</div>}
    </div>
  );
}

function Field({
  label,
  id,
  mark,
  children,
}: {
  label: string;
  id: string;
  mark?: { state: 'need' | 'ack'; sales: string; text: string };
  children: ReactNode;
}) {
  return (
    <div className="sc-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {mark && (
        <div className={`sc-diff-cap ${mark.state}`}>
          <b>요청 {mark.sales}</b> · {mark.text}
        </div>
      )}
    </div>
  );
}

/** 소프트웨어 칸 카드도 같은 칸 모양을 씀 */
export { Field as SlotField };
