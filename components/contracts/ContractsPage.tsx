'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getContractsOverview } from '@/app/contracts/actions';
import { lockSecrets } from '@/app/contracts/secretActions';
import type { ContractTab, ContractsOverview, UnlockState } from '@/lib/contracts/types';
import SecretLogView, { formatKst } from './SecretLogView';
import SheetImportModal from './SheetImportModal';
import SwClientList from './SwClientList';
import SwClientModal from './SwClientModal';
import UnlockDialog, { ContractsCtx, type ContractsCtxValue } from './UnlockDialog';

type Props = {
  initialTab: ContractTab;
  overview: ContractsOverview | null;
  overviewError: string | null;
  unlock: UnlockState;
};

export default function ContractsPage({ initialTab, overview: initialOverview, overviewError, unlock: initialUnlock }: Props) {
  const [tab, setTab] = useState<ContractTab>(initialTab);
  const [overview, setOverview] = useState<ContractsOverview | null>(initialOverview);
  const [error, setError] = useState<string | null>(overviewError);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unlock, setUnlock] = useState<UnlockState>(initialUnlock);
  const [now, setNow] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState({ msg: '', show: false });
  const afterUnlock = useRef<(() => void) | null>(null);
  const toastTimer = useRef<number | null>(null);
  const reqRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, show: true });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((t) => ({ ...t, show: false })), 4500);
  }, []);

  const load = useCallback(async (t: ContractTab, silent: boolean) => {
    const id = ++reqRef.current;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await getContractsOverview(t);
      if (id !== reqRef.current) return;
      if (r.ok) {
        setOverview(r.overview);
        setError(null);
      } else {
        setError(r.error);
        if (!silent) setOverview(null);
      }
    } catch {
      if (id === reqRef.current) {
        setError('목록을 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
        if (!silent) setOverview(null);
      }
    } finally {
      if (id === reqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // 처음에 목록이 안 넘어왔으면(틀만 먼저 뜬 경우) 직접 읽음
  useEffect(() => {
    if (!initialOverview && !overviewError && initialTab === 'sw') void load('sw', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 열람 남은 시간 — 서버 시각과 어긋나도 서버가 쿠키로 다시 확인하니 화면 표시용
  useEffect(() => {
    if (!unlock.unlocked) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, [unlock.unlocked]);

  useEffect(() => {
    if (unlock.unlocked && unlock.expiresAt && now !== null && now >= Date.parse(unlock.expiresAt)) {
      setUnlock((u) => ({ ...u, unlocked: false, expiresAt: null }));
      showToast('열람 시간이 끝나 다시 잠겼어요.');
    }
  }, [now, unlock.unlocked, unlock.expiresAt, showToast]);

  function switchTab(t: ContractTab) {
    if (t === tab) return;
    setTab(t);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', t);
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* 주소 바꾸기 실패 — 화면은 그대로 바뀜 */
    }
    if (t === 'sw') void load('sw', false);
  }

  const askUnlock = useCallback(
    (after?: () => void) => {
      if (!unlock.configured) {
        showToast('비밀 칸 설정 전이라 열 수 없어요. 먼저 /contracts/setup 에서 설정해 주세요.');
        return;
      }
      afterUnlock.current = after ?? null;
      setDialogOpen(true);
    },
    [unlock.configured, showToast],
  );

  const ctx = useMemo<ContractsCtxValue>(() => ({ unlock, askUnlock, toast: showToast }), [unlock, askUnlock, showToast]);

  function handleUnlocked(state: UnlockState) {
    setUnlock(state);
    setDialogOpen(false);
    const cb = afterUnlock.current;
    afterUnlock.current = null;
    if (cb) window.setTimeout(cb, 0);
  }

  async function handleLock() {
    try {
      const r = await lockSecrets();
      if (!r.ok) {
        showToast(r.error);
        return;
      }
    } catch {
      showToast('잠그지 못했어요. 잠시 뒤 다시 해 주세요.');
      return;
    }
    setUnlock((u) => ({ ...u, unlocked: false, expiresAt: null }));
    showToast('잠갔어요.');
  }

  function needUnlockThen(open: () => void) {
    if (unlock.unlocked) open();
    else askUnlock(open);
  }

  const minutesLeft = unlock.unlocked && unlock.expiresAt && now !== null ? Math.max(0, Math.ceil((Date.parse(unlock.expiresAt) - now) / 60000)) : null;
  const secretsOff = !unlock.configured || (overview ? !overview.secretsConfigured : false);

  return (
    <ContractsCtx.Provider value={ctx}>
      <div className="app">
        <div className="ct-topline">
          <div className="chip-group" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'sw'} className={`chip${tab === 'sw' ? ' active' : ''}`} onClick={() => switchTab('sw')}>
              소프트웨어 계약
            </button>
            <button type="button" role="tab" aria-selected={tab === 'pcm'} className={`chip${tab === 'pcm' ? ' active' : ''}`} onClick={() => switchTab('pcm')}>
              PC 유지보수
            </button>
          </div>
          <div className="ct-status">
            {tab === 'sw' && overview && overview.source === 'works' && (
              <span className="ct-source good">
                works에서 {formatKst(overview.readAt).split(' ').slice(-1)[0]}에 읽음 · {(overview.sourceMs / 1000).toFixed(1)}초
              </span>
            )}
            {unlock.unlocked ? (
              <span className="ct-lock open">
                🔓 열람 중 · {unlock.name}
                {minutesLeft !== null ? ` · ${minutesLeft}분 남음` : ''}
                <button type="button" className="btn btn-ghost" onClick={() => void handleLock()}>
                  잠그기
                </button>
              </span>
            ) : (
              <span className="ct-lock">
                🔒 잠김
                {unlock.configured && (
                  <button type="button" className="btn btn-ghost" onClick={() => askUnlock()}>
                    열기
                  </button>
                )}
              </span>
            )}
          </div>
        </div>

        {tab === 'sw' && overview?.source === 'rental_copy' && (
          <div className="ct-band warn">
            <span>firstoa-works를 못 읽어서 임대리스트 사본(마지막 &apos;반영&apos; 기준)으로 보여 드려요. 새 거래처가 안 보일 수 있어요.</span>
            <button type="button" className="btn btn-ghost" disabled={refreshing} onClick={() => void load('sw', true)}>
              다시 읽기
            </button>
          </div>
        )}
        {tab === 'sw' && overview?.source === 'none' && (
          <div className="ct-band bad">
            <span>
              거래처 목록을 못 읽었어요. 저장해 둔 거래처만 보여요.
              {overview.sourceError ? ` (${overview.sourceError})` : ''}
            </span>
            <button type="button" className="btn btn-ghost" disabled={refreshing} onClick={() => void load('sw', true)}>
              {refreshing ? '읽는 중…' : '다시 읽기'}
            </button>
          </div>
        )}
        {tab === 'sw' && overview?.tablesMissing && (
          <div className="ct-band warn">
            <span>Supabase SQL Editor에서 supabase/contracts_schema.sql 을 먼저 실행해 주세요. 그 전에는 계약·좌석·비밀 칸을 저장할 수 없어요.</span>
          </div>
        )}
        {secretsOff && (
          <div className="ct-band warn">
            <span>
              비밀 칸 설정 전이에요 — 비밀번호·키는 아직 열 수도 저장할 수도 없어요. <Link href="/contracts/setup">설정하러 가기 (/contracts/setup)</Link>
            </span>
          </div>
        )}

        {tab === 'pcm' ? (
          <div className="empty-state">
            <div>🛠️</div>PC 유지보수는 2단계에서 열려요.
            <div className="ct-muted" style={{ marginTop: '6px' }}>
              방문 기록과 방문 주기 관리가 들어올 예정이에요. 지금은 [소프트웨어 계약]을 써 주세요.
            </div>
          </div>
        ) : loading && !overview ? (
          <div className="empty-state">
            <div>⏳</div>거래처 목록을 불러오는 중…
          </div>
        ) : !overview ? (
          <div className="empty-state">
            <div>⚠️</div>
            {error ?? '목록을 읽지 못했어요.'}
            <div style={{ marginTop: '12px' }}>
              <button type="button" className="btn btn-ghost" onClick={() => void load('sw', false)}>
                다시 읽기
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="ct-band bad">
                <span>{error}</span>
                <button type="button" className="btn btn-ghost" onClick={() => void load('sw', true)}>
                  다시 읽기
                </button>
              </div>
            )}
            <SwClientList
              overview={overview}
              refreshing={refreshing}
              onOpen={setClientKey}
              onOpenImport={() => needUnlockThen(() => setImportOpen(true))}
              onOpenLog={() => needUnlockThen(() => setLogOpen(true))}
              onChanged={() => void load('sw', true)}
            />
          </>
        )}

        {clientKey !== null && (
          <SwClientModal
            key={clientKey}
            clientKey={clientKey}
            clients={overview?.clients ?? []}
            onClose={() => setClientKey(null)}
            onChanged={() => void load('sw', true)}
          />
        )}
        {importOpen && (
          <SheetImportModal open clients={overview?.clients ?? []} onClose={() => setImportOpen(false)} onDone={() => void load('sw', true)} />
        )}
        {logOpen && <SecretLogView open onClose={() => setLogOpen(false)} />}
        <UnlockDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onUnlocked={handleUnlocked} />

        <div className={`toast${toast.show ? ' show' : ''}`}>
          <span>{toast.msg}</span>
          <button type="button" className="toast-close" onClick={() => setToast((t) => ({ ...t, show: false }))} aria-label="닫기">
            ×
          </button>
        </div>
      </div>
    </ContractsCtx.Provider>
  );
}
