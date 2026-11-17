'use client';

import { useEffect, useRef, useState } from 'react';
import type { PrepEventRow } from '@/app/shipment-prep/actions';
import {
  addPhotoItem,
  deletePhotoItem,
  deletePrepPhotos,
  getPrepReport,
  lookupUnitByAsset,
  ocrPrepPhoto,
  savePrepReport,
  sendPrepReport,
  uploadPrepPhoto,
} from '@/app/shipment-prep/reportActions';
import { resizeImageFile } from '@/lib/imageResize';
import { countUnits, KAKAO_ROOM, shortDateLabel, type PrepPhoto, type PrepUnit } from '@/lib/shipmentPrep';

type Props = { event: PrepEventRow; people: string[]; onClose: () => void };

const blankUnit = (): PrepUnit => ({ serial: '', assetId: '', grade: '' });

export default function PrepReportModal({ event, people, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [company, setCompany] = useState(event.company);
  const [model, setModel] = useState(event.items.join(', '));
  const [author, setAuthor] = useState('');
  const [units, setUnits] = useState<PrepUnit[]>([]);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PrepPhoto[]>([]);
  const [photoItems, setPhotoItems] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [newItem, setNewItem] = useState('');
  const [editItems, setEditItems] = useState(false);
  const [uploading, setUploading] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<PrepPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [serialChoices, setSerialChoices] = useState<Record<number, string[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const touchedSerial = useRef<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      const res = await getPrepReport(event.id);
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhotoItems(res.photoItems);
      const r = res.report;
      const doneBy = Object.entries(event.prepChecks).find(([, e]) => e?.completed_at && !e.handed_off)?.[0] ?? '';
      if (r) {
        setCompany(r.company || event.company);
        setModel(r.model || event.items.join(', '));
        setAuthor(r.author || doneBy);
        setUnits(r.units.length ? r.units : Array.from({ length: countUnits(event.items) }, blankUnit));
        setNote(r.note);
        setPhotos(r.photos);
        setChecked(r.checkedItems);
        setSentAt(r.sentAt);
      } else {
        setAuthor(doneBy);
        setUnits(Array.from({ length: countUnits(event.items) }, blankUnit));
      }
    })();
  }, [event]);

  const draft = () => ({ company, model, author, units, checkedItems: checked, note });

  function setUnit(i: number, patch: Partial<PrepUnit>) {
    setUnits((prev) => prev.map((u, k) => (k === i ? { ...u, ...patch } : u)));
  }

  const lookedUp = useRef<Record<number, string>>({});
  async function onAssetBlur(i: number, value?: string) {
    const id = (value ?? units[i]?.assetId ?? '').trim().toUpperCase();
    if (!id || lookedUp.current[i] === id) return;
    lookedUp.current[i] = id;
    setInfo(`${id} 조회 중…`);
    const found = await lookupUnitByAsset(id);
    if (!found.source) {
      setInfo(`${id}: IT재고·임대리스트에서 못 찾았어요 — 직접 입력해주세요.`);
      return;
    }
    // 빈 칸만 채움 — 직접 친 값은 덮어쓰지 않음
    setUnits((prev) =>
      prev.map((u, k) =>
        k === i
          ? {
              ...u,
              serial: !u.serial.trim() && !touchedSerial.current.has(i) && found.serials.length === 1 ? found.serials[0] : u.serial,
              model: u.model?.trim() ? u.model : found.model,
              gubun: u.gubun?.trim() ? u.gubun : found.gubun,
              spec: u.spec?.trim() ? u.spec : found.spec,
              category: found.category || u.category,
            }
          : u,
      ),
    );
    if (found.serials.length > 1) setSerialChoices((prev) => ({ ...prev, [i]: found.serials }));
    setInfo(`${id}: ${found.source === 'inventory' ? 'IT재고' : '임대리스트'}에서 불러왔어요.`);
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const list = Array.from(files);
    for (let n = 0; n < list.length; n++) {
      setUploading(`사진 올리는 중… ${n + 1}/${list.length}`);
      try {
        const { base64, mediaType } = await resizeImageFile(list[n], 1600, 0.85);
        const [up, ocr] = await Promise.all([uploadPrepPhoto(event.id, base64, mediaType), ocrPrepPhoto(base64, mediaType)]);
        if (!up.ok) {
          setError(up.error);
          continue;
        }
        setPhotos((prev) => [...prev, up.photo]);
        // OCR — 빈 시리얼·자산번호 칸만 채움(직접 친 값은 덮어쓰지 않음)
        if (ocr.ok && (ocr.serial || ocr.assetId)) {
          setUnits((prev) => {
            const next = [...prev];
            const already = next.some(
              (u) => (ocr.serial && u.serial === ocr.serial) || (ocr.assetId && u.assetId === ocr.assetId),
            );
            if (already) return next;
            const idx = next.findIndex((u) => !u.serial.trim() && !u.assetId.trim());
            const target = idx >= 0 ? idx : next.findIndex((u) => (!u.serial.trim() && !!ocr.serial) || (!u.assetId.trim() && !!ocr.assetId));
            if (target < 0) return next;
            next[target] = {
              ...next[target],
              serial: next[target].serial || ocr.serial,
              assetId: next[target].assetId || ocr.assetId,
            };
            return next;
          });
          setInfo(`사진에서 읽음: ${[ocr.serial && `시리얼 ${ocr.serial}`, ocr.assetId && `자산번호 ${ocr.assetId}`].filter(Boolean).join(' · ')}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    setUploading('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function removePhotos(paths: string[]) {
    if (!paths.length || !confirm(`사진 ${paths.length}장을 삭제할까요?`)) return;
    const res = await deletePrepPhotos(event.id, paths);
    if (res.ok) {
      setPhotos(res.photos);
      setSelected(new Set());
    } else setError(res.error);
  }

  async function saveDraft() {
    setBusy(true);
    const res = await savePrepReport(event.id, draft());
    setBusy(false);
    if (res.ok) setInfo('임시 저장했어요.');
    else setError(res.error);
  }

  async function send() {
    if (!author.trim()) {
      setError('작성자를 골라주세요.');
      return;
    }
    if (!confirm(`"${KAKAO_ROOM}" 카톡방으로 보고를 보낼까요?${event.kind !== '철수' ? '\n(자산번호가 있는 기기는 IT재고 위치가 임대중으로 바뀌어요)' : ''}`)) return;
    setBusy(true);
    setError('');
    const res = await sendPrepReport(event.id, draft(), photoItems.length);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSentAt(new Date().toISOString());
    setInfo(
      `카톡 발송 요청 완료 — "${KAKAO_ROOM}" 방으로 곧 보내져요.` +
        (res.stockWarnings.length ? `\n⚠️ 재고: ${res.stockWarnings.join(' / ')}` : ''),
    );
  }

  async function addItem() {
    const r = await addPhotoItem(newItem);
    if (!r.ok) return setError(r.error);
    setPhotoItems((p) => (p.includes(newItem.trim()) ? p : [...p, newItem.trim()]));
    setNewItem('');
  }
  async function removeItem(label: string) {
    if (!confirm(`체크리스트에서 "${label}" 항목을 뺄까요? (모든 보고에 적용)`)) return;
    const r = await deletePhotoItem(label);
    if (!r.ok) return setError(r.error);
    setPhotoItems((p) => p.filter((x) => x !== label));
    setChecked((c) => c.filter((x) => x !== label));
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !busy && !uploading && onClose()}>
      <div className="modal" style={{ width: 760, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2>📷 완료 보고</h2>
        <div className="sub">
          {shortDateLabel(event.date)} {event.kind} · {event.title}
        </div>
        {loading ? (
          <div className="empty-state">불러오는 중…</div>
        ) : (
          <>
            <div className="form-grid">
              <div className="form-field">
                <label>업체명</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="form-field">
                <label>작성자</label>
                <select value={author} onChange={(e) => setAuthor(e.target.value)}>
                  <option value="">선택</option>
                  {[...new Set([author, ...people].filter(Boolean))].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field full">
                <label>모델명</label>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="예: 15Z90S-GP7YK 2대" />
              </div>
            </div>

            <div className="detail-section-title">
              기기 {units.length}대
              <button type="button" className="chip" style={{ marginLeft: 8 }} onClick={() => setUnits([...units, blankUnit()])}>
                + 줄 추가
              </button>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {units.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 8, borderBottom: '1px dashed var(--ink-100)' }}>
                  <span style={{ width: 22, color: 'var(--ink-400)' }}>{i + 1})</span>
                  <input
                    style={{ flex: '1 1 110px', minWidth: 0 }}
                    placeholder="자산번호"
                    value={u.assetId}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      setUnit(i, { assetId: v });
                      if (/^[A-Z]\d{4}$/.test(v)) void onAssetBlur(i, v);
                    }}
                    onBlur={() => onAssetBlur(i)}
                    onKeyDown={(e) => e.key === 'Enter' && onAssetBlur(i)}
                  />
                  <input
                    style={{ flex: '2 1 160px', minWidth: 0 }}
                    placeholder="시리얼"
                    value={u.serial}
                    onChange={(e) => {
                      touchedSerial.current.add(i);
                      setUnit(i, { serial: e.target.value });
                    }}
                    list={serialChoices[i] ? `serials-${i}` : undefined}
                  />
                  {serialChoices[i] && (
                    <datalist id={`serials-${i}`}>
                      {serialChoices[i].map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                  <button type="button" className="icon-btn danger" onClick={() => setUnits(units.filter((_, k) => k !== i))} title="줄 삭제">
                    ×
                  </button>
                  <div style={{ width: '100%', display: 'flex', gap: 6, paddingLeft: 28, flexWrap: 'wrap' }}>
                    <input style={{ flex: '2 1 160px', minWidth: 0 }} placeholder="모델명" value={u.model ?? ''} onChange={(e) => setUnit(i, { model: e.target.value })} />
                    <input style={{ flex: '1 1 100px', minWidth: 0 }} placeholder="구분(예: I5고사노)" value={u.gubun ?? ''} onChange={(e) => setUnit(i, { gubun: e.target.value })} />
                    <input style={{ flex: '3 1 200px', minWidth: 0 }} placeholder="사양(예: I7/12/16/512/X/4050)" value={u.spec ?? ''} onChange={(e) => setUnit(i, { spec: e.target.value })} />
                  </div>
                  {serialChoices[i] && !u.serial && (
                    <div style={{ width: '100%', fontSize: 11.5, color: 'var(--ink-400)', paddingLeft: 28 }}>
                      시리얼 후보 {serialChoices[i].length}개 — 시리얼 칸을 눌러 골라주세요.
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="detail-section-title">
              사진 {photos.length}장
              <button type="button" className="btn btn-primary" style={{ marginLeft: 8 }} disabled={!!uploading} onClick={() => fileRef.current?.click()}>
                {uploading || '📷 사진 올리기'}
              </button>
              {selected.size > 0 && (
                <button type="button" className="btn btn-ghost" style={{ marginLeft: 6 }} onClick={() => removePhotos([...selected])}>
                  선택 {selected.size}장 삭제
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
              {photos.map((p, i) => (
                <div key={p.path} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={`사진 ${i + 1}`}
                    onClick={() => setZoom(p)}
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', border: selected.has(p.path) ? '3px solid var(--indigo-600)' : '1px solid var(--ink-200)' }}
                  />
                  <span style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 11, padding: '0 5px', borderRadius: 4 }}>{i + 1}</span>
                  <input
                    type="checkbox"
                    checked={selected.has(p.path)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(p.path);
                      else next.delete(p.path);
                      setSelected(next);
                    }}
                    style={{ position: 'absolute', top: 4, right: 26 }}
                  />
                  <button
                    type="button"
                    onClick={() => removePhotos([p.path])}
                    style={{ position: 'absolute', top: 2, right: 2, border: 'none', background: 'rgba(220,38,38,.9)', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="detail-section-title">
              사진 체크 {checked.filter((c) => photoItems.includes(c)).length}/{photoItems.length}
              <button type="button" className="chip" style={{ marginLeft: 8 }} onClick={() => setEditItems(!editItems)}>
                {editItems ? '편집 끝' : '항목 편집'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {photoItems.map((label) => {
                const on = checked.includes(label);
                return (
                  <span key={label} style={{ display: 'inline-flex', gap: 2 }}>
                    <button
                      type="button"
                      className={`chip${on ? ' active' : ''}`}
                      onClick={() => setChecked(on ? checked.filter((c) => c !== label) : [...checked, label])}
                    >
                      {on ? '✓ ' : ''}
                      {label}
                    </button>
                    {editItems && (
                      <button type="button" className="icon-btn danger" onClick={() => removeItem(label)} title="항목 삭제">
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            {editItems && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="새 체크 항목 (예: 바이오스 비밀번호 해제)" style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={addItem} disabled={!newItem.trim()}>
                  + 항목 추가
                </button>
              </div>
            )}

            <div className="form-field full" style={{ marginTop: 10 }}>
              <label>비고</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </>
        )}

        {info && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, color: '#166534', marginTop: 8 }}>{info}</div>}
        {error && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, color: 'var(--red-600)', marginTop: 8 }}>{error}</div>}

        <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy || !!uploading}>
            닫기
          </button>
          <button type="button" className="btn btn-ghost" onClick={saveDraft} disabled={busy || loading}>
            임시 저장
          </button>
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy || loading || !!uploading}>
            {busy ? '처리 중…' : sentAt ? '🔁 다시 보내기' : '✅ 완료 · 카톡 발송'}
          </button>
        </div>
      </div>

      {zoom && (
        <div className="modal-overlay open" style={{ zIndex: 1000 }} onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.url} alt="크게 보기" style={{ maxWidth: '94vw', maxHeight: '92vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
