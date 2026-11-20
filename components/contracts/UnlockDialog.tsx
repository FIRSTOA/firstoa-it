'use client';

import { createContext, useContext, useEffect, useState, type FormEvent } from 'react';
import { unlockSecrets } from '@/app/contracts/secretActions';
import type { UnlockState } from '@/lib/contracts/types';

/** 이름을 이 브라우저에 기억하는 칸 — 열람 이름과 수정한 사람 이름이 같다 */
export const CONTRACTS_NAME_KEY = 'firstoa-it.contracts-name';

export function readStoredName(): string {
  try {
    return (localStorage.getItem(CONTRACTS_NAME_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function saveStoredName(name: string) {
  try {
    localStorage.setItem(CONTRACTS_NAME_KEY, name);
  } catch {
    /* 저장소 막힘 — 매번 물어봄 */
  }
}

/** 쓰는 사람 이름 — 기억해 둔 것을 쓰고, 없으면 한 번 물음(로그인 기능 전이라). 못 받으면 null */
export function requireActor(): string | null {
  const saved = readStoredName();
  if (saved.length >= 2) return saved;
  const typed = (window.prompt('쓰는 분 이름을 적어 주세요. (2자 이상, 한 번만 물어봐요)') ?? '').trim();
  if (typed.length < 2) return null;
  saveStoredName(typed);
  return typed;
}

/** 화면 여러 곳이 같이 쓰는 것 — 열람 상태, 인증 창 열기, 알림 */
export type ContractsCtxValue = {
  unlock: UnlockState;
  /** 인증 창을 띄움. 인증에 성공하면 after 를 부름 */
  askUnlock: (after?: () => void) => void;
  toast: (message: string) => void;
};

export const ContractsCtx = createContext<ContractsCtxValue>({
  unlock: { configured: false, unlocked: false, name: '', expiresAt: null, lockedUntil: null },
  askUnlock: () => {},
  toast: () => {},
});

export const useContractsCtx = () => useContext(ContractsCtx);

function minutesUntil(iso: string): number {
  const ms = Date.parse(iso) - Date.now();
  return Math.max(1, Math.ceil(ms / 60000));
}

type Props = {
  open: boolean;
  onClose: () => void;
  onUnlocked: (state: UnlockState) => void;
};

export default function UnlockDialog({ open, onClose, onUnlocked }: Props) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(readStoredName());
    setPw('');
    setError('');
    setRemaining(null);
    setLockedUntil(null);
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const who = name.trim();
    if (who.length < 2) {
      setError('이름을 2자 이상 적어 주세요.');
      return;
    }
    if (!pw) {
      setError('인증 비밀번호를 적어 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    setRemaining(null);
    setLockedUntil(null);
    try {
      const r = await unlockSecrets(pw, who);
      setPw('');
      if (r.ok) {
        saveStoredName(who);
        onUnlocked(r.state);
        return;
      }
      setError(r.error);
      setRemaining(typeof r.remaining === 'number' ? r.remaining : null);
      setLockedUntil(r.lockedUntil ?? null);
    } catch {
      setPw('');
      setError('확인하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`modal-overlay ct-top${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form className="modal ct-unlock" onSubmit={submit} autoComplete="off">
        <h2>🔒 비밀 칸 열기</h2>
        <div className="sub">이름과 인증 비밀번호를 넣으면 10분 동안 비밀 칸을 보고 고칠 수 있어요. 누가 언제 봤는지는 기록돼요.</div>
        <div className="form-grid">
          <div className="form-field full">
            <label htmlFor="ct-unlock-name">이름 (2자 이상)</label>
            <input
              id="ct-unlock-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="예: 홍길동"
            />
          </div>
          <div className="form-field full">
            <label htmlFor="ct-unlock-pw">인증 비밀번호</label>
            <input
              id="ct-unlock-pw"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="current-password"
              autoFocus={!!name}
            />
          </div>
        </div>
        {error && (
          <div className="ct-error" role="alert">
            {error}
            {remaining !== null && <div>남은 시도 {remaining}회</div>}
            {lockedUntil && <div>{minutesUntil(lockedUntil)}분 뒤에 다시 해 주세요.</div>}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            닫기
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '확인 중…' : '열기'}
          </button>
        </div>
      </form>
    </div>
  );
}
