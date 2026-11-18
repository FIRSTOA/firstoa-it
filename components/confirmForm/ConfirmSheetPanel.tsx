'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  confirmFromOcr,
  listConfirmDocs,
  parsePastedConfirm,
  type ConfirmListItem,
} from '@/app/confirmForm/sheetActions';
import PasteDropZone from '@/components/PasteDropZone';
import { parseTsv } from '@/lib/confirmSheet';
import { resizeImageFile } from '@/lib/imageResize';
import { scanWithdrawalFormImage } from '@/lib/ocrClient';
import { shortDateLabel } from '@/lib/shipmentPrep';
import ConfirmSheetEditor, { type EditorTarget } from './ConfirmSheetEditor';

function todayKst(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 확인서 출고 기재 — 영업이 만든 확인서(확인서리스트 시트 탭)에 우리가 준비한 장비의
 * 자산번호·시리얼·[납품사양]을 적는 화면. 시트 탭 목록에서 고르거나, 확인서를 붙여넣어 불러와요.
 */
export default function ConfirmSheetPanel({ onToast }: { onToast: (msg: string) => void }) {
  const [items, setItems] = useState<ConfirmListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [appReady, setAppReady] = useState(true);
  const [sheetUrl, setSheetUrl] = useState('');
  const [range, setRange] = useState<'recent' | 'all'>('recent');
  const [itOnly, setItOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [reading, setReading] = useState('');

  function load() {
    setLoading(true);
    listConfirmDocs()
      .then((r) => {
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError('');
        setItems(r.items);
        setAppReady(r.appReady);
        setSheetUrl(r.sheetUrl);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const visible = useMemo(() => {
    const from = todayKst(-7);
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (itOnly && !it.isIt) return false;
      if (range === 'recent' && it.deliveryDate && it.deliveryDate < from) return false;
      if (s && !`${it.company} ${it.title} ${it.items} ${it.tab}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, itOnly, range, search]);

  async function readPastedText() {
    const grid = parseTsv(pasteText);
    if (!grid.length) {
      onToast('붙여넣은 내용이 없어요.');
      return;
    }
    setReading('확인서 읽는 중…');
    try {
      const r = await parsePastedConfirm(grid);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      if (r.key) {
        onToast(`시트에 같은 확인서(${r.key.slice(4)})가 있어서 그 탭으로 열었어요.`);
        setTarget({ key: r.key });
      } else if (r.opened) setTarget({ opened: r.opened });
      setPasteText('');
    } finally {
      setReading('');
    }
  }

  async function readImage(file: File) {
    setReading('사진에서 확인서 읽는 중…');
    try {
      const { base64, mediaType } = await resizeImageFile(file);
      const scanned = await scanWithdrawalFormImage(base64, mediaType);
      if (!scanned.ok) {
        onToast(scanned.error);
        return;
      }
      const r = await confirmFromOcr(scanned.fields);
      if (r.ok) setTarget({ opened: r.opened });
      else onToast(r.error);
    } catch (err) {
      onToast(err instanceof Error ? err.message : '사진을 읽지 못했어요.');
    } finally {
      setReading('');
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>확인서 출고 기재</h2>
        <span className="sub">
          영업이 준 확인서에 우리가 준비한 장비의 자산번호·S/N·[납품사양]을 적어요. 저장하면 시트의 출고시(기재사항) 칸에
          들어가고, 같은 건 출고 준비 완료 보고와 서로 채워져요.
        </span>
      </div>
      {!appReady && (
        <div style={{ fontSize: 12.5, color: '#b45309', background: '#fffbeb', padding: '6px 10px', borderRadius: 8, marginBottom: 8 }}>
          앱 저장용 표가 아직 없어요 — Supabase SQL Editor에서 <b>supabase/confirm_docs_schema.sql</b>을 한 번 실행해 주세요. (시트 기재는 지금도 돼요)
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button type="button" className={`chip${range === 'recent' ? ' active' : ''}`} onClick={() => setRange('recent')}>
          최근(7일 전부터)
        </button>
        <button type="button" className={`chip${range === 'all' ? ' active' : ''}`} onClick={() => setRange('all')}>
          전체
        </button>
        <button type="button" className={`chip${itOnly ? ' active' : ''}`} onClick={() => setItOnly((v) => !v)}>
          💻 IT만
        </button>
        <input
          className="search-input"
          placeholder="상호·품목·제목 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 200, padding: '6px 10px', border: '1px solid var(--ink-200)', borderRadius: 8 }}
        />
        <button type="button" className="chip" onClick={load} disabled={loading}>
          {loading ? '불러오는 중…' : '🔄 새로고침'}
        </button>
        <button type="button" className={`chip${pasteOpen ? ' active' : ''}`} onClick={() => setPasteOpen((v) => !v)}>
          📋 붙여넣기로 불러오기
        </button>
        {sheetUrl && (
          <a className="chip" href={sheetUrl} target="_blank" rel="noreferrer">
            확인서리스트 시트 열기 ↗
          </a>
        )}
      </div>

      {pasteOpen && (
        <div style={{ border: '1px solid var(--ink-200)', borderRadius: 10, padding: 10, marginBottom: 10, display: 'grid', gap: 8 }}>
          <div className="form-field full">
            <label>시트에서 확인서 전체(A열~H열)를 복사해서 붙여넣기 — 같은 확인서 탭이 있으면 그 탭으로 열려요</label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              placeholder="제목 / 구분 / 발주일 … 작성시(요청사항) … 출고시(기재사항) 칸까지 통째로 복사"
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid var(--ink-200)', borderRadius: 8 }}
            />
            <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', marginTop: 6 }} disabled={!!reading} onClick={readPastedText}>
              표에서 읽기
            </button>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>또는 확인서 사진(캡처)</div>
            <PasteDropZone onFiles={(f) => readImage(f[0])} disabled={!!reading} status={reading || undefined} />
          </div>
        </div>
      )}

      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>납품일</th>
              <th>상호</th>
              <th>요청 품목</th>
              <th style={{ whiteSpace: 'nowrap' }}>출고 기재</th>
              <th style={{ whiteSpace: 'nowrap' }}>출고 준비</th>
              <th style={{ whiteSpace: 'nowrap' }}>저장</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => {
              const done = it.total > 0 && it.filled >= it.total;
              return (
                <tr key={it.key} style={{ cursor: 'pointer' }} onClick={() => setTarget({ key: it.key })}>
                  <td style={{ whiteSpace: 'nowrap' }}>{it.deliveryDate ? shortDateLabel(it.deliveryDate) : '-'}</td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{it.company || '-'}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{it.tab ? `탭 ${it.tab}` : '붙여넣기'}{it.formNo ? ` · 순번 ${it.formNo}` : ''}</div>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{it.items || '-'}</td>
                  <td>
                    <span
                      style={{
                        fontWeight: 700,
                        color: done ? '#15803d' : it.filled ? '#b45309' : 'var(--ink-500)',
                      }}
                    >
                      {done ? '✅ ' : ''}
                      {it.filled}/{it.total}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {it.link ? (
                      <>
                        🔗 {shortDateLabel(it.link.date)} · 보고 {it.link.unitCount}대{it.link.sentAt ? ' · 카톡✅' : ''}
                      </>
                    ) : (
                      <span style={{ color: 'var(--ink-500)' }}>-</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>
                    {it.sheetWrittenAt ? '시트 기재됨' : it.savedAt ? '앱 저장' : '-'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ whiteSpace: 'nowrap' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTarget({ key: it.key });
                      }}
                    >
                      열기
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-state">
                  <div>📄</div>
                  {range === 'recent' ? '최근 확인서가 없어요. "전체"를 눌러 보세요.' : '확인서가 없어요.'}
                </td>
              </tr>
            )}
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--ink-500)', padding: 16 }}>
                  확인서리스트 시트를 읽는 중…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmSheetEditor target={target} onClose={() => setTarget(null)} onSaved={load} onToast={onToast} />
    </div>
  );
}
