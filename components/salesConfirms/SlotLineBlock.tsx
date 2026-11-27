'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ITEM_KIND_LABEL } from '@/lib/salesConfirms/itemKind';
import { hasSpec, specKeys } from '@/lib/salesConfirms/salesForm/confirm';
import { ADDED_LINE_MAX, addedSlotCount } from '@/lib/salesConfirms/slots';
import { lineMakerState } from '@/lib/salesConfirms/specLine';
import { SALES_SPEC_KEYS, type SalesSlot, type SalesSlotLine, type SalesSpecKey } from '@/lib/salesConfirms/types';
import { slotMarks, type AssetUse, type LookupAsset, type SaveUnit } from './detailShared';
import type { LineBulkMode } from './LineBulkDialog';
import { DeviceRow, SoftwareRow, type LicenseProps, type SpecMode } from './SlotTableRows';

/**
 * 영업 확인서 상세의 품목 블록 하나 — 예전 방식 화면(components/confirmForm/ConfirmSheetEditor.tsx 의 품목 블록) 모양(2026-11-27 사용자).
 *   왼쪽 "작성시 (요청사항)": 품목·× 수량·하드웨어(영업 사양)·요청 모델명·설치장소
 *   오른쪽 "출고시 (기재사항)": 제조사 한 칸(품목마다 — 그 품목 모든 줄의 출고 제조사) + 표(SlotTableRows) + `＋ 줄 추가`
 * 데이터·저장 규칙은 예전 카드와 같음(한 줄 = ④ 한 행). 제조사 한 칸은 applyLineValues({ actualMaker }) — 그 품목 모든 줄에.
 */
export interface SlotLineBlockProps {
  line: SalesSlotLine;
  isSwap: boolean;
  disabled: boolean;
  /** `＋ 줄 추가`를 받는 줄인지(slots.addLineAllowed — 서버도 같은 판정) */
  addable: boolean;
  /** 이 줄에 지금 줄을 더하는 중 */
  adding: boolean;
  /** 어느 줄이든 줄을 더하는 중(단추 막음) */
  addBusy: boolean;
  onAddLine: () => void;
  /** 추가한 줄 빼기 */
  onRemoveAdded: (slot: SalesSlot) => void;
  saveUnit: SaveUnit;
  lookupAsset: LookupAsset;
  onRecheck: (slot: SalesSlot) => void;
  /** 품목 한 칸 제조사 → 그 품목 모든 줄(빈 글자 = 모두 지움). 성공이면 true */
  onApplyMaker: (maker: string) => Promise<boolean>;
  onBulk: (mode: LineBulkMode) => void;
  /** 계약관리 SQL 전 — [같은 키를 모든 칸에] 막음 */
  bulkKeyDisabled: boolean;
  checkItems: { label: string }[];
  /** 이 확인서 안에서 두 줄 이상에 적힌 자산번호(대문자) */
  dupAssets: Set<string>;
  assetElsewhere?: Record<string, AssetUse[]>;
  onDirtyChange: (key: string, dirty: boolean) => void;
  license: LicenseProps;
}

export default function SlotLineBlock(p: SlotLineBlockProps) {
  const { line, disabled } = p;
  const item = line.item;
  const kind = line.kind;
  const specMode: SpecMode = kind === 'maintenance' || kind === 'software' ? 'none' : kind === 'device' && hasSpec(item.cat) ? 'keys' : 'text';
  const keys = useMemo(() => (specMode === 'keys' ? (specKeys(item.cat) as SalesSpecKey[]) : []), [specMode, item.cat]);
  const added = addedSlotCount(line);

  // 왼쪽 요청 칸
  const hw = [
    ...SALES_SPEC_KEYS.filter((k) => (item.spec[k] ?? '').trim()).map((k) => `${k} ${(item.spec[k] ?? '').trim()}`),
    ...Object.entries(item.specExtra ?? {}).map(([k, v]) => `${k} ${v}`),
  ].join(' · ');
  const reqModel = [item.maker, item.model].map((v) => (v ?? '').trim()).filter(Boolean).join(' ');

  // 표 칸(종류별)
  const cols =
    kind === 'software'
      ? ['#', '제품명', '설치 PC', '사용자', '라이선스 키', '']
      : kind === 'maintenance'
        ? ['#', '대상 자산번호', 'S/N', '']
        : ['#', '자산번호', 'S/N', '모델명', '사양', ''];
  const variant = kind === 'software' ? 'sw' : kind === 'maintenance' ? 'mt' : 'dev';

  return (
    <div className="sc-blk">
      <div className="sc-blk-req">
        <div className="sc-blk-cap">작성시 (요청사항)</div>
        <div className="sc-blk-item">
          <span className="sc-line-no">{line.itemIndex + 1}</span>
          <b>{item.cat || '기타'}</b>
          {item.qty > 0 && <span className="sc-blk-qty">× {item.qty}</span>}
          {added > 0 && (
            <span className="sc-pill sc-pill-indigo" title="영업 수량보다 더 내보내는 줄 — 종이 뒤 '추가 출고 기기' 장에 나가요">
              ＋추가 {added}
            </span>
          )}
        </div>
        <div className="sc-blk-tags">
          {item.state && <span className="sc-pill sc-pill-gray">{item.state}</span>}
          <span className="sc-pill sc-pill-gray">{ITEM_KIND_LABEL[kind]}</span>
          {p.isSwap && <span className="sc-pill sc-pill-indigo">교체 후 기기</span>}
        </div>
        {hw && (
          <div className="sc-blk-row">
            <b>하드웨어</b> {hw}
          </div>
        )}
        {reqModel && (
          <div className="sc-blk-row">
            <b>요청</b> {reqModel}
          </div>
        )}
        {item.place && (
          <div className="sc-blk-row">
            <b>설치장소·요청</b> {item.place}
          </div>
        )}
        {kind === 'maintenance' && <div className="sc-blk-hint">대마다 대상 기기 자산번호(우리 장비가 아니면 S/N만)</div>}
        {kind === 'software' && <div className="sc-blk-hint">한 줄 = 라이선스 하나(계약관리 대장 좌석 하나)</div>}
      </div>

      <div className="sc-blk-out">
        <div className="sc-blk-out-head">
          <span className="sc-blk-cap">출고시 (기재사항)</span>
          <span className="sc-blk-tools">
            {specMode === 'keys' && line.slots.length > 0 && (
              <button type="button" className="btn btn-ghost sc-btn sc-btn-sm" disabled={disabled} onClick={() => p.onBulk('spec')}>
                사양 한꺼번에
              </button>
            )}
            {kind === 'software' && (
              <>
                <button type="button" className="btn btn-ghost sc-btn sc-btn-sm" disabled={disabled} onClick={() => p.onBulk('software')}>
                  제품명 한꺼번에
                </button>
                <button type="button" className="btn btn-ghost sc-btn sc-btn-sm" disabled={disabled || p.bulkKeyDisabled} onClick={() => p.onBulk('key')}>
                  같은 키를 모든 칸에
                </button>
              </>
            )}
          </span>
          {kind !== 'maintenance' && line.slots.length > 0 && (
            <LineMakerField line={line} disabled={disabled} onApply={p.onApplyMaker} onDirtyChange={p.onDirtyChange} />
          )}
        </div>

        {line.slots.length === 0 ? (
          <div className="detail-empty sc-line-empty">수량이 0이라 기기 칸이 없어요.</div>
        ) : (
          <table className={`m-cards sc-ot sc-ot-${variant}`}>
            <colgroup>
              {variant === 'dev' && (
                <>
                  <col className="sc-ot-w-no" />
                  <col className="sc-ot-w-asset" />
                  <col className="sc-ot-w-sn" />
                  <col />
                  <col className="sc-ot-w-spec" />
                  <col className="sc-ot-w-act" />
                </>
              )}
              {variant === 'mt' && (
                <>
                  <col className="sc-ot-w-no" />
                  <col className="sc-ot-w-half" />
                  <col />
                  <col className="sc-ot-w-act" />
                </>
              )}
              {variant === 'sw' && (
                <>
                  <col className="sc-ot-w-no" />
                  <col className="sc-ot-w-prod" />
                  <col className="sc-ot-w-asset" />
                  <col className="sc-ot-w-user" />
                  <col />
                  <col className="sc-ot-w-act" />
                </>
              )}
            </colgroup>
            <thead>
              <tr>
                {cols.map((c, i) => {
                  // 핸드폰 카드: # = 오른쪽 위 배지, 첫 입력(자산번호·제품명) = 제목, 나머지 입력 = 이름 붙은 한 줄, 단추 = 맨 아래
                  const role = i === 0 ? 'badge' : i === 1 ? 'title' : i === cols.length - 1 ? 'actions' : 'full';
                  return (
                    <th key={i} data-m={role} data-label={c} aria-label={c ? undefined : '줄 단추'}>
                      {c}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {line.slots.map((slot) =>
                kind === 'software' ? (
                  <SoftwareRow
                    key={`${slot.slotKey}-${slot.unitNo}`}
                    line={line}
                    slot={slot}
                    colCount={cols.length}
                    disabled={disabled}
                    saveUnit={p.saveUnit}
                    onRecheck={p.onRecheck}
                    license={p.license}
                    onDirtyChange={p.onDirtyChange}
                  />
                ) : (
                  <DeviceRow
                    key={`${slot.slotKey}-${slot.unitNo}`}
                    line={line}
                    slot={slot}
                    kind={kind}
                    specMode={specMode}
                    specKeys={keys}
                    colCount={cols.length}
                    disabled={disabled}
                    saveUnit={p.saveUnit}
                    lookupAsset={p.lookupAsset}
                    onRecheck={p.onRecheck}
                    onRemove={slot.added && slot.unit ? () => p.onRemoveAdded(slot) : undefined}
                    checkItems={p.checkItems}
                    dupAsset={!!slot.unit && !!slot.unit.assetId.trim() && p.dupAssets.has(slot.unit.assetId.trim().toUpperCase())}
                    assetElsewhere={p.assetElsewhere}
                    onDirtyChange={p.onDirtyChange}
                  />
                ),
              )}
            </tbody>
          </table>
        )}

        {p.addable && (
          <div className="sc-add-line">
            <button
              type="button"
              className="btn btn-ghost sc-btn"
              disabled={disabled || p.addBusy || added >= ADDED_LINE_MAX}
              onClick={p.onAddLine}
            >
              {p.adding ? '줄 추가 중…' : '＋ 줄 추가'}
            </button>
            <span className="sc-muted">영업 수량({item.qty}대)보다 더 내보낼 때 — 종이 뒤 &lsquo;추가 출고 기기&rsquo; 장에 나가요</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 품목 한 칸 '제조사' — 그 품목 모든 줄의 출고 제조사(④ actual_maker)를 한 번에.
 *   줄마다 같으면 그 값, 다르면 비워 두고 "여러 개" — 고치면 모든 줄이 같은 값. 일부 줄만 적혀 있으면 [빈 줄에도].
 *   비워 두면 영업 요청 제조사 그대로(흐린 글씨). 영업 요청과 다르면 노란 칸(줄들의 차이 표시를 모아서).
 */
function LineMakerField({
  line,
  disabled,
  onApply,
  onDirtyChange,
}: {
  line: SalesSlotLine;
  disabled: boolean;
  onApply: (maker: string) => Promise<boolean>;
  onDirtyChange: (key: string, dirty: boolean) => void;
}) {
  const st = lineMakerState(line.slots.map((s) => s.unit));
  const baseVal = st.value;
  const [draft, setDraft] = useState(baseVal);
  const draftRef = useRef(baseVal);
  const baseRef = useRef(baseVal);
  const [busy, setBusy] = useState(false);
  const fieldId = `sc-maker-${line.itemIndex}`;

  // 서버 값이 바뀌면 따라감(내가 고치는 중이면 그대로)
  useEffect(() => {
    if (draftRef.current.trim() === baseRef.current.trim()) {
      draftRef.current = baseVal;
      setDraft(baseVal);
    }
    baseRef.current = baseVal;
  }, [baseVal]);

  const dirty = draft.trim() !== baseVal.trim();
  const dirtyCb = useRef(onDirtyChange);
  dirtyCb.current = onDirtyChange;
  useEffect(() => {
    dirtyCb.current(fieldId, dirty);
  }, [fieldId, dirty]);
  useEffect(() => () => dirtyCb.current(fieldId, false), [fieldId]);

  // 노란 표시 — 줄들의 제조사 차이(확인 전이 하나라도 있으면 need)
  let need = false;
  let ack = false;
  let sales = '';
  for (const s of line.slots) {
    const m = slotMarks(s).maker;
    if (!m) continue;
    sales = m.sales;
    if (m.state === 'need') need = true;
    else ack = true;
  }
  const diffClass = need ? ' sc-diff-need' : ack ? ' sc-diff-ack' : '';
  const title = need || ack ? `요청 ${sales} — ${need ? '영업 요청과 달라요(인쇄할 때 한 번에 확인)' : '확인함'}` : '이 품목 모든 줄의 제조사 — 비워 두면 영업 요청 그대로';

  async function apply(v: string) {
    if (busy) return;
    setBusy(true);
    try {
      // 저장 못 하면(알림은 상세가 띄움) 적은 값은 그대로 남음 — 칸을 다시 나가면 다시 시도
      await onApply(v);
    } finally {
      setBusy(false);
    }
  }
  function commit() {
    const t = draftRef.current.trim();
    if (t === baseRef.current.trim()) return; // 여러 개(값 '')인데 안 적고 나감 → 그대로
    void apply(t);
  }

  const mixed = st.values.length > 1;
  const partial = st.values.length === 1 && st.blank > 0;
  return (
    <span className="sc-blk-maker">
      <label htmlFor={fieldId}>제조사</label>
      <input
        id={fieldId}
        className={`sc-in${diffClass}`}
        value={draft}
        placeholder={mixed ? '여러 개 — 적으면 모든 줄에' : line.item.maker || '제조사'}
        title={mixed ? `줄마다 달라요: ${st.values.join(', ')} — 적으면 모든 줄이 같은 값이 돼요` : title}
        disabled={disabled || busy}
        autoComplete="off"
        onChange={(e) => {
          draftRef.current = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        }}
      />
      {mixed && <span className="sc-blk-maker-note">여러 개: {st.values.join(', ')}</span>}
      {partial && (
        <button
          type="button"
          className="sc-link sc-blk-maker-note"
          disabled={disabled || busy}
          title={`빈 ${st.blank}줄은 종이에 영업 요청 제조사로 나가요 — 눌러서 모든 줄에 '${st.value}'`}
          onClick={() => void apply(st.value)}
        >
          빈 {st.blank}줄에도
        </button>
      )}
      {busy && <span className="sc-save-state saving">저장 중…</span>}
    </span>
  );
}
