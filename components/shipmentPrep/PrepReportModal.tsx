'use client';

import { useEffect, useRef, useState } from 'react';
import type { PrepEventRow } from '@/app/shipment-prep/actions';
import {
  addPhotoItem,
  deletePhotoItem,
  deletePrepPhotos,
  getPrepReport,
  lookupUnitByAsset,
  savePrepReport,
  sendPrepReport,
  appendPrepPhotos,
  type CheckItem,
} from '@/app/shipment-prep/reportActions';
import PhotoLightbox from '@/components/PhotoLightbox';
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
  const [photoItems, setPhotoItems] = useState<CheckItem[]>([]);
  const [newGrp, setNewGrp] = useState('데스크탑&노트북');
  // 일정 품목에 맞는 묶음만 보여줌(모니터만 나가는 건이면 PC 항목 제외). '기타'는 항상.
  const itemText = `${event.title} ${event.items.join(' ')}`;
  const showPc = /노트북|데스크|PC|사노|사데|설노|설데|맥북|갤럭시북/i.test(itemText);
  const showMon = /모니터/.test(itemText);
  const visibleItems = photoItems.filter(
    (it) =>
      (it.grp === '데스크탑&노트북' && showPc) || (it.grp === '모니터' && showMon) || !['데스크탑&노트북', '모니터'].includes(it.grp),
  );
  const visibleLabels = visibleItems.map((it) => it.label);
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

  const draft = () => ({ company, model, author, units, checkedItems: checked.filter((c) => visibleLabels.includes(c)), note });

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
              serial: !u.serial.trim() && !touchedSerial.current.has(i) && (found.serials.length === 1 || found.source === 'inventory') && found.serials[0]
                    ? found.serials[0] // IT재고 시트 시리얼 우선(구글시트 출고 탭과 같은 값)
                    : u.serial,
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

  // 사진은 저장만(OCR 없음) — 3장씩 동시에 올리고, 목록 저장은 끝에 한 번.
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const list = Array.from(files);
    const added: PrepPhoto[] = [];
    let done = 0;
    setUploading(`사진 올리는 중… 0/${list.length}`);
    const one = async (file: File) => {
      try {
        const { base64, mediaType } = await resizeImageFile(file, 1600, 0.85);
        const res = await fetch('/api/shipment-prep/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: event.id, base64, mediaType }),
        });
        const up = (await res.json()) as { ok: true; photo: PrepPhoto } | { ok: false; error: string };
        if (up.ok) {
          added.push(up.photo);
          setPhotos((prev) => [...prev, up.photo]);
        } else setError(up.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      done++;
      setUploading(`사진 올리는 중… ${done}/${list.length}`);
    };
    for (let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map(one));
    if (added.length) {
      const saved = await appendPrepPhotos(event.id, added);
      if (saved.ok) setPhotos(saved.photos);
      else setError(saved.error);
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

  async function send(mode: 'send' | 'resend' | 'fix') {
    if (!author.trim()) {
      setError('작성자를 골라주세요.');
      return;
    }
    const stockNote = event.kind !== '철수' ? '\n(자산번호가 있는 기기는 IT재고 위치가 임대중으로 바뀌어요)' : '';
    const ask =
      mode === 'fix'
        ? '수정한 내용만 저장할까요? (카톡은 보내지 않아요)'
        : mode === 'resend'
          ? `수정한 내용을 "[수정]" 표시로 "${KAKAO_ROOM}" 카톡방에 다시 보낼까요?`
          : `"${KAKAO_ROOM}" 카톡방으로 보고를 보낼까요?`;
    if (!confirm(ask + stockNote)) return;
    setBusy(true);
    setError('');
    const res = await sendPrepReport(event.id, draft(), visibleItems.length, mode);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (mode !== 'fix') setSentAt(new Date().toISOString());
    setInfo(
      (mode === 'fix' ? '수정 내용을 저장했어요(카톡은 안 보냈어요).' : `카톡 발송 요청 완료 — "${KAKAO_ROOM}" 방으로 곧 보내져요.`) +
        (res.stockWarnings.length ? `\n⚠️ 재고: ${res.stockWarnings.join(' / ')}` : ''),
    );
  }

  async function addItem() {
    const label = newItem.trim();
    const r = await addPhotoItem(label, newGrp);
    if (!r.ok) return setError(r.error);
    setPhotoItems((p) => (p.some((x) => x.label === label) ? p : [...p, { label, grp: newGrp }]));
    setNewItem('');
  }
  async function removeItem(label: string) {
    if (!confirm(`체크리스트에서 "${label}" 항목을 뺄까요? (모든 보고에 적용)`)) return;
    const r = await deletePhotoItem(label);
    if (!r.ok) return setError(r.error);
    setPhotoItems((p) => p.filter((x) => x.label !== label));
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
              출고 체크리스트 {checked.filter((c) => visibleLabels.includes(c)).length}/{visibleItems.length}
              <button type="button" className="chip" style={{ marginLeft: 8 }} onClick={() => setEditItems(!editItems)}>
                {editItems ? '편집 끝' : '항목 편집'}
              </button>
            </div>
            {[...new Set(['데스크탑&노트북', '모니터', '기타', ...visibleItems.map((x) => x.grp)])].map((grp) => {
              const items = visibleItems.filter((x) => x.grp === grp);
              if (!items.length) return null;
              const done = items.filter((x) => checked.includes(x.label)).length;
              return (
                <div key={grp} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, margin: '4px 0 6px' }}>
                    {grp}
                    <span style={{ color: 'var(--ink-400)', fontWeight: 500 }}>
                      {done}/{items.length}
                    </span>
                    <button
                      type="button"
                      className="chip"
                      onClick={() =>
                        setChecked(
                          done === items.length
                            ? checked.filter((c) => !items.some((x) => x.label === c))
                            : [...new Set([...checked, ...items.map((x) => x.label)])],
                        )
                      }
                    >
                      {done === items.length ? '모두 해제' : '모두 체크'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {items.map(({ label }) => {
                      const on = checked.includes(label);
                      return (
                        <label
                          key={label}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                            padding: '5px 8px',
                            borderRadius: 6,
                            background: on ? '#f0fdf4' : 'var(--ink-50, #f8fafc)',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setChecked(on ? checked.filter((c) => c !== label) : [...checked, label])}
                          />
                          <span style={{ flex: 1 }}>{label}</span>
                          {editItems && (
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={(e) => {
                                e.preventDefault();
                                removeItem(label);
                              }}
                              title="항목 삭제"
                            >
                              ×
                            </button>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {editItems && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <select value={newGrp} onChange={(e) => setNewGrp(e.target.value)}>
                  <option>데스크탑&노트북</option>
                  <option>모니터</option>
                  <option>기타</option>
                </select>
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="새 체크 항목 (예: 바이오스 비밀번호 해제)"
                  style={{ flex: 1, minWidth: 180 }}
                />
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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => send('fix')}
            disabled={busy || loading || !!uploading || !sentAt}
            title={sentAt ? '' : '발송한 뒤에 쓸 수 있어요'}
          >
            ✏️ 고치기만(카톡 안 보냄)
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => send('resend')}
            disabled={busy || loading || !!uploading || !sentAt}
            title={sentAt ? '' : '발송한 뒤에 쓸 수 있어요'}
          >
            🔁 수정해서 다시 보내기
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => send('send')}
            disabled={busy || loading || !!uploading || !!sentAt}
            title={sentAt ? '이미 발송했어요 — 수정해서 다시 보내기를 써주세요' : ''}
          >
            {busy ? '처리 중…' : sentAt ? '✅ 발송 완료' : '✅ 완료 · 카톡 발송'}
          </button>
        </div>
      </div>

      {zoom && (
        <PhotoLightbox
          photos={photos.map((p) => ({ url: p.url }))}
          startIndex={Math.max(0, photos.findIndex((p) => p.path === zoom.path))}
          title={company}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}
