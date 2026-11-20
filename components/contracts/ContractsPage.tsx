'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getContractsOverview } from '@/app/contracts/actions';
import { lockSecrets } from '@/app/contracts/secretActions';
import type { ContractTab, ContractsOverview, UnlockState } from '@/lib/contracts/types';
import PasswordGate, { PasswordChangeDialog } from './PasswordGate';
import SecretLogView, { formatKst } from './SecretLogView';
import SheetImportModal from './SheetImportModal';
import SwClientList from './SwClientList';
import SwClientModal from './SwClientModal';
import { ContractsCtx, type ContractsCtxValue } from './UnlockDialog';

type Props = {
  initialTab: ContractTab;
  overview: ContractsOverview | null;
  overviewError: string | null;
  unlock: UnlockState;
};

function leftText(expiresAt: string | null, now: number | null): string {
  if (!expiresAt || now === null) return '';
  const mins = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? ` · ${h}시간 ${m}분 남음` : ` · ${m}분 남음`;
}

export default function ContractsPage({ initialTab, overview: initialOverview, overviewError, unlock: initialUnlock }: Props) {
  const router = useRouter();
  // 소프트웨어 계약 / PC 유지보수는 왼쪽 메뉴에서 따로 고르는 화면(주소 ?tab=) — 탭이 바뀌면 page.tsx 의
  // <Suspense key={tab}> 때문에 이 화면이 새로 만들어지므로 여기선 고정값
  const tab = initialTab;
  const [overview, setOverview] = useState<ContractsOverview | null>(initialOverview);
  const [error, setError] = useState<string | null>(overviewError);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unlock, setUnlock] = useState<UnlockState>(initialUnlock);
  const [now, setNow] = useState<number | null>(null);
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef<number | null>(null);
  const reqRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, show: true });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((t) => ({ ...t, show: false })), 4500);
  }, []);

  // 서버가 새로 읽어 넘겨 준 값(router.refresh 뒤)을 따라감
  useEffect(() => {
    setUnlock(initialUnlock);
  }, [initialUnlock]);
  useEffect(() => {
    if (initialOverview) {
      setOverview(initialOverview);
      setError(null);
    } else if (overviewError) {
      setError(overviewError);
    }
  }, [initialOverview, overviewError]);

  /** 잠긴 상태로 돌아감 — 열려 있던 창·목록을 비우고 비밀번호 화면으로 */
  const lockLocally = useCallback(() => {
    setUnlock((u) => ({ ...u, unlocked: false, expiresAt: null }));
    setOverview(null);
    setClientKey(null);
    setImportOpen(false);
    setLogOpen(false);
    setPwOpen(false);
  }, []);

  const onNeedUnlock = useCallback(() => {
    lockLocally();
    showToast('시간이 지나 잠겼어요. 비밀번호를 다시 넣어 주세요.');
    router.refresh();
  }, [lockLocally, showToast, router]);

  const load = useCallback(
    async (t: ContractTab, silent: boolean) => {
      const id = ++reqRef.current;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const r = await getContractsOverview(t);
        if (id !== reqRef.current) return;
        if (r.ok) {
          setOverview(r.overview);
          setError(null);
        } else if (r.needUnlock) {
          onNeedUnlock();
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
    },
    [onNeedUnlock],
  );

  // 열려 있는데 목록이 안 넘어왔으면(틀만 먼저 뜬 경우) 직접 읽음
  useEffect(() => {
    if (!initialOverview && !overviewError && initialUnlock.unlocked && initialTab === 'sw') void load('sw', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 남은 시간 표시
  useEffect(() => {
    if (!unlock.unlocked) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [unlock.unlocked]);

  useEffect(() => {
    if (unlock.unlocked && unlock.expiresAt && now !== null && now >= Date.parse(unlock.expiresAt)) onNeedUnlock();
  }, [now, unlock.unlocked, unlock.expiresAt, onNeedUnlock]);

  const fail = useCallback(
    (r: { error: string; needUnlock?: boolean }) => {
      if (r.needUnlock) onNeedUnlock();
      else showToast(r.error);
    },
    [onNeedUnlock, showToast],
  );

  const ctx = useMemo<ContractsCtxValue>(() => ({ unlock, toast: showToast, onNeedUnlock, fail }), [unlock, showToast, onNeedUnlock, fail]);

  function handleUnlocked(state: UnlockState) {
    setUnlock(state);
    void load('sw', false);
    router.refresh();
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
    lockLocally();
    showToast('잠갔어요.');
    router.refresh();
  }

  const gateOn = tab === 'sw' && !unlock.unlocked;

  return (
    <ContractsCtx.Provider value={ctx}>
      <div className="app">
        <div className="ct-topline">
          {/* 왼쪽 메뉴(계약관리 → 소프트웨어 계약 / PC 유지보수)와 같은 이동 — 핸드폰에서 서랍을 안 열고 오가게 */}
          <nav className="chip-group" aria-label="계약관리 화면">
            <Link href="/contracts?tab=sw" aria-current={tab === 'sw' ? 'page' : undefined} className={`chip${tab === 'sw' ? ' active' : ''}`}>
              💿 소프트웨어 계약
            </Link>
            <Link href="/contracts?tab=pcm" aria-current={tab === 'pcm' ? 'page' : undefined} className={`chip${tab === 'pcm' ? ' active' : ''}`}>
              🛠️ PC 유지보수
            </Link>
          </nav>
          <div className="ct-status">
            {!gateOn && tab === 'sw' && overview && overview.source === 'works' && (
              <span className="ct-source good">
                works에서 {formatKst(overview.readAt).split(' ').slice(-1)[0]}에 읽음 · {(overview.sourceMs / 1000).toFixed(1)}초
              </span>
            )}
            {unlock.unlocked && (
              <span className="ct-lock open">
                🔓 열림{leftText(unlock.expiresAt, now)}
                <button type="button" className="btn btn-ghost" onClick={() => void handleLock()}>
                  잠그기
                </button>
              </span>
            )}
          </div>
        </div>

        {tab === 'sw' && !gateOn && overview?.source === 'rental_copy' && (
          <div className="ct-band warn">
            <span>firstoa-works를 못 읽어서 임대리스트 사본(마지막 &apos;반영&apos; 기준)으로 보여 드려요. 새 거래처가 안 보일 수 있어요.</span>
            <button type="button" className="btn btn-ghost" disabled={refreshing} onClick={() => void load('sw', true)}>
              다시 읽기
            </button>
          </div>
        )}
        {tab === 'sw' && !gateOn && overview?.source === 'none' && (
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
        {tab === 'sw' && !gateOn && overview?.tablesMissing && (
          <div className="ct-band warn">
            <span>Supabase SQL Editor에서 supabase/contracts_schema.sql 을 먼저 실행해 주세요. 그 전에는 계약·좌석·비밀 칸을 저장할 수 없어요.</span>
          </div>
        )}

        {tab === 'pcm' ? (
          <div className="empty-state">
            <div>🛠️</div>PC 유지보수는 2단계에서 열려요.
            <div className="ct-muted" style={{ marginTop: '6px' }}>
              방문 기록과 방문 주기 관리가 들어올 예정이에요. 지금은 [소프트웨어 계약]을 써 주세요.
            </div>
          </div>
        ) : gateOn ? (
          <PasswordGate unlock={unlock} onUnlocked={handleUnlocked} />
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
              onOpenImport={() => setImportOpen(true)}
              onOpenLog={() => setLogOpen(true)}
              onOpenPassword={() => setPwOpen(true)}
              onChanged={() => void load('sw', true)}
            />
          </>
        )}

        {clientKey !== null && unlock.unlocked && (
          <SwClientModal
            key={clientKey}
            clientKey={clientKey}
            clients={overview?.clients ?? []}
            onClose={() => setClientKey(null)}
            onChanged={() => void load('sw', true)}
          />
        )}
        {importOpen && unlock.unlocked && (
          <SheetImportModal open clients={overview?.clients ?? []} onClose={() => setImportOpen(false)} onDone={() => void load('sw', true)} />
        )}
        {logOpen && unlock.unlocked && <SecretLogView open onClose={() => setLogOpen(false)} />}
        {pwOpen && unlock.unlocked && <PasswordChangeDialog open onClose={() => setPwOpen(false)} />}

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
