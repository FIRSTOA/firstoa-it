'use client';

import { useMemo, useState } from 'react';
import { createManualClient } from '@/app/contracts/actions';
import type { ClientSummary, ContractsOverview } from '@/lib/contracts/types';
import MobileFilterRows from '@/components/MobileFilterRows';
import { requireActor, useContractsCtx } from './UnlockDialog';

type Filter = 'all' | 'needsDetail' | 'due30' | 'expired' | 'ended' | 'notInWorks';

type Props = {
  overview: ContractsOverview;
  /** 목록을 다시 읽는 중(옛 목록을 그대로 보여 줌) */
  refreshing: boolean;
  onOpen: (key: string) => void;
  onOpenImport: () => void;
  onOpenLog: () => void;
  /** 새 거래처를 만든 뒤 목록 다시 읽기 */
  onChanged: () => void;
};

const isNotInWorks = (c: ClientSummary) => c.state === 'manual' || c.endedReason === 'not_in_works';

function rank(c: ClientSummary): number {
  if (c.state === 'ended') return 9;
  if (c.renewal === 'expired') return 0;
  if (c.renewal === 'due30') return 1;
  if (c.needsDetail) return 2;
  return 3;
}

function statusBadge(c: ClientSummary): { cls: string; label: string } {
  if (c.state === 'ended') return { cls: 'badge-미정', label: '계약 종료' };
  if (c.renewal === 'expired') return { cls: 'badge-수리중', label: '날짜 지남' };
  if (c.renewal === 'due30') return { cls: 'badge-상품화준비중', label: '30일 안' };
  if (c.needsDetail) return { cls: 'badge-미정', label: '상세 미입력' };
  if (c.state === 'manual') return { cls: 'badge-기타', label: 'works에 없음' };
  return { cls: 'badge-상품화완료', label: '정상' };
}

export default function SwClientList({ overview, refreshing, onOpen, onOpenImport, onOpenLog, onChanged }: Props) {
  const { toast } = useContractsCtx();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);

  const clients = overview.clients;
  const counts = useMemo(
    () => ({
      all: clients.length,
      needsDetail: clients.filter((c) => c.needsDetail && c.state !== 'ended').length,
      due30: clients.filter((c) => c.renewal === 'due30' && c.state !== 'ended').length,
      expired: clients.filter((c) => c.renewal === 'expired' && c.state !== 'ended').length,
      ended: clients.filter((c) => c.state === 'ended').length,
      notInWorks: clients.filter(isNotInWorks).length,
    }),
    [clients],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return clients
      .filter((c) => {
        if (filter === 'needsDetail' && !(c.needsDetail && c.state !== 'ended')) return false;
        if (filter === 'due30' && !(c.renewal === 'due30' && c.state !== 'ended')) return false;
        if (filter === 'expired' && !(c.renewal === 'expired' && c.state !== 'ended')) return false;
        if (filter === 'ended' && c.state !== 'ended') return false;
        if (filter === 'notInWorks' && !isNotInWorks(c)) return false;
        if (term && !`${c.name} ${c.worksName} ${c.searchText}`.toLowerCase().includes(term)) return false;
        return true;
      })
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko'));
  }, [clients, filter, search]);

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: '거래처' },
    { key: 'needsDetail', label: '상세 미입력' },
    { key: 'due30', label: '30일 안' },
    { key: 'expired', label: '날짜 지남' },
    { key: 'ended', label: '계약 종료' },
    { key: 'notInWorks', label: 'works에 없음' },
  ];

  async function addManual() {
    const name = addName.trim();
    if (!name) {
      toast('거래처 이름을 적어 주세요.');
      return;
    }
    const actor = requireActor();
    if (!actor) {
      toast('이름을 적어야 저장할 수 있어요.');
      return;
    }
    setAdding(true);
    try {
      const r = await createManualClient(name, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('거래처를 추가했어요.');
      setAddOpen(false);
      setAddName('');
      onChanged();
      onOpen(r.id);
    } catch {
      toast('추가하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <div className="panel ct-listbar">
        <MobileFilterRows>
          <div className="filter-row">
            <div className="chip-group">
              {chips.map((ch) => {
                const on = filter === ch.key;
                // 필터 개수에 "전체"가 안 들어가게 'all' 은 chip-on
                const cls = on ? (ch.key === 'all' ? 'chip chip-on' : 'chip active') : 'chip';
                return (
                  <button key={ch.key} type="button" className={cls} onClick={() => setFilter(on ? 'all' : ch.key)}>
                    {ch.label} {counts[ch.key]}
                  </button>
                );
              })}
            </div>
          </div>
        </MobileFilterRows>
        <div className="search-row ct-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="거래처 · 상품 · 사용자 · PC 자산번호 검색"
          />
          <div className="ct-menu-wrap">
            <button type="button" className="btn btn-ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              ⋯ 관리
            </button>
            {menuOpen && (
              <>
                <div className="ct-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="ct-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenImport();
                    }}
                  >
                    📥 시트에서 옮기기
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenLog();
                    }}
                  >
                    🕘 열람 기록
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setAddOpen(true);
                    }}
                  >
                    ＋ works에 없는 거래처 추가
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="ct-count">
          {visible.length}곳 보임{refreshing ? ' · 다시 읽는 중…' : ''}
        </div>
      </div>

      <table className={`m-cards ct-client-table${refreshing ? ' ct-refreshing' : ''}`}>
        <thead>
          <tr>
            <th data-m="title" data-label="거래처">거래처</th>
            <th data-m="badge" data-label="상태">상태</th>
            <th data-m="inline" data-label="상품">상품</th>
            <th data-m="sub" data-label="임대·라이선스">임대 · 라이선스</th>
            <th data-m="inline" data-label="다음 날짜">다음 날짜</th>
            <th data-m="hide">담당</th>
            <th data-m="actions"></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => {
            const b = statusBadge(c);
            const differs = c.licenseCount > 0 && c.licenseCount !== c.activeLines;
            return (
              <tr key={c.key}>
                <td>
                  <button type="button" className="ct-name-btn" onClick={() => onOpen(c.key)}>
                    {c.name}
                  </button>
                  {c.endedReason === 'not_in_works' && <div className="ct-muted">works에 없음</div>}
                  {c.notice && <div className="ct-warn">⚠ {c.notice}</div>}
                </td>
                <td>
                  <span className={`badge ${b.cls}`}>{b.label}</span>
                </td>
                <td>{c.products.map((p) => `${p.name} ×${p.count}`).join(' · ') || '-'}</td>
                <td>
                  임대 {c.activeLines}건 ·{' '}
                  <span className={differs ? 'ct-warn' : undefined}>
                    라이선스 {c.licenseCount}개{differs ? ' (달라요)' : ''}
                  </span>
                </td>
                <td>{c.nextDate ?? '-'}</td>
                <td>{[c.salesOwner && `영업 ${c.salesOwner}`, c.itOwner && `전산 ${c.itOwner}`].filter(Boolean).join(' · ') || '-'}</td>
                <td>
                  <button type="button" className="btn btn-ghost" onClick={() => onOpen(c.key)}>
                    열기
                  </button>
                </td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-state">
                {clients.length === 0 ? (
                  <>
                    <div>📑</div>
                    {overview.source === 'none'
                      ? '거래처 목록을 못 읽었어요. 위의 [다시 읽기]를 눌러 보세요. 저장해 둔 거래처도 아직 없어요.'
                      : '아직 거래처가 없어요. works에서 소프트웨어 임대 건을 찾지 못했어요(품목 이름을 확인해 주세요).'}
                  </>
                ) : (
                  <>
                    <div>🔍</div>조건에 맞는 거래처가 없어요.
                  </>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {addOpen && (
        <div
          className="modal-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget && !adding) setAddOpen(false);
          }}
        >
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void addManual();
            }}
          >
            <h2>works에 없는 거래처 추가</h2>
            <div className="sub">판매 건이나 직접 계약처럼 works 임대 목록에 없는 곳을 직접 적어 둘 때 써요.</div>
            <div className="form-field">
              <label htmlFor="ct-add-name">거래처 이름</label>
              <input id="ct-add-name" value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" disabled={adding} onClick={() => setAddOpen(false)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={adding}>
                {adding ? '추가 중…' : '추가'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
