'use client';

import { useEffect, useState } from 'react';
import { getUnlockState } from '@/app/contracts/secretActions';
import PasswordGate from '@/components/contracts/PasswordGate';
import type { UnlockState } from '@/lib/contracts/types';

interface Props {
  /** 풀렸으면 true, 그만두면 false */
  onDone: (unlocked: boolean) => void;
}

/**
 * 라이선스 키 잠금 풀기 — 계약관리와 같은 비밀번호 창(PasswordGate 를 고치지 않고 창으로 감쌈).
 * 같은 쿠키라 여기서 풀면 계약관리도 풀려요.
 */
export default function LicenseUnlockDialog({ onDone }: Props) {
  const [state, setState] = useState<UnlockState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getUnlockState()
      .then((s) => {
        if (!alive) return;
        if (s.unlocked) onDone(true);
        else setState(s);
      })
      .catch(() => {
        if (alive) setError('잠금 상태를 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
      });
    return () => {
      alive = false;
    };
    // 열릴 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay open sc-z-top2">
      <div className="modal sc-unlock-modal" role="dialog" aria-modal="true" aria-label="라이선스 키 잠금 풀기">
        <div className="sub">라이선스 키는 계약관리와 같은 비밀번호로 잠겨 있어요.</div>
        {error ? (
          <div className="ct-error" role="alert">
            {error}
          </div>
        ) : state ? (
          <PasswordGate unlock={state} onUnlocked={() => onDone(true)} />
        ) : (
          <div className="page-loading">
            <span className="nav-spinner" aria-hidden="true" />
            확인하는 중이에요…
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>
            그만두기
          </button>
        </div>
      </div>
    </div>
  );
}
