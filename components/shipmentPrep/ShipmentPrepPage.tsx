'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listPrepEvents,
  listPrepPeople,
  setPrepStage,
  type PrepEventRow,
  type PrepPerson,
  type TitleTagResult,
} from '@/app/shipment-prep/actions';
import { applyPrepStage, isPrepDone, isPrepInProgress, isPrepOverhaul, shortDateLabel, type PrepStage } from '@/lib/shipmentPrep';

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return (await res.json()) as T;
}
const requestTitleTag = (eventId: string) => postJson<TitleTagResult>('/api/shipment-prep/title-tag', { eventId }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
import PrepPeopleModal from './PrepPeopleModal';
import PrepReportModal from './PrepReportModal';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nextBusinessDayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  do dt.setDate(dt.getDate() + 1);
  while (dt.getDay() === 0 || dt.getDay() === 6);
  return ymd(dt);
}
function fmtDuration(s?: string | null, e?: string | null): string {
  if (!s || !e) return '';
  const min = Math.max(1, Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000));
  if (!Number.isFinite(min) || min <= 0) return '';
  return min < 60 ? `${min}분` : `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}`;
}

const KIND_STYLE: Record<string, { bg: string; fg: string }> = {
  납품: { bg: '#dbeafe', fg: '#1e40af' },
  교체: { bg: '#ede9fe', fg: '#6d28d9' },
  철수: { bg: '#ffedd5', fg: '#c2410c' },
};

type Banner = { state: 'busy' | 'ok' | 'error'; eventId: string; text: string } | null;

export default function ShipmentPrepPage() {
  const [events, setEvents] = useState<PrepEventRow[]>([]);
  const [people, setPeople] = useState<PrepPerson[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [prepDate, setPrepDate] = useState<string>(() => ymd(new Date())); // 준비하는 날('' = 전체)
  const [showCompleted, setShowCompleted] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [busyKey, setBusyKey] = useState('');
  const [showPeople, setShowPeople] = useState(false);
  const [reportEvent, setReportEvent] = useState<PrepEventRow | null>(null);
  const [detailEvent, setDetailEvent] = useState<PrepEventRow | null>(null);
  const tagSeq = useRef(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const reload = useCallback(async () => {
    const [res, ppl] = await Promise.all([listPrepEvents(), listPrepPeople().catch(() => [])]);
    if (res.ok) {
      setEvents(res.events);
      setError('');
    } else setError(res.error);
    setPeople(ppl);
    setLoading(false);
  }, []);

  // 진입 시 1회 + 60초마다 네이버 동기화 후 재조회
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setSyncing(true);
      await postJson('/api/shipment-prep/sync').catch(() => null);
      if (alive) {
        setSyncing(false);
        await reload();
      }
    };
    void reload();
    void run();
    const t = window.setInterval(() => void run(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [reload]);

  const activePeople = useMemo(() => people.filter((p) => p.isActive).map((p) => p.name), [people]);
  const target = prepDate ? nextBusinessDayOf(prepDate) : null;
  const isPrepared = (r: PrepEventRow) => Object.values(r.prepChecks).some(isPrepDone);

  const scoped = useMemo(() => (target ? events.filter((e) => e.date === target) : events), [events, target]);
  const visible = useMemo(() => (showCompleted ? scoped : scoped.filter((e) => !isPrepared(e))), [scoped, showCompleted]);
  const doneCnt = scoped.filter(isPrepared).length;

  function showTag(eventId: string, tag: TitleTagResult) {
    if (tag.ok) {
      setBanner({
        state: 'ok',
        eventId,
        text: tag.skipped ? `네이버 제목은 그대로예요 (${tag.skipped})` : tag.title ? `네이버 제목 반영: ${tag.title}` : '네이버 제목은 이미 맞게 되어 있어요',
      });
    } else setBanner({ state: 'error', eventId, text: tag.error });
  }

  async function toggle(ev: PrepEventRow, person: string, stage: PrepStage, on: boolean) {
    const key = `${ev.id}|${person}|${stage}`;
    const before = ev.prepChecks;
    // 누르는 즉시 화면에 반영(낙관적) → DB 저장 → 네이버 제목 태그는 따로.
    setEvents((prev) =>
      prev.map((e) => (e.id === ev.id ? { ...e, prepChecks: applyPrepStage(e.prepChecks, person, stage, on, new Date().toISOString()) } : e)),
    );
    setBusyKey(key);
    const res = await setPrepStage(ev.id, person, stage, on);
    setBusyKey('');
    if (!res.ok) {
      setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, prepChecks: before } : e)));
      setBanner({ state: 'error', eventId: ev.id, text: res.error });
      return;
    }
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, prepChecks: res.checks } : e)));
    setBanner({ state: 'busy', eventId: ev.id, text: '네이버 일정 제목 바꾸는 중…' });
    const seq = ++tagSeq.current;
    const tag = await requestTitleTag(ev.id);
    if (seq === tagSeq.current) showTag(ev.id, tag); // 연달아 누르면 마지막 결과만 표시
  }

  async function retryTag(eventId: string) {
    setBanner({ state: 'busy', eventId, text: '네이버 일정 제목 바꾸는 중…' });
    showTag(eventId, await requestTitleTag(eventId));
  }

  function personButtons(ev: PrepEventRow, p: string, big: boolean) {
    const e = ev.prepChecks[p];
    const done = isPrepDone(e);
    const doing = isPrepInProgress(e) || done;
    const oh = isPrepOverhaul(e);
    const btn = (label: string, on: boolean, stage: PrepStage, color: { b: string; bg: string; fg: string }) => (
      <button
        type="button"
        disabled={busyKey === `${ev.id}|${p}|${stage}`}
        onClick={() => toggle(ev, p, stage, !on)}
        style={{
          flex: big ? 1 : undefined,
          padding: big ? '9px 0' : '3px 7px',
          fontSize: big ? 13 : 11.5,
          fontWeight: 700,
          borderRadius: 6,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          border: `1px solid ${on ? color.b : 'var(--ink-200, #cbd5e1)'}`,
          background: on ? color.bg : '#fff',
          color: on ? color.fg : 'var(--ink-500, #64748b)',
        }}
      >
        {on ? '● ' : ''}
        {label}
      </button>
    );
    return (
      <>
        {btn('오버홀', oh, 'overhaul', { b: '#7c3aed', bg: '#f5f3ff', fg: '#6d28d9' })}
        {btn('준비중', doing, 'start', { b: '#f59e0b', bg: '#fffbeb', fg: '#b45309' })}
        {btn(done ? `완료${fmtDuration(e?.started_at, e?.completed_at) ? ' ' + fmtDuration(e?.started_at, e?.completed_at) : ''}` : '완료', done, 'complete', {
          b: '#16a34a',
          bg: '#f0fdf4',
          fg: '#166534',
        })}
      </>
    );
  }

  function reportButton(ev: PrepEventRow, full: boolean) {
    return (
      <button
        type="button"
        className={ev.reportSent ? 'btn btn-ghost' : 'btn btn-primary'}
        style={{ width: full ? '100%' : undefined, whiteSpace: 'nowrap', fontSize: full ? 14 : 12 }}
        onClick={() => setReportEvent(ev)}
      >
        {ev.reportSent ? `✅ 카톡 발송됨 · 사진 ${ev.photoCount}장` : ev.photoCount ? `📷 완료 보고 (미발송) · 사진 ${ev.photoCount}장` : `📷 완료 보고`}
      </button>
    );
  }

  const kindBadge = (k: string) => {
    const s = KIND_STYLE[k] ?? KIND_STYLE['납품'];
    return (
      <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>
        {k}
      </span>
    );
  };

  return (
    <div>
      {banner && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            marginBottom: 10,
            padding: '9px 12px',
            borderRadius: 8,
            fontSize: 13,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            background: banner.state === 'error' ? '#fef2f2' : banner.state === 'ok' ? '#f0fdf4' : '#eff6ff',
            border: `1px solid ${banner.state === 'error' ? '#fecaca' : banner.state === 'ok' ? '#bbf7d0' : '#bfdbfe'}`,
            color: banner.state === 'error' ? '#991b1b' : banner.state === 'ok' ? '#166534' : '#1e40af',
          }}
        >
          <span style={{ flex: 1, wordBreak: 'break-all' }}>{banner.text}</span>
          {banner.state === 'error' && (
            <button type="button" className="btn btn-ghost" onClick={() => retryTag(banner.eventId)}>
              다시 시도
            </button>
          )}
          {banner.state !== 'busy' && (
            <button type="button" className="icon-btn" onClick={() => setBanner(null)}>
              ×
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          { label: '🚨 잔여 (준비 필요)', v: scoped.length - doneCnt, c: '#dc2626', bg: '#fef2f2' },
          { label: '✅ 준비 완료', v: doneCnt, c: '#16a34a', bg: '#f0fdf4' },
          { label: '전체', v: scoped.length, c: 'var(--ink-700, #334155)', bg: '#fff' },
        ].map((k) => (
          <div key={k.label} className="panel" style={{ flex: '1 1 140px', padding: '10px 14px', background: k.bg, marginBottom: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: k.c }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.c }}>
              {k.v}
              <span style={{ fontSize: 13, marginLeft: 3 }}>건</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>준비하는 날</span>
        <input type="date" value={prepDate} onChange={(e) => setPrepDate(e.target.value)} />
        <button type="button" className={`chip${prepDate === ymd(new Date()) ? ' active' : ''}`} onClick={() => setPrepDate(ymd(new Date()))}>
          오늘
        </button>
        <button type="button" className={`chip${!prepDate ? ' active' : ''}`} onClick={() => setPrepDate('')}>
          전체 일정
        </button>
        {target && <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>→ {shortDateLabel(target)} 출고분</span>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, marginLeft: 'auto' }}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          완료 포함
        </label>
        <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{syncing ? '네이버 동기화 중…' : '60초마다 자동 동기화'}</span>
        <button type="button" className="btn btn-ghost" onClick={() => setShowPeople(true)}>
          👥 담당자 관리
        </button>
      </div>

      {error && <div style={{ color: 'var(--red-600)', marginBottom: 10 }}>{error}</div>}
      {activePeople.length === 0 && !loading && (
        <div className="panel" style={{ marginBottom: 12, fontSize: 13 }}>
          준비 담당자가 아직 없어요 — <b>👥 담당자 관리</b>에서 이름을 추가해주세요.
        </div>
      )}

      {loading ? (
        <div className="empty-state">불러오는 중…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {target ? `${shortDateLabel(target)} 출고 준비할 IT 별표 일정이 없어요.` : '출고 준비할 IT 별표 일정이 없어요.'}
        </div>
      ) : isMobile ? (
        <div className="panel" style={{ padding: 0 }}>
          {visible.map((ev) => (
            <div key={ev.id} style={{ padding: 12, borderTop: '1px solid var(--ink-100)', background: isPrepared(ev) ? '#f0fdf4' : '#fff' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                {kindBadge(ev.kind)}
                <span style={{ flex: 1, fontSize: 15, fontWeight: 700, wordBreak: 'keep-all', color: 'var(--indigo-600)' }} onClick={() => setDetailEvent(ev)}>
                  {ev.company} ›
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>
                  {shortDateLabel(ev.date)} {ev.time || '종일'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 3, wordBreak: 'break-all' }}>{ev.title}</div>
              {ev.items.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>
                  {ev.items.map((it, i) => (
                    <div key={i}>· {it}</div>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                {activePeople.map((p) => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 52, flexShrink: 0, fontSize: 13, fontWeight: 600 }}>{p}</span>
                    {personButtons(ev, p, true)}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>{reportButton(ev, true)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel" style={{ paddingTop: 6 }}>
          <table style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: 92 }} />
              <col style={{ width: 56 }} />
              <col style={{ width: '18%' }} />
              <col />
              <col style={{ width: Math.max(200, 230) }} />
              <col style={{ width: 150 }} />
            </colgroup>
            <thead>
              <tr>
                <th>출고일</th>
                <th>구분</th>
                <th>업체 · 일정</th>
                <th>품목</th>
                <th>준비 담당</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.id} style={{ background: isPrepared(ev) ? '#f0fdf4' : undefined }}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 700 }}>{shortDateLabel(ev.date)}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{ev.time || '종일'}</div>
                  </td>
                  <td>{kindBadge(ev.kind)}</td>
                  <td style={{ wordBreak: 'break-all', cursor: 'pointer' }} onClick={() => setDetailEvent(ev)} title="캘린더 내용 보기">
                    <div style={{ fontWeight: 700, color: 'var(--indigo-600)' }}>{ev.company} ›</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{ev.title}</div>
                  </td>
                  <td style={{ wordBreak: 'break-all', fontSize: 12.5 }}>
                    {ev.items.length ? ev.items.map((it, i) => <div key={i}>· {it}</div>) : <span style={{ color: 'var(--ink-400)' }}>-</span>}
                  </td>
                  <td>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {activePeople.map((p) => (
                        <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 44, flexShrink: 0, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
                          {personButtons(ev, p, false)}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>{reportButton(ev, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PrepPeopleModal
        open={showPeople}
        people={people}
        onClose={() => setShowPeople(false)}
        onSaved={() => {
          setShowPeople(false);
          void reload();
        }}
      />
      {detailEvent && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setDetailEvent(null)}>
          <div className="modal" style={{ width: 640, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2>{detailEvent.company}</h2>
            <div className="sub">
              {shortDateLabel(detailEvent.date)} {detailEvent.time || '종일'} · {detailEvent.kind}
            </div>
            <div className="detail-section-title">일정 제목</div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13.5 }}>{detailEvent.title}</div>
            {detailEvent.location && (
              <>
                <div className="detail-section-title">장소</div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13.5 }}>{detailEvent.location}</div>
              </>
            )}
            <div className="detail-section-title">캘린더 메모</div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13.5, lineHeight: 1.6 }}>
              {detailEvent.description || '메모가 없어요.'}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setDetailEvent(null)}>
                닫기
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setReportEvent(detailEvent);
                  setDetailEvent(null);
                }}
              >
                📷 완료 보고
              </button>
            </div>
          </div>
        </div>
      )}
      {reportEvent && (
        <PrepReportModal
          event={reportEvent}
          people={activePeople}
          onClose={() => {
            setReportEvent(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
