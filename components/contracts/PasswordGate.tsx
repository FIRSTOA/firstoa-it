'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { changePassword, setFirstPassword, unlockSecrets } from '@/app/contracts/secretActions';
import { UNLOCK_HOURS, type UnlockState } from '@/lib/contracts/types';
import { readStoredName, useContractsCtx } from './UnlockDialog';

const MIN_LEN = 4;

function minutesUntil(iso: string): number {
  return Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 60000));
}

type GateProps = {
  unlock: UnlockState;
  onUnlocked: (state: UnlockState) => void;
};

/** 소프트웨어 탭이 잠겨 있을 때 목록 대신 보이는 가운데 카드 */
export default function PasswordGate({ unlock, onUnlocked }: GateProps) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(unlock.lockedUntil);
  const creating = !unlock.passwordSet;

  useEffect(() => {
    setLockedUntil(unlock.lockedUntil);
  }, [unlock.lockedUntil]);

  const locked = !!lockedUntil && Date.parse(lockedUntil) > Date.now();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || locked) return;
    if (!pw) {
      setError(creating ? '정할 비밀번호를 적어 주세요.' : '비밀번호를 적어 주세요.');
      return;
    }
    if (creating) {
      if (pw.length < MIN_LEN) {
        setError(`비밀번호는 ${MIN_LEN}자 이상으로 정해 주세요.`);
        return;
      }
      if (pw !== pw2) {
        setError('두 번 적은 비밀번호가 달라요.');
        return;
      }
    }
    setBusy(true);
    setError('');
    setRemaining(null);
    const name = readStoredName() || undefined; // 이름 칸은 없음 — 기억된 이름이 있으면 조용히 넘김
    try {
      const r = creating ? await setFirstPassword(pw, name) : await unlockSecrets(pw, name);
      setPw('');
      setPw2('');
      if (r.ok) {
        onUnlocked(r.state);
        return;
      }
      setError(r.error || '비밀번호가 맞지 않아요.');
      setRemaining(typeof r.remaining === 'number' ? r.remaining : null);
      setLockedUntil(r.lockedUntil ?? null);
    } catch {
      setPw('');
      setPw2('');
      setError('확인하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ct-gate-wrap">
      <form className="ct-gate" onSubmit={submit}>
        <div className="ct-gate-icon">🔒</div>
        {creating ? (
          <>
            <h2>처음 쓰는 비밀번호를 정해 주세요</h2>
            <p className="ct-muted">소프트웨어 계약은 비밀번호를 넣어야 볼 수 있어요. 이 비밀번호는 팀원끼리 같이 써요.</p>
          </>
        ) : (
          <>
            <h2>소프트웨어 계약은 비밀번호를 넣어야 볼 수 있어요</h2>
            <p className="ct-muted">한 번 열면 {UNLOCK_HOURS}시간 동안 열려 있어요.</p>
          </>
        )}
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete={creating ? 'new-password' : 'current-password'}
          autoFocus
          placeholder={creating ? '정할 비밀번호' : '비밀번호'}
          aria-label="비밀번호"
          disabled={locked}
        />
        {creating && (
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            placeholder="한 번 더"
            aria-label="비밀번호 한 번 더"
          />
        )}
        {creating && <p className="ct-muted">남이 맞히기 쉬운 1234·0000 보다는 6자리 이상을 권해요. (4자 이상이면 돼요)</p>}
        {locked && lockedUntil && <div className="ct-error">틀린 시도가 많아 잠겼어요. {minutesUntil(lockedUntil)}분 뒤 다시 해 주세요.</div>}
        {!locked && error && (
          <div className="ct-error" role="alert">
            {error}
            {remaining !== null && ` (남은 시도 ${remaining}회)`}
          </div>
        )}
        <button type="submit" className="btn btn-primary ct-gate-btn" disabled={busy || locked}>
          {busy ? '확인 중…' : creating ? '정하기' : '열기'}
        </button>
      </form>
    </div>
  );
}

type ChangeProps = { open: boolean; onClose: () => void };

/** ⋯ 관리 → 비밀번호 바꾸기 (지금 비밀번호 + 새 비밀번호 두 번) */
export function PasswordChangeDialog({ open, onClose }: ChangeProps) {
  const { toast, fail } = useContractsCtx();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setCur('');
      setNext('');
      setNext2('');
      setError('');
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!cur) {
      setError('지금 비밀번호를 적어 주세요.');
      return;
    }
    if (next.length < MIN_LEN) {
      setError(`새 비밀번호는 ${MIN_LEN}자 이상으로 정해 주세요.`);
      return;
    }
    if (next !== next2) {
      setError('새 비밀번호를 두 번 다르게 적었어요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await changePassword(cur, next);
      if (r.ok) {
        toast('비밀번호를 바꿨어요. 다른 기기는 다시 비밀번호를 넣어야 해요.');
        onClose();
        return;
      }
      if (r.needUnlock) {
        fail(r);
        onClose();
        return;
      }
      setError(r.error);
    } catch {
      setError('바꾸지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setCur('');
      setNext('');
      setNext2('');
      setBusy(false);
    }
  }

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form className="modal" onSubmit={submit}>
        <h2>비밀번호 바꾸기</h2>
        <div className="sub">바꾸면 다른 기기에서 열어 둔 것은 닫혀요. 이 기기는 계속 열려 있어요.</div>
        <div className="form-grid">
          <div className="form-field full">
            <label htmlFor="ct-pw-cur">지금 비밀번호</label>
            <input id="ct-pw-cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="form-field full">
            <label htmlFor="ct-pw-new">새 비밀번호</label>
            <input id="ct-pw-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="form-field full">
            <label htmlFor="ct-pw-new2">새 비밀번호 한 번 더</label>
            <input id="ct-pw-new2" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        {error && (
          <div className="ct-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            닫기
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '바꾸는 중…' : '바꾸기'}
          </button>
        </div>
      </form>
    </div>
  );
}
