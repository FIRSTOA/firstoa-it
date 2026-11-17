'use client';

import { useEffect, useRef, useState } from 'react';
import { lookupKnownAsset, searchRentalAssets } from '@/app/actions';
import type { RentalAssetHit } from '@/lib/rentals/spec';
import { normalizeWonInput } from '@/lib/currency';
import { RECEIVING_KINDS, type ReceivingEntry, type ReceivingInput } from '@/lib/receiving';
import { CATEGORIES, SPECS } from '@/lib/types';

const BLANK: ReceivingInput = {
  kind: '구매입고예정',
  status: '입고대기',
  category: CATEGORIES[0],
  brand: '',
  model: '',
  cpu: '',
  spec: '',
  ram: '',
  storage: '',
  screen: '',
  vendor: '',
  purchasePrice: '',
  purchaseUrl: '',
  expectedDate: '',
  manager: '',
  notes: '',
  assetId: '',
  serialNumber: '',
  location: '',
  quantity: 1,
};

type KnownAssetLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; source: 'inventory' | 'rental' }
  | { status: 'not-found' };

type Props = {
  open: boolean;
  editing: ReceivingEntry | null;
  pending: boolean;
  locations: string[];
  onClose: () => void;
  onSave: (entry: ReceivingInput, quantity: number) => void;
};

export default function ReceivingModal({ open, editing, pending, locations, onClose, onSave }: Props) {
  const [form, setForm] = useState<ReceivingInput>(BLANK);
  const [quantity, setQuantity] = useState(1);
  const [knownLookup, setKnownLookup] = useState<KnownAssetLookupState>({ status: 'idle' });

  useEffect(() => {
    if (open) {
      setForm(editing ?? BLANK);
      setQuantity(editing?.quantity ?? 1);
      setKnownLookup({ status: 'idle' });
    }
  }, [open, editing]);

  const set = <K extends keyof ReceivingInput>(key: K, value: ReceivingInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // 자산번호를 입력하고 다른 칸으로 넘어가면 기존 데이터(IT재고 구글시트 → 임대리스트 순서로
  // 조회, app/actions.ts의 lookupKnownAsset)에서 사양을 자동으로 채워줍니다 — 렌탈입고예정뿐
  // 아니라 구매입고예정도 귀환자산(예: 렌탈 나갔다가 돌아오는 건)이면 도움이 되므로 유형
  // 상관없이 조회합니다. 이미 사람이 입력한 값은 덮어쓰지 않고 빈 칸만 채웁니다.
  async function handleAssetIdBlur() {
    if (editing) return;
    const assetId = form.assetId.trim();
    if (!assetId) {
      setKnownLookup({ status: 'idle' });
      return;
    }
    setKnownLookup({ status: 'loading' });
    const result = await lookupKnownAsset(assetId);
    if (!result.found) {
      setKnownLookup({ status: 'not-found' });
      return;
    }
    setForm((prev) => ({
      ...prev,
      category: result.category || prev.category,
      brand: prev.brand || result.brand,
      model: prev.model || result.model,
      cpu: prev.cpu || result.cpu,
      spec: prev.spec || result.spec,
      ram: prev.ram || result.ram,
      storage: prev.storage || result.storage,
      screen: prev.screen || result.screen,
      serialNumber: prev.serialNumber || result.serialNo,
    }));
    setKnownLookup({ status: 'found', source: result.source });
  }

  const isRental = form.kind === '렌탈입고예정';
  const isRepair = form.kind === '수리입고예정';
  // 렌탈/수리는 둘 다 "이미 있는 자산번호" 기준이라 자산번호가 필수고, 수량 필드도 의미가
  // 없습니다(항상 1건).
  const requiresAssetId = isRental || isRepair;

  // 렌탈/수리입고예정 — 임대리스트(firstoa-works)에 있는 장비라 자산번호/시리얼로 검색해서 고름.
  const [hits, setHits] = useState<RentalAssetHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!open || editing || !requiresAssetId) return;
    const q = form.assetId.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await searchRentalAssets(q);
      if (seq !== searchSeq.current) return;
      setHits(res);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [form.assetId, open, editing, requiresAssetId]);

  async function selectHit(hit: RentalAssetHit) {
    setShowHits(false);
    setHits([]);
    searchSeq.current++;
    const spec = hit.options.filter(Boolean).join(' / ');
    const where = [hit.vendorName, hit.siteName].filter(Boolean).join(' · ');
    const memo = `임대리스트: ${where}${hit.status ? ` (${hit.status})` : ''}${spec ? ` · 사양 ${spec}` : ''}`;
    setForm((prev) => ({
      ...prev,
      assetId: hit.assetId,
      category: hit.category || prev.category,
      brand: hit.manufacturer || prev.brand,
      model: hit.model || prev.model,
      cpu: hit.cpu || prev.cpu,
      ram: hit.ram || prev.ram,
      storage: hit.storage || prev.storage,
      serialNumber: hit.serialNo || prev.serialNumber,
      notes: prev.notes ? prev.notes : memo,
    }));
    // IT재고 시트에도 있는 자산이면 그쪽 사양(사양분류·화면크기 등)으로 빈 칸을 더 채웁니다.
    setKnownLookup({ status: 'loading' });
    const known = await lookupKnownAsset(hit.assetId);
    if (known.found && known.source === 'inventory') {
      setForm((prev) => ({
        ...prev,
        category: known.category || prev.category,
        brand: prev.brand || known.brand,
        model: prev.model || known.model,
        cpu: prev.cpu || known.cpu,
        spec: prev.spec || known.spec,
        ram: prev.ram || known.ram,
        storage: prev.storage || known.storage,
        screen: prev.screen || known.screen,
        serialNumber: prev.serialNumber || known.serialNo,
      }));
      setKnownLookup({ status: 'found', source: 'inventory' });
    } else {
      setKnownLookup({ status: 'found', source: 'rental' });
    }
  }
  // 기타주변기기는 소모성 재고라 랜선/어댑터 같은 걸 낱개 자산으로 안 쪼갬 — 수량 필드가
  // "행을 몇 개 만들지"가 아니라 "이 한 행의 재고 수량"을 뜻하게 됨(app/receiving/actions.ts).
  const isConsumable = form.category === '기타주변기기';
  const showQuantityField = isConsumable || (!editing && !requiresAssetId);

  function handleSave() {
    onSave(
      {
        ...form,
        brand: form.brand.trim(),
        model: form.model.trim(),
        cpu: form.cpu.trim(),
        ram: form.ram.trim(),
        storage: form.storage.trim(),
        screen: form.screen.trim(),
        vendor: form.vendor.trim(),
        purchasePrice: form.purchasePrice.trim(),
        manager: form.manager.trim(),
        notes: form.notes.trim(),
        assetId: form.assetId.trim(),
        serialNumber: form.serialNumber.trim(),
        location: form.location.trim(),
        quantity: isConsumable ? quantity : 1,
      },
      quantity,
    );
  }

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="modal" style={{ width: '600px' }}>
        <h2>{editing ? '입고 건 수정' : '입고 등록'}</h2>
        <div className="sub">
          {requiresAssetId
            ? '임대리스트에 있는 장비예요 — 자산번호나 시리얼을 입력해 검색하면 정보가 자동으로 채워져요.'
            : '구매입고예정·렌탈입고예정·수리입고예정 건을 등록해요.'}
        </div>
        <div className="form-grid">
          <div className="form-field">
            <label>
              유형 <span className="required">*</span>
            </label>
            <select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              {RECEIVING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>
              품목 <span className="required">*</span>
            </label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field" style={{ position: 'relative' }}>
            <label>
              자산번호{requiresAssetId && <span className="required"> *</span>}
            </label>
            <input
              value={form.assetId}
              onChange={(e) => {
                set('assetId', e.target.value.toUpperCase());
                setShowHits(true);
              }}
              onFocus={() => setShowHits(true)}
              onBlur={() => {
                setShowHits(false);
                handleAssetIdBlur();
              }}
              placeholder={requiresAssetId ? '자산번호 또는 시리얼로 검색 (임대리스트)' : '예: P2400'}
              autoComplete="off"
            />
            {requiresAssetId && !editing && showHits && form.assetId.trim().length >= 2 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  background: 'var(--surface, #fff)',
                  border: '1px solid var(--line, #ddd)',
                  borderRadius: '8px',
                  boxShadow: '0 6px 18px rgba(0,0,0,.12)',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  minWidth: '420px',
                }}
              >
                {searching && hits.length === 0 && (
                  <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--ink-400)' }}>임대리스트 검색 중…</div>
                )}
                {!searching && hits.length === 0 && (
                  <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--ink-400)' }}>
                    임대리스트에 일치하는 자산이 없어요.
                  </div>
                )}
                {hits.map((h) => (
                  <div
                    key={h.assetId}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectHit(h);
                    }}
                    style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid var(--line, #eee)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--ink-50, #f5f5f7)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>
                      {h.assetId}{' '}
                      <span style={{ fontWeight: 400, color: 'var(--ink-500)' }}>
                        {[h.manufacturer, h.model].filter(Boolean).join(' ')} · S/N {h.serialNo || '-'}
                      </span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--ink-400)' }}>
                      {[h.vendorName, h.siteName].filter(Boolean).join(' · ') || '-'} · {h.status || '-'}
                      {h.contractDate && ` · 계약 ${h.contractDate}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!editing && knownLookup.status !== 'idle' && (
              <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>
                {knownLookup.status === 'loading' && '기존 데이터 조회 중…'}
                {knownLookup.status === 'not-found' && '기존 데이터를 못 찾았어요 — 직접 입력해주세요.'}
                {knownLookup.status === 'found' &&
                  (knownLookup.source === 'inventory'
                    ? 'IT재고에 이미 있는 자산이에요 — 빈 칸을 자동으로 채웠어요.'
                    : '임대리스트에서 모델명/시리얼을 채웠어요.')}
              </div>
            )}
          </div>
          <div className="form-field">
            <label>브랜드</label>
            <input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="예: HP" />
          </div>
          <div className="form-field">
            <label>모델명{!isRental && <span className="required"> *</span>}</label>
            <input
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="예: EliteBook 840 G7"
            />
          </div>
          <div className="form-field">
            <label>CPU종류</label>
            <input value={form.cpu} onChange={(e) => set('cpu', e.target.value)} placeholder="예: i7-1165G7" />
          </div>
          <div className="form-field">
            <label>사양분류</label>
            <select value={form.spec} onChange={(e) => set('spec', e.target.value)}>
              <option value="">(미정)</option>
              {SPECS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>RAM(GB)</label>
            <input value={form.ram} onChange={(e) => set('ram', e.target.value)} placeholder="예: 16" />
          </div>
          <div className="form-field">
            <label>저장용량(GB)</label>
            <input value={form.storage} onChange={(e) => set('storage', e.target.value)} placeholder="예: 256" />
          </div>
          <div className="form-field">
            <label>화면크기</label>
            <input value={form.screen} onChange={(e) => set('screen', e.target.value)} placeholder="예: 15.6인치" />
          </div>
          <div className="form-field">
            <label>시리얼번호</label>
            <input value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
          </div>

          {!isRental && (
            <div className="form-field">
              <label>발주처</label>
              <input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="예: 다온디지털" />
            </div>
          )}
          <div className="form-field">
            <label>매입가</label>
            <input
              value={form.purchasePrice}
              onChange={(e) => set('purchasePrice', e.target.value)}
              onBlur={() => setForm((prev) => ({ ...prev, purchasePrice: normalizeWonInput(prev.purchasePrice) }))}
              placeholder="예: 154만원 (자동으로 1,540,000원으로 정리돼요)"
            />
          </div>
          <div className="form-field">
            <label>구매URL</label>
            <input
              type="url"
              value={form.purchaseUrl}
              onChange={(e) => set('purchaseUrl', e.target.value)}
              placeholder="예: 쿠팡 등 온라인 구매 링크"
            />
          </div>
          <div className="form-field">
            <label>예상입고일</label>
            <input type="date" value={form.expectedDate} onChange={(e) => set('expectedDate', e.target.value)} />
          </div>
          <div className="form-field">
            <label>담당자</label>
            <input value={form.manager} onChange={(e) => set('manager', e.target.value)} />
          </div>
          <div className="form-field">
            <label>위치</label>
            <select value={form.location} onChange={(e) => set('location', e.target.value)}>
              <option value="">위치 선택 (입고완료 처리 시 필요)</option>
              {form.location && !locations.includes(form.location) && (
                <option value={form.location}>{form.location}</option>
              )}
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
          {showQuantityField && (
            <div className="form-field">
              <label>수량</label>
              <input
                type="number"
                min={1}
                max={isConsumable ? 999999 : 50}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              />
              <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>
                {isConsumable
                  ? '소모성 재고라 행을 늘리지 않고 이 한 행의 재고 수량으로 관리돼요.'
                  : `같은 내용으로 ${quantity}건을 한 번에 등록해요.`}
              </div>
            </div>
          )}
          <div className="form-field full">
            <label>비고</label>
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={pending}>
            {pending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
