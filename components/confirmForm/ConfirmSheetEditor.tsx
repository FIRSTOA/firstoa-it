'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  enrichConfirmUnits,
  getConfirmPrintGrid,
  openConfirmDoc,
  saveConfirmDoc,
  type OpenedConfirm,
} from '@/app/confirmForm/sheetActions';
import { lookupUnitByAsset } from '@/app/shipment-prep/reportActions';
import {
  allocateUnits,
  deliverySpecFromUnits,
  needsAttachment,
  requestModelsFromUnits,
  type CellMode,
  type ConfirmBlock,
  type ConfirmDoc,
  type ConfirmUnit,
} from '@/lib/confirmSheet';
import type { PrintGrid } from '@/lib/confirmSheetServer';
import { shortDateLabel } from '@/lib/shipmentPrep';
import ConfirmAttachment from './ConfirmAttachment';
import ConfirmSheetDocument, { type PrintLayout } from './ConfirmSheetDocument';

export type EditorTarget = { key: string } | { opened: OpenedConfirm };

const ASSET_RE = /^[A-Z]{1,2}\d{4,5}$/;
const LAYOUT_KEY = 'confirm-print-layout';

function savedLayout(): PrintLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'sheet' ? 'sheet' : 'table';
  } catch {
    return 'table';
  }
}
const blankUnit = (): ConfirmUnit => ({ assetId: '', serial: '' });

/** 열 때 품목 수량만큼 빈 줄을 맞춰 둠 */
function padBlocks(doc: ConfirmDoc): ConfirmDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      const n = Math.max(b.quantity, b.units.length, 1);
      return { ...b, units: [...b.units, ...Array.from({ length: n - b.units.length }, blankUnit)] };
    }),
  };
}

function hasAssets(doc: ConfirmDoc) {
  return doc.blocks.some((b) => b.units.some((u) => u.assetId.trim()));
}

/** 완료 보고 기기를 품목 묶음에 나눠 넣기(제조사·[납품사양]·요청사항 모델명도 채움) */
function applyUnits(doc: ConfirmDoc, units: ConfirmUnit[], modelAuto: Record<number, boolean>): ConfirmDoc {
  const alloc = allocateUnits(doc.blocks, units);
  return padBlocks({
    ...doc,
    blocks: doc.blocks.map((b, i) => {
      if (!alloc[i].length) return b;
      const brands = [...new Set(alloc[i].map((u) => u.brand).filter(Boolean))];
      const manufacturer = b.manufacturer || brands.join('/');
      return {
        ...b,
        units: alloc[i],
        manufacturer,
        deliverySpec: deliverySpecFromUnits(alloc[i], doc.cellMode) || b.deliverySpec,
        request: modelAuto[i] ? requestModelsFromUnits(alloc[i], manufacturer) : b.request,
      };
    }),
  });
}

/**
 * 요청사항 칸을 모델명으로 자동으로 채울지 — 비어 있거나 이미 모델명만 적혀 있으면 자동,
 * 영업이 다른 내용(예: 자산번호 목록)을 적어 뒀으면 그대로 둠.
 */
function modelAutoOf(doc: ConfirmDoc): Record<number, boolean> {
  return Object.fromEntries(
    doc.blocks.map((b, i) => [i, !b.request.trim() || b.request.trim() === requestModelsFromUnits(b.units, b.manufacturer)]),
  );
}

export default function ConfirmSheetEditor({
  target,
  onClose,
  onSaved,
  onToast,
}: {
  target: EditorTarget | null;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string) => void;
}) {
  const [opened, setOpened] = useState<OpenedConfirm | null>(null);
  const [doc, setDoc] = useState<ConfirmDoc | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<Record<number, string>>({});
  const [serialOptions, setSerialOptions] = useState<Record<string, string[]>>({});
  const [specTouched, setSpecTouched] = useState<Record<number, boolean>>({});
  const [modelAuto, setModelAuto] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [printGrid, setPrintGrid] = useState<PrintGrid | null>(null);
  const [printing, setPrinting] = useState(false);
  /** 별첨(대수별 출고 명세) 같이 인쇄 — null이면 자동(데스크탑이거나 3대 넘는 품목이 있을 때) */
  const [attachPrint, setAttachPrint] = useState<boolean | null>(null);
  /** 인쇄 양식 — 표(대수별 제조사·모델명·자산번호·시리얼·사양) / 시트 그대로 */
  const [printLayout, setPrintLayout] = useState<PrintLayout>('table');
  const printRef = useRef<HTMLDivElement>(null);
  const looked = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!target) return;
    setOpened(null);
    setDoc(null);
    setError('');
    setInfo({});
    setSpecTouched({});
    setModelAuto({});
    setAttachPrint(null);
    setSerialOptions({});
    looked.current = {};
    setPrintLayout(savedLayout());
    const load = async () => {
      if ('opened' in target) return { ok: true as const, ...target.opened };
      return openConfirmDoc(target.key);
    };
    setLoading(true);
    load()
      .then((r) => {
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setOpened(r);
        setAppId(r.appId);
        let d = padBlocks(r.doc);
        const auto = modelAutoOf(d);
        setModelAuto(auto);
        // 이미 자산번호가 있는데 요청사항이 비어 있으면 바로 모델명으로
        d = {
          ...d,
          blocks: d.blocks.map((b, i) => (auto[i] ? { ...b, request: requestModelsFromUnits(b.units, b.manufacturer) } : b)),
        };
        // 확인서가 비어 있고 같은 건 완료 보고에 기기가 있으면 자동으로 채움
        if (!hasAssets(d) && r.linkedUnits.length) {
          d = applyUnits(d, r.linkedUnits, auto);
          setInfo({ [-1]: `출고 준비 완료 보고의 ${r.linkedUnits.length}대로 채웠어요 — 확인하고 저장하세요.` });
        }
        setDoc(d);
        void fillUnitDetails(d);
      })
      .finally(() => setLoading(false));
  }, [target]);

  /**
   * 시트에서만 읽은 기기는 모델명·사양이 없어서 IT재고에서 채움(빈 칸만, S/N은 안 건드림) —
   * 편집 화면 모델명 칸과 표 양식 인쇄에 씀. 요청사항이 그 모델명과 같으면 자동(모델명) 칸으로.
   */
  async function fillUnitDetails(d: ConfirmDoc) {
    const jobs = d.blocks.map(async (b) => {
      const need = b.units.filter((u) => u.assetId.trim() && !(u.model ?? '').trim());
      return need.length ? enrichConfirmUnits(need, `${b.item} ${b.request} ${b.requestHardware}`).catch(() => []) : [];
    });
    const found = (await Promise.all(jobs)).map((us) => new Map(us.map((u) => [u.assetId.trim().toUpperCase(), u])));
    if (!found.some((m) => m.size)) return;
    const fill = (u: ConfirmUnit, m: Map<string, ConfirmUnit> | undefined): ConfirmUnit => {
      const f = m?.get(u.assetId.trim().toUpperCase());
      if (!f) return u;
      return {
        ...u,
        brand: u.brand || f.brand,
        model: u.model || f.model,
        spec: u.spec || f.spec,
        gubun: u.gubun || f.gubun,
        category: u.category || f.category,
      };
    };
    // 연 시점 값으로 판단 — 요청사항이 비었거나 채운 모델명과 같으면 자동(모델명) 칸
    const auto: Record<number, boolean> = {};
    d.blocks.forEach((b, bi) => {
      const models = requestModelsFromUnits(b.units.map((u) => fill(u, found[bi])), b.manufacturer);
      if (models && (!b.request.trim() || b.request.trim() === models)) auto[bi] = true;
    });
    setDoc((cur) => {
      if (!cur || cur.tab !== d.tab) return cur;
      return {
        ...cur,
        blocks: cur.blocks.map((b, bi) => {
          if (!found[bi]?.size) return b;
          const units = b.units.map((u) => fill(u, found[bi]));
          // 그사이 사람이 요청사항을 고쳤으면 그대로
          const untouched = b.request === (d.blocks[bi]?.request ?? '');
          return auto[bi] && untouched ? { ...b, units, request: requestModelsFromUnits(units, b.manufacturer) } : { ...b, units };
        }),
      };
    });
    setModelAuto((a) => ({ ...a, ...auto }));
  }

  function chooseLayout(l: PrintLayout) {
    setPrintLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* 저장 못 해도 이번 인쇄엔 적용 */
    }
  }

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      // 시트 크기 그대로 그린 걸 재서 A4 한 장(여백 8mm)에 들어가게 줄임 — 너무 길면 폭만 맞추고 다음 장으로
      const el = printRef.current;
      if (el) {
        el.style.zoom = '1';
        const { width, height } = el.getBoundingClientRect();
        const mm = 96 / 25.4;
        const fitW = ((210 - 16) * mm) / Math.max(1, width);
        const fitH = ((297 - 16) * mm) / Math.max(1, height);
        const z = Math.min(1.2, fitW, Math.max(fitH, Math.min(fitW, 0.5))) * 0.98;
        el.style.zoom = String(z);
      }
      window.print();
    }, 80);
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  if (!target) return null;

  const link = opened?.link ?? null;

  function setBlock(bi: number, patch: Partial<ConfirmBlock>) {
    setDoc((d) => (d ? { ...d, blocks: d.blocks.map((b, i) => (i === bi ? { ...b, ...patch } : b)) } : d));
  }
  function setUnit(bi: number, ui: number, patch: Partial<ConfirmUnit>) {
    setDoc((d) =>
      d
        ? {
            ...d,
            blocks: d.blocks.map((b, i) =>
              i === bi ? { ...b, units: b.units.map((u, k) => (k === ui ? { ...u, ...patch } : u)) } : b,
            ),
          }
        : d,
    );
  }

  /** 기기 목록·제조사가 바뀌면 [납품사양]·요청사항(모델명)을 다시 만듦(사람이 고친 칸은 그대로) */
  function derived(blk: ConfirmBlock, bi: number, units: ConfirmUnit[], manufacturer = blk.manufacturer): ConfirmBlock {
    return {
      ...blk,
      units,
      manufacturer,
      deliverySpec: specTouched[bi] ? blk.deliverySpec : deliverySpecFromUnits(units, doc?.cellMode) || blk.deliverySpec,
      request: modelAuto[bi] ? requestModelsFromUnits(units, manufacturer) : blk.request,
    };
  }

  /** 확인서 칸 적는 방식 바꾸기 — 사람이 안 고친 [납품사양]은 그 방식대로 다시 만듦 */
  function setCellMode(mode: CellMode) {
    setDoc((d) =>
      d
        ? {
            ...d,
            cellMode: mode,
            blocks: d.blocks.map((b, i) =>
              specTouched[i] ? b : { ...b, deliverySpec: deliverySpecFromUnits(b.units, mode) || b.deliverySpec },
            ),
          }
        : d,
    );
  }
  function updateBlock(bi: number, fn: (b: ConfirmBlock) => ConfirmBlock) {
    setDoc((d) => (d ? { ...d, blocks: d.blocks.map((b, i) => (i === bi ? fn(b) : b)) } : d));
  }

  async function lookup(bi: number, ui: number, raw: string) {
    const id = raw.trim().toUpperCase();
    const key = `${bi}:${ui}`;
    if (!id || looked.current[key] === id || !doc) return;
    looked.current[key] = id;
    const b = doc.blocks[bi];
    const found = await lookupUnitByAsset(id, `${b.item} ${b.request} ${b.requestHardware}`);
    if (!found.source) {
      setInfo((s) => ({ ...s, [bi]: `${id}: IT재고·임대리스트에서 못 찾았어요. 직접 입력해 주세요.` }));
      return;
    }
    const serial = (found.serials[0] ?? '').toUpperCase() === id ? '' : found.serials[0] ?? '';
    setSerialOptions((s) => ({ ...s, [key]: found.serials }));
    updateBlock(bi, (blk) =>
      derived(
        blk,
        bi,
        blk.units.map((u, k) =>
          k === ui
            ? { ...u, assetId: id, serial, spec: found.spec, brand: found.brand, model: found.model, gubun: found.gubun, category: found.category }
            : u,
        ),
        blk.manufacturer || found.brand || '',
      ),
    );
    setInfo((s) => ({
      ...s,
      [bi]:
        `${id}: ${found.source === 'inventory' ? `IT재고(${found.category})` : '임대리스트'}에서 불러왔어요.` +
        (found.duplicates?.length ? ` ⚠️ 같은 자산번호가 ${found.duplicates.join(', ')}에도 있어요.` : ''),
    }));
  }

  async function fillFromRequest(bi: number) {
    if (!doc) return;
    const b = doc.blocks[bi];
    const ids = [...new Set((`${b.request}\n${b.requestHardware}`.toUpperCase().match(/\b[A-Z]{1,2}\d{4,5}\b/g) ?? []))];
    if (!ids.length) return;
    setBusy(`요청사항의 자산번호 ${ids.length}개 불러오는 중…`);
    try {
      const units = await enrichConfirmUnits(ids.map((assetId) => ({ assetId, serial: '' })), `${b.item} ${b.request}`);
      ids.forEach((id, k) => (looked.current[`${bi}:${k}`] = id));
      const brands = [...new Set(units.map((u) => u.brand).filter(Boolean))];
      updateBlock(bi, (blk) =>
        derived(
          blk,
          bi,
          [...units, ...Array.from({ length: Math.max(0, b.quantity - units.length) }, blankUnit)],
          blk.manufacturer || brands.join('/'),
        ),
      );
      setInfo((s) => ({ ...s, [bi]: `요청사항의 자산번호 ${ids.length}개를 넣었어요.` }));
    } finally {
      setBusy('');
    }
  }

  function fillFromPrep() {
    if (!doc || !opened?.linkedUnits.length) return;
    if (hasAssets(doc) && !confirm('지금 적힌 자산번호를 완료 보고 기기로 바꿀까요?')) return;
    looked.current = {};
    setDoc(applyUnits({ ...doc, blocks: doc.blocks.map((b) => ({ ...b, units: [] })) }, opened.linkedUnits, modelAuto));
    setInfo({ [-1]: `출고 준비 완료 보고의 ${opened.linkedUnits.length}대로 채웠어요.` });
  }

  async function save(writeSheet: boolean) {
    if (!doc) return;
    setSaving(true);
    try {
      const r = await saveConfirmDoc(doc, { appId, writeSheet, eventId: link?.eventId ?? null });
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      setAppId(r.appId);
      const parts = [writeSheet && doc.tab ? `시트(${doc.tab})에 기재했어요` : '저장했어요'];
      if (r.pushed) parts.push(`출고 준비 완료 보고에도 ${r.pushed}대 채웠어요`);
      onToast([parts.join(' · '), ...r.warnings].join(' / '));
      onSaved();
      if (writeSheet) onClose();
    } finally {
      setSaving(false);
    }
  }

  async function print() {
    if (!doc) return;
    if (doc.tab) {
      setBusy('인쇄 양식 불러오는 중…');
      const r = await getConfirmPrintGrid(doc.tab);
      setBusy('');
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      setPrintGrid(r.grid);
    } else setPrintGrid(null);
    setPrinting(true);
  }

  return (
    <>
      <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
        <div className="modal" style={{ width: 1140, maxWidth: '96vw' }}>
          {loading || !doc ? (
            <div style={{ padding: 24, color: 'var(--ink-500)' }}>{error || '확인서를 불러오는 중…'}</div>
          ) : (
            <>
              <h2 style={{ margin: '0 0 2px', fontSize: 17 }}>
                📄 {doc.company || '(상호 없음)'}{' '}
                <span style={{ fontSize: 13, color: 'var(--ink-500)', fontWeight: 400 }}>
                  {doc.deliveryDateText || doc.deliveryDate} {doc.formNo && `· 순번 ${doc.formNo}`}{' '}
                  {doc.tab ? `· 시트 탭 "${doc.tab}"` : '· 붙여넣기(앱 전용)'}
                </span>
              </h2>
              {doc.title && <div className="sub" style={{ marginBottom: 6, wordBreak: 'break-all' }}>{doc.title}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 8 }}>
                {link ? (
                  <span className="chip active" style={{ cursor: 'default' }}>
                    🔗 출고 준비 {shortDateLabel(link.date)} · 완료 보고 {link.unitCount}대{link.sentAt ? ' · 카톡 발송됨' : ''}
                  </span>
                ) : (
                  <span className="chip" style={{ cursor: 'default' }}>출고 준비 리스트에 같은 건 없음</span>
                )}
                {!!opened?.linkedUnits.length && (
                  <button type="button" className="chip" onClick={fillFromPrep}>
                    ⬇ 완료 보고 기기 {opened.linkedUnits.length}대 채우기
                  </button>
                )}
                {doc.consumables && <span style={{ color: 'var(--ink-500)' }}>소모품: {doc.consumables}</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12.5, marginBottom: 8 }}>
                <span style={{ fontWeight: 700 }}>확인서 칸</span>
                <button
                  type="button"
                  className={`chip${doc.cellMode !== 'summary' ? ' active' : ''}`}
                  onClick={() => setCellMode('full')}
                  title="자산번호·S/N을 대수만큼 줄바꿈으로 다 적어요"
                >
                  다 넣기
                </button>
                <button
                  type="button"
                  className={`chip${doc.cellMode === 'summary' ? ' active' : ''}`}
                  onClick={() => setCellMode('summary')}
                  title="자산번호는 두 개씩 한 줄, S/N은 '별첨 참조', 사양은 '사양 ×대수' — 대수별 상세는 별첨 장"
                >
                  요약 + 별첨 참조
                </button>
                {printLayout === 'sheet' && needsAttachment(doc) && (
                  <span style={{ color: 'var(--ink-500)' }}>
                    데스크탑이거나 3대 넘는 품목이 있어서 인쇄할 때 <b>별첨(대수별 출고 명세)</b>이 2장째로 붙어요.
                  </span>
                )}
              </div>
              {(info[-1] || busy) && (
                <div style={{ fontSize: 12.5, color: 'var(--indigo-600)', marginBottom: 8 }}>{busy || info[-1]}</div>
              )}

              <div style={{ maxHeight: '62vh', overflowY: 'auto', paddingRight: 4 }}>
                {doc.blocks.length === 0 && <div className="sub">요청 품목이 없는 확인서예요.</div>}
                {doc.blocks.map((b, bi) => {
                  // 왼쪽(작성시)은 연 시점의 시트 값 — 오른쪽에서 요청사항 칸을 고쳐도 영업 원문은 보이게
                  const origRequest = opened?.doc.blocks[bi]?.request ?? b.request;
                  const reqIds = (`${origRequest}\n${b.requestHardware}`.toUpperCase().match(/\b[A-Z]{1,2}\d{4,5}\b/g) ?? []).length;
                  const models = requestModelsFromUnits(b.units, b.manufacturer);
                  return (
                    <div key={b.row} style={{ border: '1px solid var(--ink-200)', borderRadius: 10, marginBottom: 10, display: 'grid', gridTemplateColumns: 'minmax(190px, 0.7fr) 2.6fr' }}>
                      <div style={{ padding: 10, background: 'var(--ink-50, #f8fafc)', borderRight: '1px solid var(--ink-200)', borderRadius: '10px 0 0 10px' }}>
                        <div style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 700 }}>작성시 (요청사항)</div>
                        <div style={{ fontWeight: 700, margin: '4px 0' }}>
                          {b.item || '(품목 없음)'} <span style={{ color: 'var(--indigo-600)' }}>× {b.quantity || b.units.length}</span>
                        </div>
                        {b.requestHardware && (
                          <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 4 }}>
                            <b>하드웨어</b> {b.requestHardware}
                          </div>
                        )}
                        {origRequest && (
                          <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--ink-700, #334155)' }}>
                            <b>요청</b> {origRequest}
                          </div>
                        )}
                        {reqIds > 0 && !b.units.some((u) => u.assetId.trim()) && (
                          <button type="button" className="chip" style={{ marginTop: 6 }} onClick={() => fillFromRequest(bi)}>
                            ⬇ 요청사항의 자산번호 {reqIds}개 넣기
                          </button>
                        )}
                      </div>
                      <div style={{ padding: 10 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 700, flex: 1 }}>출고시 (기재사항)</div>
                          <label style={{ fontSize: 12 }}>제조사</label>
                          <input
                            className="inline-cell-input"
                            style={{ width: 140 }}
                            value={b.manufacturer}
                            onChange={(e) => updateBlock(bi, (blk) => derived(blk, bi, blk.units, e.target.value))}
                          />
                        </div>
                        <table style={{ width: '100%', tableLayout: 'fixed' }}>
                          <thead>
                            <tr>
                              <th style={{ width: 28 }}>#</th>
                              <th style={{ width: 92 }}>자산번호</th>
                              <th style={{ width: '27%' }}>S/N</th>
                              <th>모델명</th>
                              <th style={{ width: '22%' }}>사양</th>
                              <th style={{ width: 36 }} />
                            </tr>
                          </thead>
                          <tbody>
                            {b.units.map((u, ui) => {
                              const key = `${bi}:${ui}`;
                              return (
                                <tr key={ui}>
                                  <td style={{ color: 'var(--ink-500)', fontSize: 12 }}>{ui + 1}</td>
                                  <td>
                                    <input
                                      className="inline-cell-input"
                                      value={u.assetId}
                                      placeholder="X9434"
                                      onChange={(e) => {
                                        const v = e.target.value.toUpperCase();
                                        setUnit(bi, ui, { assetId: v });
                                        if (ASSET_RE.test(v.trim())) lookup(bi, ui, v);
                                      }}
                                      onBlur={(e) => lookup(bi, ui, e.target.value)}
                                      onKeyDown={(e) => e.key === 'Enter' && lookup(bi, ui, (e.target as HTMLInputElement).value)}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      className="inline-cell-input"
                                      value={u.serial}
                                      list={serialOptions[key]?.length ? `sn-${key}` : undefined}
                                      onChange={(e) => setUnit(bi, ui, { serial: e.target.value })}
                                    />
                                    {!!serialOptions[key]?.length && (
                                      <datalist id={`sn-${key}`}>
                                        {serialOptions[key].map((s) => (
                                          <option key={s} value={s} />
                                        ))}
                                      </datalist>
                                    )}
                                  </td>
                                  <td>
                                    <input
                                      className="inline-cell-input"
                                      value={u.model ?? ''}
                                      placeholder="S27HG314EK"
                                      onChange={(e) =>
                                        updateBlock(bi, (blk) =>
                                          derived(blk, bi, blk.units.map((x, k) => (k === ui ? { ...x, model: e.target.value } : x))),
                                        )
                                      }
                                    />
                                  </td>
                                  <td>
                                    <input className="inline-cell-input" value={u.spec ?? ''} onChange={(e) => setUnit(bi, ui, { spec: e.target.value })} />
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="icon-btn danger"
                                      title="줄 삭제"
                                      onClick={() => {
                                        looked.current = {};
                                        updateBlock(bi, (blk) => derived(blk, bi, blk.units.filter((_, k) => k !== ui)));
                                      }}
                                    >
                                      ×
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <button type="button" className="chip" style={{ marginTop: 4 }} onClick={() => setBlock(bi, { units: [...b.units, blankUnit()] })}>
                          ＋ 줄 추가
                        </button>
                        {info[bi] && <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4 }}>{info[bi]}</div>}
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <label style={{ fontSize: 12, fontWeight: 700 }}>요청사항 (모델명)</label>
                            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>확인서 왼쪽 요청사항 칸에 들어가요</span>
                            {!modelAuto[bi] && models && b.request.trim() !== models && (
                              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                                {b.request.trim() && !b.request.includes(models) && (
                                  <button type="button" className="chip" onClick={() => setBlock(bi, { request: `${b.request.trim()}\n${models}` })}>
                                    아래에 모델명 붙이기
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="chip"
                                  onClick={() => {
                                    setModelAuto((s) => ({ ...s, [bi]: true }));
                                    setBlock(bi, { request: models });
                                  }}
                                >
                                  모델명으로 바꾸기
                                </button>
                              </span>
                            )}
                          </div>
                          <textarea
                            rows={Math.min(4, Math.max(1, b.request.split('\n').length))}
                            value={b.request}
                            placeholder="자산번호를 넣으면 모델명이 자동으로 들어가요"
                            onChange={(e) => {
                              setModelAuto((s) => ({ ...s, [bi]: false }));
                              setBlock(bi, { request: e.target.value });
                            }}
                            style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 6, border: '1px solid var(--ink-200)', borderRadius: 6 }}
                          />
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <label style={{ fontSize: 12, fontWeight: 700 }}>[납품사양]</label>
                            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>하드웨어 칸 아래에 들어가요</span>
                            {specTouched[bi] && (
                              <button
                                type="button"
                                className="chip"
                                style={{ marginLeft: 'auto' }}
                                onClick={() => {
                                  setSpecTouched((s) => ({ ...s, [bi]: false }));
                                  setBlock(bi, { deliverySpec: deliverySpecFromUnits(b.units, doc.cellMode) });
                                }}
                              >
                                사양에서 다시 만들기
                              </button>
                            )}
                          </div>
                          <textarea
                            rows={Math.min(4, Math.max(1, b.deliverySpec.split('\n').length))}
                            value={b.deliverySpec}
                            onChange={(e) => {
                              setSpecTouched((s) => ({ ...s, [bi]: true }));
                              setBlock(bi, { deliverySpec: e.target.value });
                            }}
                            style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 6, border: '1px solid var(--ink-200)', borderRadius: 6 }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
                  닫기
                </button>
                <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 4 }} title="인쇄할 때 출고시(기재사항) 부분 모양">
                  인쇄 양식
                  <select
                    value={printLayout}
                    onChange={(e) => chooseLayout(e.target.value as PrintLayout)}
                    style={{ fontSize: 12.5, padding: '3px 4px', border: '1px solid var(--ink-200)', borderRadius: 6 }}
                  >
                    <option value="table">표(모델명·자산번호·시리얼·사양)</option>
                    <option value="sheet">시트 그대로</option>
                  </select>
                </label>
                <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 4, marginRight: 'auto' }}>
                  <input
                    type="checkbox"
                    checked={attachPrint ?? (printLayout === 'sheet' && needsAttachment(doc))}
                    onChange={(e) => setAttachPrint(e.target.checked)}
                  />
                  📎 별첨(출고 명세) 같이 인쇄
                </label>
                <button type="button" className="btn btn-ghost" onClick={print} disabled={saving || !!busy}>
                  🖨 인쇄
                </button>
                {doc.tab && (
                  <button type="button" className="btn btn-ghost" onClick={() => save(false)} disabled={saving}>
                    앱에만 저장
                  </button>
                )}
                <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={saving}>
                  {saving ? '저장 중…' : doc.tab ? '💾 저장 + 시트에 기재' : '💾 저장'}
                </button>
              </div>
            </>
          )}
          {error && !loading && (
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                닫기
              </button>
            </div>
          )}
        </div>
      </div>
      {printing &&
        doc &&
        createPortal(
          // body 바로 아래에 붙여야 인쇄할 때 나머지 화면을 통째로 빼고 여러 장으로도 나뉨
          <div id="print-confirm-sheet-root">
            {/* 여백 0 → 브라우저가 날짜·주소 머리글/바닥글을 안 붙임(여백은 안쪽 padding 8mm로) */}
            <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
            <div ref={printRef} style={{ width: 'max-content' }}>
              <ConfirmSheetDocument doc={doc} grid={printGrid} layout={printLayout} />
            </div>
            {(attachPrint ?? (printLayout === 'sheet' && needsAttachment(doc))) && (
              // 별첨은 새 장에서 — 위 여백은 여기서(@page 여백이 0이라)
              <div style={{ breakBefore: 'page', paddingTop: '8mm' }}>
                <ConfirmAttachment doc={doc} />
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
