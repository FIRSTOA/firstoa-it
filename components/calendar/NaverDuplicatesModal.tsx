'use client';

import { useState } from 'react';
import {
  cleanupNaverDuplicates,
  previewNaverDuplicates,
  type DupEventInfo,
  type DupItem,
  type DupNaverInfo,
  type DupResult,
  type DupSelection,
} from '@/app/calendar/duplicateActions';

/**
 * 🧹 복제본 정리 — 예전 버그로 네이버에 생긴 it-<앱 id> 복제본을 찾아(읽기만) 보여 주고,
 * 사람이 체크한 것만 정리. 서버가 건마다 다시 확인(app/calendar/duplicateActions.ts).
 */

type Props = { open: boolean; onClose: () => void; onDone: () => void };

const PLAN_STEPS: Record<string, string> = {
  deleteY: '① 앱에 다시 생긴 중복 줄(기록 없음) 지우기 → ② 이 앱 줄을 원본에 다시 연결 → ③ 복제본 동기화 기록 정리 → ④ 네이버 복제본 지우기',
  keepY: '② 이 앱 줄(기록 없음) 지우고 기록 있는 원본 쪽 줄을 남김 → ③ 복제본 동기화 기록 정리 → ④ 네이버 복제본 지우기',
  relink: '② 이 앱 줄을 원본에 다시 연결 → ③ 복제본 동기화 기록 정리 → ④ 네이버 복제본 지우기',
  copyOnly: '③ 복제본 동기화 기록 정리 → ④ 네이버 복제본 지우기(앱 줄은 이미 원본에 연결됨)',
};

function recordText(e: DupEventInfo): string {
  const r = e.records;
  const parts = [
    r.prepChecks && '출고 준비 체크',
    r.report && `완료 보고(사진 ${r.photos}장${r.reportSent ? ', 카톡 보냄' : ''})`,
    r.receiving > 0 && `입고 연결 ${r.receiving}`,
    r.confirmDocs > 0 && `확인서 연결 ${r.confirmDocs}`,
  ].filter(Boolean);
  return parts.length ? `기록: ${parts.join(' · ')}` : '기록 없음';
}

const when = (n: { date: string; time: string }) => `${n.date} ${n.time || '종일'}`;
const naverLine = (n: DupNaverInfo) => `${when(n)} · ${n.completed ? '완료' : '진행중'} · ${n.title}`;

export default function NaverDuplicatesModal({ open, onClose, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DupItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DupResult[] | null>(null);

  if (!open) return null;

  async function find() {
    setLoading(true);
    setError('');
    setResults(null);
    setSelected(new Set());
    try {
      const res = await previewNaverDuplicates();
      if (!res.ok) {
        setError(res.error);
        setItems(null);
        return;
      }
      setItems(res.items);
      setTruncated(res.truncated);
    } catch (err) {
      setError(`복제본을 찾지 못했어요(${err instanceof Error ? err.message : String(err)})`);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    const chosen = (items ?? []).filter((i) => selected.has(i.xId) && i.plan && i.original && !i.blocked);
    if (!chosen.length) return;
    const copies = chosen.filter((i) => i.copyExists).length;
    const ask = [
      `체크한 ${chosen.length}건을 정리할까요?`,
      `네이버에서 앱이 예전에 잘못 만든 복제본 ${copies}개를 지워요. 네이버 원본은 그대로예요.`,
      '건마다 그 사이 바뀐 게 없는지 다시 확인하고, 바뀌었으면 그 건만 건너뛰어요.',
    ].join('\n');
    if (!confirm(ask)) return;
    const selections: DupSelection[] = chosen.map((i) => ({
      xId: i.xId,
      calendarId: i.calendarId,
      plan: i.plan as DupSelection['plan'],
      copyHref: i.copyHref,
      copyExists: i.copyExists,
      copyEtag: i.copyEtag,
      originalUid: i.original?.uid ?? '',
      originalHref: i.original?.href ?? '',
      yId: i.y?.id ?? null,
    }));
    setRunning(true);
    setError('');
    try {
      const res = await cleanupNaverDuplicates(selections);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.results);
      setSelected(new Set());
      onDone();
    } catch (err) {
      setError(`정리하다 오류가 났어요(${err instanceof Error ? err.message : String(err)}) — [🔍 복제본 찾기]로 다시 확인해 주세요.`);
    } finally {
      setRunning(false);
    }
  }

  const actionable = (items ?? []).filter((i) => i.plan && !i.blocked);
  const titleOf = (id: string) => (items ?? []).find((i) => i.xId === id)?.x.title ?? id;

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !running && !loading && onClose()}>
      <div className="modal" style={{ width: 760, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2>🧹 네이버 복제본 정리</h2>
        <div className="sub" style={{ lineHeight: 1.55 }}>
          예전에는 네이버에서 만든 일정을 앱에서 고치거나 완료 체크하면 네이버에 같은 일정이 하나 더(복제본) 생기고, 앱에도 두 줄로 보일 수
          있었어요. 여기서 그 복제본을 찾아 정리해요. <b>찾기는 읽기만 해요.</b> 정리는 체크한 것만, 네이버 원본은 그대로 두고 앱이 만든 복제본만
          지워요.
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={find} disabled={loading || running}>
            {loading ? '찾는 중…' : '🔍 복제본 찾기'}
          </button>
          {items && actionable.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={run} disabled={running || loading || selected.size === 0}>
              {running ? '정리 중…' : `선택한 ${selected.size}건 정리`}
            </button>
          )}
        </div>

        {error && <div className="setup-alert" style={{ marginTop: 10 }}>{error}</div>}

        {results && (
          <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--ink-200)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.55 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              정리 결과 — 성공 {results.filter((r) => r.ok).length}건 · 건너뜀/남음 {results.filter((r) => !r.ok).length}건
            </div>
            {results.map((r) => (
              <div key={r.xId} style={{ color: r.ok ? '#166534' : '#b45309' }}>
                {r.ok ? '✅' : '⚠️'} {titleOf(r.xId)} — {r.message}
              </div>
            ))}
            <div style={{ color: 'var(--ink-500)', marginTop: 4 }}>남은 게 있으면 [🔍 복제본 찾기]를 다시 눌러 확인해 주세요.</div>
          </div>
        )}

        {items && !results && (
          <div style={{ marginTop: 12, fontSize: 12.5 }}>
            {items.length === 0 ? (
              <div className="empty-state" style={{ padding: '18px 0' }}>
                <div>✨</div>정리할 복제본이 없어요.
              </div>
            ) : (
              <div style={{ marginBottom: 8, fontWeight: 700 }}>
                복제본 {items.length}건 · 정리할 수 있는 것 {actionable.length}건
                {truncated && <span style={{ color: '#b45309', fontWeight: 400 }}> (많아서 앞 30건만 — 정리한 뒤 다시 찾기)</span>}
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              {items.map((i) => {
                const can = !!i.plan && !i.blocked;
                return (
                  <label
                    key={i.xId}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      padding: '10px 12px',
                      border: `1px solid ${can ? 'var(--ink-200)' : '#fdba74'}`,
                      background: can ? '#fff' : '#fff7ed',
                      borderRadius: 8,
                      lineHeight: 1.55,
                      cursor: can ? 'pointer' : 'default',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={!can || running}
                      checked={selected.has(i.xId)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i.xId);
                          else next.delete(i.xId);
                          return next;
                        })
                      }
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>
                        {when(i.x)} · {i.x.title}
                      </div>
                      <div style={{ color: 'var(--ink-500)' }}>캘린더: {i.calendarName || i.calendarId || '-'}</div>
                      <div>
                        📱 앱 줄: {i.x.status} · {recordText(i.x)}
                      </div>
                      <div style={{ color: '#b91c1c' }}>
                        🗑 네이버 복제본(지울 것): {i.copy ? naverLine(i.copy) : '네이버에 없음(이미 지워짐) — 동기화 기록만 정리'}
                      </div>
                      <div style={{ color: '#166534' }}>
                        ✅ 네이버 원본(그대로 둠): {i.original ? naverLine(i.original) : '못 찾음'}
                      </div>
                      {i.y && (
                        <div>
                          📱 원본에서 다시 생긴 앱 줄: {i.y.status} · {i.y.title} · {recordText(i.y)}
                          {i.plan === 'deleteY' && ' → 이 줄은 지워요'}
                          {i.plan === 'keepY' && ' → 이 줄을 남기고 위 앱 줄을 지워요'}
                        </div>
                      )}
                      {i.plan && !i.blocked && <div style={{ color: 'var(--ink-500)' }}>할 일: {PLAN_STEPS[i.plan]}</div>}
                      {i.notes.map((n) => (
                        <div key={n} style={{ color: 'var(--ink-500)' }}>
                          · {n}
                        </div>
                      ))}
                      {i.blocked && <div style={{ color: '#b45309', fontWeight: 700 }}>⚠️ {i.blocked}</div>}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={running || loading}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
