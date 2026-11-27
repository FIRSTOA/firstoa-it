'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { ItemKind } from '@/lib/salesConfirms/itemKind';
import { isGenericModel, sameSpecValue } from '@/lib/salesConfirms/specCompare';
import {
  SPEC_TEXT_MAX,
  formatSpecLine,
  hasSpecValues,
  mergeSpec,
  sameSpecMap,
  specLineOf,
  specLinePlaceholder,
  specPatchFromLine,
} from '@/lib/salesConfirms/specLine';
import { specFromStockLabel } from '@/lib/salesConfirms/stockSpec';
import {
  salesConfirmHref,
  type DiffField,
  type SalesSlot,
  type SalesSlotLine,
  type SalesSpec,
  type SalesSpecKey,
  type SalesUnitRow,
  type UnitLicenseState,
} from '@/lib/salesConfirms/types';
import ChecklistPanel from './ChecklistPanel';
import {
  cleanSpec,
  diffFieldLabel,
  sameDraftSpec,
  slotDomId,
  slotMarks,
  specToDraft,
  type AssetUse,
  type FieldMark,
  type LookupAsset,
  type SaveUnit,
  type SlotRef,
  type UnitPatch,
} from './detailShared';
import LicenseKeyField from './LicenseKeyField';
import SpecDiffEditor from './SpecDiffEditor';

/**
 * 영업 확인서 상세 — 품목 블록(SlotLineBlock) 오른쪽 '출고시 (기재사항)' 표의 줄(2026-11-27 사용자: 예전 방식 화면처럼).
 * 한 줄 = ④ 한 행(칸) 그대로 — 데이터 모양·서버 규칙은 예전 카드(DeviceSlotCard·SoftwareSlotCard)와 같음.
 *   장비·모니터·기타: # | 자산번호 | S/N | 모델명 | 사양 | ⋯ ×      유지보수: # | 대상 자산번호 | S/N | ⋯ ×
 *   소프트웨어: # | 제품명 | 설치 PC | 사용자 | 라이선스 키 | ⋯ ×   (제조사는 품목에 한 칸 — SlotLineBlock)
 * 칸을 나가면 저장(saveSalesUnit 경로·동시 수정 검사 그대로). 자산번호를 넣고 나가면 IT재고에서 빈 칸만 채움(예전 카드 규칙 그대로).
 * '사양' 칸은 글자 한 줄 — 칸별 출고사양과 오가는 규칙은 lib/salesConfirms/specLine.ts 한 곳.
 * ⋯ 를 누르면 메모·출고 체크·사양 칸별로 고치기·"요청과 다름" 확인이 펼쳐짐(평소엔 접힘).
 */

/** keys = 장비(사양 칸 있는 품목)의 칸별 사양 · text = 모니터·기타·사양 칸 없는 장비(글자만) · none = 유지보수 */
export type SpecMode = 'keys' | 'text' | 'none';

type Status = 'idle' | 'saving' | 'saved' | 'error';
const STATUS_TEXT: Record<Status, string> = { idle: '', saving: '저장 중…', saved: '저장됨', error: '저장 안 됨' };
const STATUS_MARK: Record<Status, string> = { idle: '', saving: '…', saved: '✓', error: '!' };

/** # 칸 — 번호 · 추가한 줄 · 저장 상태(작은 표시, 마우스를 올리면 글자) */
function NoCell({ slot, status }: { slot: SalesSlot; status: Status }) {
  return (
    <td className="sc-ot-no">
      <span className="sc-ot-n">{slot.unitNo}</span>
      {slot.added && (
        <span className="sc-ot-added" title="영업 수량보다 더 내보내는 기기 — 종이 뒤 '추가 출고 기기' 장에 나가요">
          추가
        </span>
      )}
      {status !== 'idle' && (
        <span className={`sc-ot-st ${status}`} title={STATUS_TEXT[status]} aria-label={STATUS_TEXT[status]} role="status">
          {STATUS_MARK[status]}
        </span>
      )}
    </td>
  );
}

/** 사양 칸들의 노란 표시를 하나로(확인 전이 하나라도 있으면 need) + 마우스 글자 "요청 CPU I5 · RAM 8GB" */
function specMarkOf(marks: Partial<Record<DiffField, FieldMark>>): { state: 'need' | 'ack'; title: string } | null {
  const list = (Object.keys(marks) as DiffField[]).filter((f) => f.startsWith('spec:')).map((f) => [f, marks[f]!] as const);
  if (!list.length) return null;
  return {
    state: list.some(([, m]) => m.state === 'need') ? 'need' : 'ack',
    title: list.map(([f, m]) => `요청 ${f.slice('spec:'.length)} ${m.sales}${m.state === 'ack' ? ' (확인함)' : ''}`).join(' · '),
  };
}

const markTitle = (m: FieldMark | undefined) => (m ? `요청 ${m.sales} — ${m.state === 'need' ? '영업 요청과 달라요(인쇄할 때 한 번에 확인)' : '확인함'}` : undefined);

/** 자산번호 칸에서 Enter — 다음 줄 자산번호로(바코드 읽개가 Enter 를 보냄). 마지막 줄이면 칸을 나감(= 저장·IT재고 찾기) */
function enterToNextAsset(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  e.preventDefault();
  const el = e.currentTarget;
  const all = Array.from(el.closest('table')?.querySelectorAll<HTMLInputElement>('input[data-field="asset"]:not([disabled])') ?? []);
  const next = all[all.indexOf(el) + 1];
  if (next) next.focus();
  else el.blur();
}

/** 줄 끝 단추 — ⋯(펼침) · ×(추가한 줄 빼기 / 영업 칸 값 지우기) */
function ActCell({
  open,
  onToggle,
  moreId,
  moreTone,
  xTitle,
  xDisabled,
  onX,
}: {
  open: boolean;
  onToggle: () => void;
  moreId: string;
  /** ⋯ 안에 볼 것이 있음(has) · 확인할 것이 있음(warn) */
  moreTone: '' | 'has' | 'warn';
  xTitle: string;
  xDisabled: boolean;
  onX: () => void;
}) {
  return (
    <td className="sc-ot-act">
      <span className="sc-ot-btns">
        <button
          type="button"
          className={`icon-btn sc-ot-more-btn${open ? ' on' : ''}${moreTone ? ` ${moreTone}` : ''}`}
          aria-expanded={open}
          aria-controls={moreId}
          title={open ? '접기' : '메모·출고 체크·사양 칸별로 고치기'}
          onClick={onToggle}
        >
          ⋯
        </button>
        <button type="button" className="icon-btn danger" title={xTitle} aria-label={xTitle} disabled={xDisabled} onClick={onX}>
          ×
        </button>
      </span>
    </td>
  );
}

/** 펼친 줄 안 "요청과 다름" — 무엇이 다른지 + [지금 확인](안 눌러도 인쇄 때 한 번에 물음) */
function RecheckBox({ slot, modelLabel, disabled, onRecheck }: { slot: SalesSlot; modelLabel: string; disabled: boolean; onRecheck: (s: SalesSlot) => void }) {
  if (!slot.unit || slot.unackedDiffs.length === 0) return null;
  return (
    <div className="sc-ot-recheck">
      <span className="sc-pill sc-pill-amber">요청과 다름 {slot.unackedDiffs.length}</span>
      <span className="sc-ot-recheck-list">
        {slot.unackedDiffs.map((d) => (
          <span key={d.field}>
            {diffFieldLabel(d.field, modelLabel)}: 요청 {d.sales} → 출고 <b>{d.actual}</b>
          </span>
        ))}
      </span>
      <span className="sc-muted">저장은 됐어요 — 인쇄할 때 한 번에 확인해요.</span>
      <button type="button" className="btn btn-ghost sc-btn" disabled={disabled} onClick={() => onRecheck(slot)}>
        지금 확인
      </button>
    </div>
  );
}

/** 입력 중(저장값과 다른 초안) 알리기 — 칸이 사라지면 끝난 것으로 */
function useDirtyReport(key: string, dirty: boolean, onDirtyChange?: (key: string, dirty: boolean) => void) {
  const cb = useRef(onDirtyChange);
  cb.current = onDirtyChange;
  useEffect(() => {
    cb.current?.(key, dirty);
  }, [key, dirty]);
  useEffect(() => () => cb.current?.(key, false), [key]);
}

// ───────────────────────── 장비 · 모니터 · 기타 · 유지보수 ─────────────────────────

export interface DeviceRowProps {
  line: SalesSlotLine;
  slot: SalesSlot;
  kind: Exclude<ItemKind, 'software'>;
  specMode: SpecMode;
  /** specMode 'keys' 일 때 이 품목의 사양 칸(salesForm specKeys) — 아니면 [] */
  specKeys: readonly SalesSpecKey[];
  /** 표의 칸 수(펼친 줄 colSpan) */
  colCount: number;
  disabled: boolean;
  saveUnit: SaveUnit;
  lookupAsset: LookupAsset;
  onRecheck: (slot: SalesSlot) => void;
  /** `＋ 줄 추가`한 줄의 빼기(slot.added 일 때만) */
  onRemove?: () => void;
  checkItems: { label: string }[];
  /** 이 확인서 안 다른 줄에도 같은 자산번호 */
  dupAsset: boolean;
  assetElsewhere?: Record<string, AssetUse[]>;
  onDirtyChange?: (key: string, dirty: boolean) => void;
}

interface DeviceDraft {
  asset: string;
  serial: string;
  model: string;
  /** '사양' 칸 한 줄 */
  spec: string;
  /** 펼친 줄의 사양 칸별(keys 일 때) */
  specMap: Record<string, string>;
  note: string;
}

function deviceDraftOf(u: SalesUnitRow | null, request: SalesSpec, mode: SpecMode, keys: readonly SalesSpecKey[]): DeviceDraft {
  return {
    asset: u?.assetId ?? '',
    serial: u?.serial ?? '',
    model: u?.actualModel ?? '',
    spec: mode === 'none' ? '' : specLineOf(u, request, mode === 'keys' ? keys : []),
    specMap: mode === 'keys' ? specToDraft(u?.specOverride) : {},
    note: u?.note ?? '',
  };
}

function sameDeviceDraft(a: DeviceDraft, b: DeviceDraft): boolean {
  return (
    a.asset.trim() === b.asset.trim() &&
    a.serial.trim() === b.serial.trim() &&
    a.model.trim() === b.model.trim() &&
    a.spec.trim() === b.spec.trim() &&
    a.note.trim() === b.note.trim() &&
    sameDraftSpec(a.specMap, b.specMap)
  );
}

export function DeviceRow({
  line,
  slot,
  kind,
  specMode,
  specKeys: keys,
  colCount,
  disabled,
  saveUnit,
  lookupAsset,
  onRecheck,
  onRemove,
  checkItems,
  dupAsset,
  assetElsewhere,
  onDirtyChange,
}: DeviceRowProps) {
  const unit = slot.unit;
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const item = line.item;
  const isMaint = kind === 'maintenance';
  const hasModel = !isMaint;
  const ref: SlotRef = { itemIndex: line.itemIndex, slotKey: slot.slotKey, unitNo: slot.unitNo };
  const marks = slotMarks(slot);
  const specMark = specMarkOf(marks);
  const id = slotDomId(line.itemIndex, slot.unitNo);
  const moreId = `${id}-more`;
  const lineKeys = specMode === 'keys' ? keys : [];

  const [draft, setDraft] = useState<DeviceDraft>(() => deviceDraftOf(unit, item.spec, specMode, keys));
  const draftRef = useRef(draft);
  const base = useRef<DeviceDraft>(deviceDraftOf(unit, item.spec, specMode, keys));
  /** 마지막으로 보낸 초안 — 서버가 다듬어 돌려준 값(자산번호 대문자·사양 보이는 꼴)을 "입력 중"으로 잘못 보지 않게 */
  const sent = useRef<DeviceDraft | null>(null);
  /** '사양' 칸을 눌렀을 때 영업 요청을 채워 준 글자(안 고치고 나가면 다시 비움) */
  const prefill = useRef('');
  const [status, setStatus] = useState<Status>('idle');
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<{ text: string; warn: boolean } | null>(null);
  const [serialOptions, setSerialOptions] = useState<string[]>([]);
  const [looked, setLooked] = useState<{ asset: string; dupes: AssetUse[]; error: string } | null>(null);
  const assetKey = draft.asset.trim().toUpperCase();
  const dupUses: AssetUse[] = isMaint ? [] : looked && looked.asset === assetKey ? looked.dupes : (assetElsewhere?.[assetKey] ?? []);
  const dupError = !isMaint && looked && looked.asset === assetKey ? looked.error : '';

  // 서버에서 새 값이 오면 초안에 반영 — 내가 고치는 중인 칸(저장값과 다르고, 방금 보낸 값도 아닌 초안)은 그대로 둠
  useEffect(() => {
    const next = deviceDraftOf(unit, item.spec, specMode, keys);
    const prev = base.current;
    const d = draftRef.current;
    const s = sent.current;
    const take = <K extends keyof DeviceDraft>(k: K, same: (x: DeviceDraft[K], y: DeviceDraft[K]) => boolean) =>
      same(d[k], prev[k]) || (s !== null && same(d[k], s[k])) ? next[k] : d[k];
    const eq = (x: string, y: string) => x === y;
    const merged: DeviceDraft = {
      asset: take('asset', eq),
      serial: take('serial', eq),
      model: take('model', eq),
      spec: prefill.current && d.spec === prefill.current ? d.spec : take('spec', eq),
      specMap: take('specMap', sameDraftSpec),
      note: take('note', eq),
    };
    base.current = next;
    draftRef.current = merged;
    setDraft(merged);
  }, [unit, item.spec, specMode, keys]);

  // 눌러서 채워 준 영업 요청(prefill)은 고친 것이 아님
  const dirty = !sameDeviceDraft(prefill.current && draft.spec === prefill.current ? { ...draft, spec: base.current.spec } : draft, base.current);
  useDirtyReport(id, dirty, onDirtyChange);

  function set(p: Partial<DeviceDraft>) {
    draftRef.current = { ...draftRef.current, ...p };
    setDraft(draftRef.current);
  }

  /** 저장 — 바뀐 칸만. direct = 화면 칸이 아닌 값(IT재고에서 채운 칸별 사양·제조사) */
  async function commit(over?: Partial<DeviceDraft>, direct?: { specOverride?: SalesSpec; actualMaker?: string }) {
    const d = { ...draftRef.current, ...over };
    const b = base.current;
    const cur = unitRef.current;
    const patch: UnitPatch = {};
    if (d.asset.trim() !== b.asset.trim()) patch.assetId = d.asset.trim();
    if (d.serial.trim() !== b.serial.trim()) patch.serial = d.serial.trim();
    if (hasModel && d.model.trim() !== b.model.trim()) patch.actualModel = d.model.trim();
    if (direct?.actualMaker) patch.actualMaker = direct.actualMaker;
    if (direct?.specOverride) {
      patch.specOverride = direct.specOverride;
      patch.extra = { specText: '' };
    } else if (specMode !== 'none' && d.spec.trim() !== b.spec.trim()) {
      // 지금 보이는 값(영업 요청에 출고 값을 덮은 것) — 같은 칸 글자는 그대로 두고, 읽은 결과가 이것과 같으면 바뀐 게 없음
      const shown = mergeSpec(item.spec, cur?.specOverride, lineKeys);
      const sp = specPatchFromLine(d.spec, lineKeys, shown);
      const curText = (cur?.extra?.specText ?? '').trim();
      const same = sp.specText
        ? sp.specText === curText && !hasSpecValues(cur?.specOverride)
        : !curText && (sp.specOverride === undefined || sameSpecMap(sp.specOverride, shown));
      if (same) {
        // 띄어쓰기 등 모양만 다름 — 저장 없이 보이는 꼴로
        if (d.spec !== b.spec) set({ spec: b.spec });
        d.spec = b.spec;
      } else {
        if (sp.specOverride) patch.specOverride = sp.specOverride;
        patch.extra = { specText: sp.specText };
      }
    } else if (specMode === 'keys' && !sameDraftSpec(d.specMap, b.specMap)) {
      patch.specOverride = cleanSpec(d.specMap);
      patch.extra = { specText: '' };
    }
    if (d.note.trim() !== b.note.trim()) patch.note = d.note.trim();
    if (Object.keys(patch).length === 0) return;
    sent.current = d;
    setStatus('saving');
    const r = await saveUnit(ref, patch);
    setStatus(r.ok ? 'saved' : 'error');
  }

  /** IT재고에서 채울 빈 칸(시리얼·출고사양)이 남아 있는지 — 예전 카드 규칙 그대로 */
  function hasStockBlanks(d: DeviceDraft): boolean {
    if (!d.serial.trim()) return true;
    const u = unitRef.current;
    if (specMode === 'keys') return !(u?.extra?.specText ?? '').trim() && keys.some((k) => !(u?.specOverride?.[k] ?? '').trim());
    if (specMode === 'text') return !d.spec.trim();
    return false;
  }

  async function onAssetBlur() {
    const d = draftRef.current;
    const asset = d.asset.trim();
    if (!asset || !hasModel) {
      // 자산번호가 비었거나 우리 장비 조회가 필요 없는 칸(유지보수) → 그냥 저장
      if (!asset) setHint(null);
      await commit();
      return;
    }
    // 자산번호가 그대로여도 빈 칸이 있으면 IT재고에서 채움 — 이 화면에서 같은 번호로 이미 찾아봤으면 다시 안 읽음(시트 한도 — 단추로만 다시)
    const alreadyLooked = looked?.asset === asset.toUpperCase();
    if (asset.toUpperCase() === base.current.asset.trim().toUpperCase() && (!hasStockBlanks(d) || alreadyLooked)) {
      await commit();
      return;
    }
    await fillFromStock(asset);
  }

  /** 자산번호로 IT재고를 찾아 **빈 칸만** 채우고 저장(사람이 적은 값은 안 덮음) — 칸 나갈 때·⋯ 안 `↻ IT재고에서 빈 칸 채우기` */
  async function fillFromStock(asset: string) {
    const d = draftRef.current;
    setStatus('saving');
    setHint({ text: 'IT재고에서 찾는 중…', warn: false });
    let found = false;
    const over: Partial<DeviceDraft> = {};
    const direct: { specOverride?: SalesSpec; actualMaker?: string } = {};
    try {
      const res = await lookupAsset(asset, d.serial.trim() || d.model.trim());
      if (res.ok) {
        setLooked({ asset: asset.toUpperCase(), dupes: res.dupes ?? [], error: res.dupesError ?? '' });
        setSerialOptions(res.serials.length > 1 ? res.serials : []);
        found = true;
        const cur = draftRef.current;
        const u = unitRef.current;
        // 영업 요청과 같은 제조사(조립=조립PC 등)·종류 이름뿐인 모델("데스크탑")은 채우지 않음 — 비워 두면 영업 요청 그대로
        if (!(u?.actualMaker ?? '').trim() && res.maker && !sameSpecValue('maker', String(item.maker ?? ''), res.maker)) direct.actualMaker = res.maker;
        if (!cur.model.trim() && res.model && !isGenericModel(res.model) && !sameSpecValue('model', String(item.model ?? ''), res.model)) {
          over.model = res.model;
        }
        if (!cur.serial.trim() && res.serials[0]) over.serial = res.serials[0];
        if (specMode === 'keys' && res.specHint && cur.spec.trim() === base.current.spec.trim() && !(u?.extra?.specText ?? '').trim()) {
          // 칸별 출고사양의 빈 칸만 IT재고 사양 글자에서(읽기 자신 없으면 안 채움 — stockSpec.ts)
          const stock = specFromStockLabel(res.specHint);
          const next: SalesSpec = { ...(u?.specOverride ?? {}) };
          let filled = false;
          for (const k of keys) {
            const v = stock[k];
            if (v && !(next[k] ?? '').trim()) {
              next[k] = v;
              filled = true;
            }
          }
          if (filled) {
            direct.specOverride = next;
            over.spec = formatSpecLine(mergeSpec(item.spec, next, keys), keys);
          }
        } else if (specMode === 'text' && res.specHint && !cur.spec.trim()) {
          // 모니터·기타 — 사양 칸이 비었으면 IT재고 사양 글자 그대로(예전 방식 화면과 같음)
          over.spec = res.specHint.slice(0, SPEC_TEXT_MAX);
        }
        setHint({ text: res.specHint ? `IT재고: ${res.specHint}` : 'IT재고에서 찾았어요.', warn: false });
      } else {
        if (res.dupes) setLooked({ asset: asset.toUpperCase(), dupes: res.dupes, error: res.dupesError ?? '' });
        setHint({ text: res.error || 'IT재고에서 못 찾았어요. 직접 적어 주세요.', warn: true });
      }
    } catch {
      setHint({ text: 'IT재고를 읽지 못했어요. 직접 적어 주세요.', warn: true });
    }
    if (found) set(over);
    await commit(over, direct);
    setStatus((s) => (s === 'saving' ? 'idle' : s)); // 바뀐 칸이 없어 저장을 안 했으면 표시를 거둠
  }

  function onSpecFocus(e: FocusEvent<HTMLInputElement>) {
    if (specMode !== 'keys' || disabled) return;
    if (draftRef.current.spec.trim() || base.current.spec.trim()) return;
    const ph = specLinePlaceholder(item.spec, keys);
    if (!ph) return;
    // 영업 요청을 채워 줌 — 한 칸만 바꾸기 쉽게(안 고치고 나가면 다시 비움 = 영업 요청 그대로)
    prefill.current = ph;
    set({ spec: ph });
    const el = e.currentTarget;
    window.requestAnimationFrame(() => {
      try {
        el.select();
      } catch {
        /* 고르기 못 해도 그대로 */
      }
    });
  }
  function onSpecBlur() {
    const p = prefill.current;
    prefill.current = '';
    if (p && draftRef.current.spec.trim() === p.trim()) {
      set({ spec: base.current.spec });
      return;
    }
    void commit();
  }

  const u = unit;
  const hasValues = !!(
    u &&
    (u.assetId || u.serial || u.actualModel || hasSpecValues(u.specOverride) || (u.extra?.specText ?? '').trim())
  ) || !!(draft.asset.trim() || draft.serial.trim() || draft.model.trim() || (draft.spec.trim() && draft.spec !== prefill.current));

  function onX() {
    if (slot.added) {
      onRemove?.();
      return;
    }
    if (!hasValues) return;
    const what = isMaint ? '자산번호·S/N' : '자산번호·S/N·모델명·사양';
    if (!window.confirm(`${slot.unitNo}번 줄의 ${what}을 지울까요? (메모·출고 체크는 그대로예요)`)) return;
    setHint(null);
    setLooked(null);
    setSerialOptions([]);
    prefill.current = '';
    const over: Partial<DeviceDraft> = { asset: '', serial: '', model: '', spec: '', specMap: {} };
    set(over);
    void commit(over);
  }

  const checkCount = Object.keys(u?.checks ?? {}).filter((k) => checkItems.some((c) => c.label === k)).length;
  const moreTone: '' | 'has' | 'warn' = slot.unackedDiffs.length > 0 ? 'warn' : (u?.note ?? '').trim() || checkCount > 0 ? 'has' : '';
  const specPlaceholder = specMode === 'keys' ? specLinePlaceholder(item.spec, keys) || '사양' : '사양';
  const listId = serialOptions.length ? `${id}-sn` : undefined;

  return (
    <>
      <tr id={id} className={`sc-ot-row${open ? ' sc-ot-open' : ''}${slot.unackedDiffs.length ? ' sc-ot-warn' : ''}`}>
        <NoCell slot={slot} status={status} />
        <td className="sc-ot-asset">
          <input
            data-field="asset"
            className={`sc-in sc-mono-in${dupAsset || dupUses.length ? ' sc-diff-need' : ''}`}
            value={draft.asset}
            placeholder={isMaint ? '대상 자산번호' : '자산번호'}
            aria-label={`${slot.unitNo}번 ${isMaint ? '대상 자산번호' : '자산번호'}`}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => set({ asset: e.target.value })}
            onKeyDown={enterToNextAsset}
            onBlur={() => void onAssetBlur()}
          />
          {hint && <div className={`sc-ot-note${hint.warn ? ' warn' : ' ok'}`}>{hint.text}</div>}
          {dupAsset && <div className="sc-ot-note warn">이 확인서 다른 줄에도 같은 자산번호가 있어요.</div>}
          {dupUses.map((x) => (
            <div key={x.confirmId} className="sc-ot-note warn">
              다른 확인서{' '}
              <Link href={salesConfirmHref(x.confirmId)} className="sc-link">
                {x.docNo || '(순번 없음)'}
                {x.company ? `(${x.company})` : ''}
              </Link>
              에도 있어요.
            </div>
          ))}
          {dupError && <div className="sc-ot-note">같은 자산번호 확인을 못 했어요.</div>}
        </td>
        <td>
          <input
            data-field="serial"
            className="sc-in sc-mono-in"
            value={draft.serial}
            placeholder="S/N"
            aria-label={`${slot.unitNo}번 S/N`}
            list={listId}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set({ serial: e.target.value })}
            onBlur={() => void commit()}
          />
          {listId && (
            <datalist id={listId}>
              {serialOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </td>
        {hasModel && (
          <td>
            <input
              data-field="model"
              className={`sc-in${marks.model ? ` sc-diff-${marks.model.state}` : ''}`}
              value={draft.model}
              placeholder={item.model || '모델명'}
              title={markTitle(marks.model)}
              aria-label={`${slot.unitNo}번 모델명`}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => set({ model: e.target.value })}
              onBlur={() => void commit()}
            />
          </td>
        )}
        {specMode !== 'none' && (
          <td>
            <input
              data-field="spec"
              className={`sc-in sc-ot-spec${specMark ? ` sc-diff-${specMark.state}` : ''}`}
              value={draft.spec}
              placeholder={specPlaceholder}
              title={
                specMark?.title ??
                (specMode === 'keys' ? 'CPU / RAM / SSD / HDD / 그래픽 차례 — 예: I5-12 / 16GB / 512GB / X / 내장. 빈 자리는 영업 요청 그대로, 없으면 X' : undefined)
              }
              aria-label={`${slot.unitNo}번 사양`}
              maxLength={SPEC_TEXT_MAX}
              disabled={disabled}
              autoComplete="off"
              onFocus={onSpecFocus}
              onChange={(e) => {
                if (prefill.current && e.target.value !== prefill.current) prefill.current = '';
                set({ spec: e.target.value });
              }}
              onBlur={onSpecBlur}
            />
          </td>
        )}
        <ActCell
          open={open}
          onToggle={() => setOpen((v) => !v)}
          moreId={moreId}
          moreTone={moreTone}
          xTitle={slot.added ? '이 줄 빼기(추가한 줄)' : '이 줄 값 지우기'}
          xDisabled={disabled || (slot.added ? !onRemove : !hasValues)}
          onX={onX}
        />
      </tr>
      {open && (
        <tr id={moreId} className="sc-ot-more">
          <td colSpan={colCount}>
            <div className="sc-ot-more-in">
              <RecheckBox slot={slot} modelLabel="모델명" disabled={disabled} onRecheck={onRecheck} />
              {hasModel && draft.asset.trim() && !disabled && (
                <div>
                  <button
                    type="button"
                    className="sc-link"
                    onClick={() => void fillFromStock(draft.asset.trim())}
                    title="이 자산번호로 IT재고를 다시 찾아 비어 있는 칸(S/N·모델명·사양)만 채워요. 적어 둔 값은 그대로예요."
                  >
                    ↻ IT재고에서 빈 칸 채우기
                  </button>
                </div>
              )}
              {specMode === 'keys' && (
                <div>
                  <div className="sc-sub-title">
                    사양 칸별로 <span className="sc-muted">(비워 두면 영업 요청 그대로)</span>
                  </div>
                  <SpecDiffEditor
                    keys={[...keys]}
                    sales={item.spec}
                    value={draft.specMap}
                    marks={marks}
                    disabled={disabled}
                    idPrefix={`${id}-spec`}
                    onChange={(k, v) => set({ specMap: { ...draftRef.current.specMap, [k]: v } })}
                    onBlur={() => void commit()}
                  />
                </div>
              )}
              <div className="sc-slot-note">
                <label htmlFor={`${id}-note`}>메모</label>
                <input
                  id={`${id}-note`}
                  className="sc-in"
                  value={draft.note}
                  placeholder="이 기기에 대해 남길 말"
                  disabled={disabled}
                  autoComplete="off"
                  onChange={(e) => set({ note: e.target.value })}
                  onBlur={() => void commit()}
                />
              </div>
              {checkItems.length > 0 && (
                <ChecklistPanel
                  items={checkItems}
                  checks={u?.checks ?? {}}
                  disabled={disabled}
                  defaultOpen
                  title="출고 체크"
                  onToggle={async (label, on) => (await saveUnit(ref, { checks: [{ label, on }] })).ok}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ───────────────────────── 소프트웨어 ─────────────────────────

export interface LicenseProps {
  /** 칸 id → 대장·키 상태 */
  stateFor: (unitId: string | undefined) => UnitLicenseState | undefined;
  clientName: string | null;
  /** true 풀림 · false 잠김 · null 모름(읽는 중·실패) */
  unlocked: boolean | null;
  loading: boolean;
  error: string;
  needSql: boolean;
  onUnlock: () => void;
  onRetry: () => void;
  onSaveKey: (ref: SlotRef, key: string) => Promise<boolean>;
  onPushLedger: (unitId: string) => void;
}

export interface SoftwareRowProps {
  line: SalesSlotLine;
  slot: SalesSlot;
  colCount: number;
  disabled: boolean;
  saveUnit: SaveUnit;
  onRecheck: (slot: SalesSlot) => void;
  license: LicenseProps;
  onDirtyChange?: (key: string, dirty: boolean) => void;
}

interface SwDraft {
  model: string;
  pc: string;
  user: string;
  note: string;
}

function swDraftOf(u: SalesUnitRow | null): SwDraft {
  return { model: u?.actualModel ?? '', pc: u?.extra?.pc ?? '', user: u?.extra?.user ?? '', note: u?.note ?? '' };
}
const sameSw = (a: SwDraft, b: SwDraft) =>
  a.model.trim() === b.model.trim() && a.pc.trim() === b.pc.trim() && a.user.trim() === b.user.trim() && a.note.trim() === b.note.trim();

/** 소프트웨어 줄 = 라이선스 하나 = 계약관리 좌석 하나(D19·D28). 키는 계약관리 잠금 칸(LicenseKeyField — 예전 그대로) */
export function SoftwareRow({ line, slot, colCount, disabled, saveUnit, onRecheck, license, onDirtyChange }: SoftwareRowProps) {
  const unit = slot.unit;
  const ref: SlotRef = { itemIndex: line.itemIndex, slotKey: slot.slotKey, unitNo: slot.unitNo };
  const marks = slotMarks(slot);
  const id = slotDomId(line.itemIndex, slot.unitNo);
  const moreId = `${id}-more`;
  const lic = license.stateFor(unit?.id);

  const [draft, setDraft] = useState<SwDraft>(() => swDraftOf(unit));
  const draftRef = useRef(draft);
  const base = useRef<SwDraft>(swDraftOf(unit));
  const sent = useRef<SwDraft | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const next = swDraftOf(unit);
    const prev = base.current;
    const d = draftRef.current;
    const s = sent.current;
    const take = (k: keyof SwDraft) => (d[k] === prev[k] || (s !== null && d[k] === s[k]) ? next[k] : d[k]);
    const merged: SwDraft = { model: take('model'), pc: take('pc'), user: take('user'), note: take('note') };
    base.current = next;
    draftRef.current = merged;
    setDraft(merged);
  }, [unit]);

  useDirtyReport(id, !sameSw(draft, base.current), onDirtyChange);

  function set(p: Partial<SwDraft>) {
    draftRef.current = { ...draftRef.current, ...p };
    setDraft(draftRef.current);
  }

  async function commit(over?: Partial<SwDraft>) {
    const d = { ...draftRef.current, ...over };
    const b = base.current;
    const patch: UnitPatch = {};
    if (d.model.trim() !== b.model.trim()) patch.actualModel = d.model.trim();
    if (d.note.trim() !== b.note.trim()) patch.note = d.note.trim();
    if (d.pc.trim() !== b.pc.trim() || d.user.trim() !== b.user.trim()) patch.extra = { pc: d.pc.trim(), user: d.user.trim() };
    if (Object.keys(patch).length === 0) return;
    sent.current = d;
    setStatus('saving');
    const r = await saveUnit(ref, patch);
    setStatus(r.ok ? 'saved' : 'error');
  }

  const u = unit;
  const hasValues = !!(u && (u.actualModel || u.extra?.pc || u.extra?.user)) || !!(draft.model.trim() || draft.pc.trim() || draft.user.trim());
  function onX() {
    if (!hasValues) return;
    if (!window.confirm(`${slot.unitNo}번 줄의 제품명·설치 PC·사용자를 지울까요? (라이선스 키·메모는 그대로예요 — 키는 키 칸에서 지워요)`)) return;
    const over: Partial<SwDraft> = { model: '', pc: '', user: '' };
    set(over);
    void commit(over);
  }

  const ledger = lic?.ledger ?? 'none';
  const ledgerWarn = license.unlocked !== null && (ledger === 'pending' || ledger === 'changed' || ledger === 'deleted');
  const moreTone: '' | 'has' | 'warn' = slot.unackedDiffs.length > 0 || ledgerWarn ? 'warn' : (u?.note ?? '').trim() ? 'has' : '';

  return (
    <>
      <tr id={id} className={`sc-ot-row${open ? ' sc-ot-open' : ''}${slot.unackedDiffs.length ? ' sc-ot-warn' : ''}`}>
        <NoCell slot={slot} status={status} />
        <td>
          <input
            data-field="model"
            className={`sc-in${marks.model ? ` sc-diff-${marks.model.state}` : ''}`}
            value={draft.model}
            placeholder={line.item.model || '제품명'}
            title={markTitle(marks.model)}
            aria-label={`${slot.unitNo}번 제품명`}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => set({ model: e.target.value })}
            onBlur={() => void commit()}
          />
        </td>
        <td>
          <input
            data-field="pc"
            className="sc-in sc-mono-in"
            value={draft.pc}
            placeholder="예: A0123"
            aria-label={`${slot.unitNo}번 설치 PC 자산번호`}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => set({ pc: e.target.value })}
            onBlur={() => void commit()}
          />
        </td>
        <td>
          <input
            data-field="user"
            className="sc-in"
            value={draft.user}
            placeholder="쓰는 사람(선택)"
            aria-label={`${slot.unitNo}번 사용자`}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => set({ user: e.target.value })}
            onBlur={() => void commit()}
          />
        </td>
        <td className="sc-ot-key">
          <LicenseKeyField
            id={`${id}-key`}
            state={lic}
            unlocked={license.unlocked}
            loading={license.loading}
            loadError={license.error}
            needSql={license.needSql}
            disabled={disabled}
            onUnlock={license.onUnlock}
            onRetryLoad={license.onRetry}
            onSave={(k) => license.onSaveKey(ref, k)}
          />
          {ledgerWarn && (
            <div className={`sc-ot-note ${ledger === 'deleted' ? 'bad' : 'warn'}`}>
              {ledger === 'pending' ? '대장 반영 대기' : ledger === 'changed' ? '대장에서 바뀜' : '대장에서 지워짐'} — ⋯ 에서 보기
            </div>
          )}
        </td>
        <ActCell
          open={open}
          onToggle={() => setOpen((v) => !v)}
          moreId={moreId}
          moreTone={moreTone}
          xTitle="이 줄 값 지우기"
          xDisabled={disabled || !hasValues}
          onX={onX}
        />
      </tr>
      {open && (
        <tr id={moreId} className="sc-ot-more">
          <td colSpan={colCount}>
            <div className="sc-ot-more-in">
              <RecheckBox slot={slot} modelLabel="제품명" disabled={disabled} onRecheck={onRecheck} />
              <LedgerLine state={lic} clientName={license.clientName} unlocked={license.unlocked} onPush={license.onPushLedger} />
              <div className="sc-slot-note">
                <label htmlFor={`${id}-note`}>메모</label>
                <input
                  id={`${id}-note`}
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
          </td>
        </tr>
      )}
    </>
  );
}

/** 계약관리 소프트웨어 대장과의 연결 상태 한 줄(예전 SoftwareSlotCard 것 그대로) */
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
        <span>
          대장에 반영 대기{note ? ` — ${note}` : ''}
          {unlocked ? '' : ' (비밀번호를 풀면 올릴 수 있어요)'}
        </span>
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
