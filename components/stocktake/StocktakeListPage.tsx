'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatKstDateTime, stocktakeSummary, type StocktakeSession } from '@/lib/stocktake';
import { deleteStocktakeSession, startStocktake } from '@/app/stocktake/actions';

export default function StocktakeListPage({
  sessions,
  locations,
}: {
  sessions: StocktakeSession[];
  locations: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [startedBy, setStartedBy] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function handleStart() {
    if (!location.trim()) {
      setError('위치를 입력해주세요.');
      return;
    }
    setError('');
    startTransition(async () => {
      const result = await startStocktake(location, startedBy);
      if (!result.ok) {
        setError(result.error);
        return;
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
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            ＋ 새 조사 시작
          </button>
        </div>
      </div>

      <div className="panel" style={{ paddingTop: '6px' }}>
        <table>
          <thead>
            <tr>
              <th className="hide-mobile">순번</th>
              <th>위치</th>
              <th>상태</th>
              <th className="hide-mobile">담당자</th>
              <th className="hide-mobile">시작일시</th>
              <th>확인 현황</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
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
                  <td className="hide-mobile">{s.startedBy || '-'}</td>
                  <td className="hide-mobile" style={{ fontSize: '12px' }}>{formatKstDateTime(s.startedAt)}</td>
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
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-state">
                  <div>📋</div>
                  아직 조사 기록이 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay${open ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="modal" style={{ width: '420px' }}>
          <h2>새 실재고 조사 시작</h2>
          <div className="sub">위치를 입력하면 그 위치에 전산상 있어야 할 자산 목록으로 조사를 시작해요.</div>
          <div className="form-grid">
            <div className="form-field full">
              <label>위치 *</label>
              <input
                list="stocktake-locations"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="예: G4"
              />
              <datalist id="stocktake-locations">
                {locations.map((loc) => (
                  <option key={loc} value={loc} />
                ))}
              </datalist>
            </div>
            <div className="form-field full">
              <label>담당자</label>
              <input value={startedBy} onChange={(e) => setStartedBy(e.target.value)} placeholder="예: 신동원" />
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
