'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatDateTabLabel,
  formatKstDateTime,
  stocktakeSummary,
  toKstDateKey,
  type StocktakeSession,
} from '@/lib/stocktake';
import { addStaffNameIfNew } from '@/app/actions';
import { deleteStocktakeSession, startStocktake } from '@/app/stocktake/actions';

const STARTED_BY_KEY = 'firstoa_stocktake_started_by';
const CUSTOM_OPTION = '__custom__';

export default function StocktakeListPage({
  sessions,
  locations,
  staffNames,
}: {
  sessions: StocktakeSession[];
  locations: string[];
  staffNames: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [startedBy, setStartedBy] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [error, setError] = useState('');
  const todayKey = toKstDateKey(new Date().toISOString());
  const [dateFilter, setDateFilter] = useState<string | null>(() =>
    sessions.some((s) => toKstDateKey(s.startedAt) === todayKey) ? todayKey : null,
  );
  const [pending, startTransition] = useTransition();
  const rememberedOnOpen = useRef(false);

  const dateTabs = useMemo(() => {
    const keys = Array.from(new Set(sessions.map((s) => toKstDateKey(s.startedAt))));
    return keys.sort((a, b) => b.localeCompare(a));
  }, [sessions]);

  // 오늘 이미 "완료"된 위치는 새 조사 시작 드롭다운에서 빼서, 끝난 곳을 또 찾아 헤매지
  // 않게 합니다(같은 위치를 또 조사하고 싶으면 목록에서 그 세션을 열어 계속 쓰면 됨).
  const completedTodayLocations = useMemo(
    () =>
      new Set(
        sessions.filter((s) => s.status === '완료' && toKstDateKey(s.startedAt) === todayKey).map((s) => s.location),
      ),
    [sessions, todayKey],
  );
  const availableLocations = useMemo(
    () => locations.filter((loc) => !completedTodayLocations.has(loc)),
    [locations, completedTodayLocations],
  );

  const visibleSessions = dateFilter ? sessions.filter((s) => toKstDateKey(s.startedAt) === dateFilter) : sessions;

  // 선택된 날짜(기본: 오늘) 조사 세션들을 통틀어서 아직 "미확인"인 자산을 한눈에 모아 보여줍니다.
  // 완료된 세션/진행중인 세션 둘 다 포함 — "오늘 돌아본 곳 중 아직 못 찾은 게 뭐지?"에 바로 답하는 용도.
  const missingItems = useMemo(
    () =>
      visibleSessions.flatMap((s) =>
        s.results
          .filter((r) => r.status === '미확인')
          .map((r) => ({ ...r, sessionId: s.id, location: s.location })),
      ),
    [visibleSessions],
  );

  function openModal() {
    if (!rememberedOnOpen.current) {
      rememberedOnOpen.current = true;
      try {
        const saved = localStorage.getItem(STARTED_BY_KEY);
        if (saved) {
          setStartedBy(saved);
          // 저장된 이름이 공용 목록에 아직 없으면(다른 기기에서 막 추가했거나 동기화 전)
          // 드롭다운에 안 보일 수 있어서 직접입력 모드로 보여줍니다.
          if (!staffNames.includes(saved)) setCustomMode(true);
        }
      } catch {
        // 프라이빗 모드 등으로 localStorage를 못 쓰면 그냥 빈 칸으로 둡니다.
      }
    }
    setOpen(true);
  }

  function handleStart() {
    if (!location.trim()) {
      setError('위치를 선택해주세요.');
      return;
    }
    setError('');
    startTransition(async () => {
      const result = await startStocktake(location, startedBy);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const trimmedName = startedBy.trim();
      try {
        localStorage.setItem(STARTED_BY_KEY, trimmedName);
      } catch {
        // 무시 — 다음에 또 직접 입력하면 됨
      }
      // 드롭다운에 없던 새 이름이면 공용 목록에 추가해서 다음부터 다른 사람 드롭다운에도 뜨게 함.
      if (trimmedName && !staffNames.includes(trimmedName)) {
        addStaffNameIfNew(trimmedName).catch(() => {});
      }
      router.push(`/stocktake/${result.id}`);
    });
  }

  function handleDelete(id: string, location: string) {
    if (!confirm(`"${location}" 조사 기록을 삭제할까요?`)) return;
    startTransition(async () => {
      await deleteStocktakeSession(id);
    });
  }

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="meta" style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>
          총 {sessions.length}건
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={openModal}>
            ＋ 새 조사 시작
          </button>
        </div>
      </div>

      {dateTabs.length > 1 && (
        <div className="chip-group" style={{ marginBottom: '12px' }}>
          <button type="button" className={`chip${!dateFilter ? ' active' : ''}`} onClick={() => setDateFilter(null)}>
            전체
          </button>
          {dateTabs.map((key) => (
            <button
              key={key}
              type="button"
              className={`chip${dateFilter === key ? ' active' : ''}`}
              onClick={() => setDateFilter(dateFilter === key ? null : key)}
            >
              {formatDateTabLabel(key)}
            </button>
          ))}
        </div>
      )}

      {missingItems.length > 0 && (
        <div className="panel" style={{ marginBottom: '12px', borderColor: 'var(--red-100)' }}>
          <div style={{ fontWeight: 700, color: 'var(--red-600)', marginBottom: '8px' }}>
            ⚠️ {dateFilter ? formatDateTabLabel(dateFilter) : '전체 기간'} 미확인 자산 {missingItems.length}건
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {missingItems.map((item) => (
              <button
                key={`${item.sessionId}-${item.assetId}`}
                type="button"
                onClick={() => router.push(`/stocktake/${item.sessionId}`)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '6px 8px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--ink-100)',
                  cursor: 'pointer',
                  fontSize: '12.5px',
                  color: 'var(--ink-700)',
                  textAlign: 'left',
                }}
              >
                <span>
                  <b>{item.location}</b> · <span className="asset-id">{item.assetId}</span> · {item.category} {item.brand}{' '}
                  {item.model}
                </span>
                <span style={{ color: 'var(--ink-400)' }}>열기 →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ paddingTop: '6px' }}>
        <table>
          <thead>
            <tr>
              <th className="hide-mobile">순번</th>
              <th>위치</th>
              <th>상태</th>
              <th>담당자·시작일시</th>
              <th>확인 현황</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleSessions.map((s) => {
              const sum = stocktakeSummary(s.results);
              return (
                <tr key={s.id}>
                  <td className="hide-mobile">{s.seq}</td>
                  <td>{s.location}</td>
                  <td>
                    <span className={`badge badge-${s.status === '완료' ? '상품화완료' : '상품화준비중'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px' }}>
                    <div>{s.startedBy || '-'}</div>
                    <div style={{ color: 'var(--ink-400)' }}>{formatKstDateTime(s.startedAt)}</div>
                  </td>
                  <td style={{ fontSize: '12px' }}>
                    확인 {sum.confirmed} / 전체 {sum.total}
                    {sum.unexpected > 0 && <span style={{ color: 'var(--red-600)' }}> · 목록외 {sum.unexpected}</span>}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => router.push(`/stocktake/${s.id}`)}>
                        열기
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="삭제"
                        disabled={pending}
                        onClick={() => handleDelete(s.id, s.location)}
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleSessions.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  <div>📋</div>
                  {sessions.length === 0 ? '아직 조사 기록이 없어요.' : '이 날짜엔 조사 기록이 없어요.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay${open ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="modal" style={{ width: '420px' }}>
          <h2>새 실재고 조사 시작</h2>
          <div className="sub">위치를 고르면 그 위치에 전산상 있어야 할 자산 목록으로 조사를 시작해요.</div>
          <div className="form-grid">
            <div className="form-field full">
              <label>위치 *</label>
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">위치 선택</option>
                {availableLocations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              {completedTodayLocations.size > 0 && (
                <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>
                  오늘 완료된 위치 {completedTodayLocations.size}곳은 목록에서 뺐어요.
                </div>
              )}
            </div>
            <div className="form-field full">
              <label>담당자</label>
              {customMode || staffNames.length === 0 ? (
                <input value={startedBy} onChange={(e) => setStartedBy(e.target.value)} placeholder="이름 입력" />
              ) : (
                <select
                  value={staffNames.includes(startedBy) ? startedBy : ''}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_OPTION) {
                      setCustomMode(true);
                      setStartedBy('');
                    } else {
                      setStartedBy(e.target.value);
                    }
                  }}
                >
                  <option value="">담당자 선택</option>
                  {staffNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION}>➕ 새 이름 입력</option>
                </select>
              )}
              {customMode && staffNames.length > 0 && (
                <button
                  type="button"
                  className="chip"
                  style={{ marginTop: '4px', alignSelf: 'flex-start' }}
                  onClick={() => {
                    setCustomMode(false);
                    setStartedBy('');
                  }}
                >
                  목록에서 선택
                </button>
              )}
            </div>
          </div>
          {error && <div className="setup-alert" style={{ marginTop: '10px' }}>{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
              취소
            </button>
            <button type="button" className="btn btn-primary" onClick={handleStart} disabled={pending}>
              {pending ? '시작 중…' : '조사 시작'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
