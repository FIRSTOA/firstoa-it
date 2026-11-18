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
  type ConfirmBlock,
  type ConfirmDoc,
  type ConfirmUnit,
} from '@/lib/confirmSheet';
import type { PrintGrid } from '@/lib/confirmSheetServer';
import { shortDateLabel } from '@/lib/shipmentPrep';
import ConfirmSheetDocument from './ConfirmSheetDocument';

export type EditorTarget = { key: string } | { opened: OpenedConfirm };

const ASSET_RE = /^[A-Z]{1,2}\d{4,5}$/;
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

/** 완료 보고 기기를 품목 묶음에 나눠 넣기(제조사·[납품사양]도 채움) */
function applyUnits(doc: ConfirmDoc, units: ConfirmUnit[]): ConfirmDoc {
  const alloc = allocateUnits(doc.blocks, units);
  return padBlocks({
    ...doc,
    blocks: doc.blocks.map((b, i) => {
      if (!alloc[i].length) return b;
      const brands = [...new Set(alloc[i].map((u) => u.brand).filter(Boolean))];
      return {
        ...b,
        units: alloc[i],
        manufacturer: b.manufacturer || brands.join('/'),
        deliverySpec: deliverySpecFromUnits(alloc[i]) || b.deliverySpec,
      };
    }),
  });
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
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [printGrid, setPrintGrid] = useState<PrintGrid | null>(null);
  const [printing, setPrinting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const looked = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!target) return;
    setOpened(null);
    setDoc(null);
    setError('');
    setInfo({});
    setSpecTouched({});
    setSerialOptions({});
    looked.current = {};
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
        // 확인서가 비어 있고 같은 건 완료 보고에 기기가 있으면 자동으로 채움
        if (!hasAssets(d) && r.linkedUnits.length) {
          d = applyUnits(d, r.linkedUnits);
          setInfo({ [-1]: `출고 준비 완료 보고의 ${r.linkedUnits.length}대로 채웠어요 — 확인하고 저장하세요.` });
        }
        setDoc(d);
      })
      .finally(() => setLoading(false));
  }, [target]);

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
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        blocks: d.blocks.map((blk, i) => {
          if (i !== bi) return blk;
          const units = blk.units.map((u, k) =>
            k === ui
              ? { ...u, assetId: id, serial, spec: found.spec, brand: found.brand, model: found.model, gubun: found.gubun, category: found.category }
              : u,
          );
          return {
            ...blk,
            units,
            manufacturer: blk.manufacturer || found.brand || '',
            deliverySpec: specTouched[bi] ? blk.deliverySpec : deliverySpecFromUnits(units) || blk.deliverySpec,
          };
        }),
      };
    });
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
      setBlock(bi, {
        units: [...units, ...Array.from({ length: Math.max(0, b.quantity - units.length) }, blankUnit)],
        manufacturer: b.manufacturer || brands.join('/'),
        deliverySpec: specTouched[bi] ? b.deliverySpec : deliverySpecFromUnits(units) || b.deliverySpec,
      });
      setInfo((s) => ({ ...s, [bi]: `요청사항의 자산번호 ${ids.length}개를 넣었어요.` }));
    } finally {
      setBusy('');
    }
  }

  function fillFromPrep() {
    if (!doc || !opened?.linkedUnits.length) return;
    if (hasAssets(doc) && !confirm('지금 적힌 자산번호를 완료 보고 기기로 바꿀까요?')) return;
    looked.current = {};
    setDoc(applyUnits({ ...doc, blocks: doc.blocks.map((b) => ({ ...b, units: [] })) }, opened.linkedUnits));
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
        <div className="modal" style={{ width: 980, maxWidth: '96vw' }}>
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
              {(info[-1] || busy) && (
                <div style={{ fontSize: 12.5, color: 'var(--indigo-600)', marginBottom: 8 }}>{busy || info[-1]}</div>
              )}

              <div style={{ maxHeight: '62vh', overflowY: 'auto', paddingRight: 4 }}>
                {doc.blocks.length === 0 && <div className="sub">요청 품목이 없는 확인서예요.</div>}
                {doc.blocks.map((b, bi) => {
                  const reqIds = (`${b.request}\n${b.requestHardware}`.toUpperCase().match(/\b[A-Z]{1,2}\d{4,5}\b/g) ?? []).length;
                  return (
                    <div key={b.row} style={{ border: '1px solid var(--ink-200)', borderRadius: 10, marginBottom: 10, display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr' }}>
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
                        {b.request && (
                          <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--ink-700, #334155)' }}>
                            <b>요청</b> {b.request}
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
                          <input className="inline-cell-input" style={{ width: 140 }} value={b.manufacturer} onChange={(e) => setBlock(bi, { manufacturer: e.target.value })} />
                        </div>
                        <table style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th style={{ width: 28 }}>#</th>
                              <th style={{ width: 110 }}>자산번호</th>
                              <th>S/N</th>
                              <th>사양</th>
                              <th style={{ width: 30 }} />
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
                                    <input className="inline-cell-input" value={u.spec ?? ''} onChange={(e) => setUnit(bi, ui, { spec: e.target.value })} />
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="icon-btn danger"
                                      title="줄 삭제"
                                      onClick={() => {
                                        looked.current = {};
                                        setBlock(bi, { units: b.units.filter((_, k) => k !== ui) });
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
                                  setBlock(bi, { deliverySpec: deliverySpecFromUnits(b.units) });
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
              <ConfirmSheetDocument doc={doc} grid={printGrid} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
