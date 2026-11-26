'use client';

import { useEffect, useRef, useState } from 'react';
import type { UnitLicenseState } from '@/lib/salesConfirms/types';

interface Props {
  /** 이 칸의 대장·키 상태(칸이 아직 저장 전이면 undefined) */
  state: UnitLicenseState | undefined;
  /** true = 잠금 풀림 · false = 잠김 · null = 아직 모름(읽는 중이거나 읽기 실패) */
  unlocked: boolean | null;
  loading: boolean;
  loadError: string;
  /** 계약관리 SQL(블록 B) 전 — 키 저장만 막힘 */
  needSql: boolean;
  disabled?: boolean;
  id: string;
  onUnlock: () => void;
  onRetryLoad: () => void;
  /** 키 저장(빈 값 = 지우기) — 성공이면 true. 잠금·거래처 고르기는 부모가 처리 */
  onSave: (key: string) => Promise<boolean>;
}

/**
 * 라이선스 키 칸(🔒). 잠겨 있으면 "키 있음/없음"만 + [열고 넣기·보기], 풀려 있으면 값이 그대로 보이고 바로 고침(나가면 저장).
 * 키 값은 이 컴포넌트 메모리(state)에만 — localStorage·주소에 안 남김.
 */
export default function LicenseKeyField({ state, unlocked, loading, loadError, needSql, disabled, id, onUnlock, onRetryLoad, onSave }: Props) {
  const serverKey = state?.key ?? '';
  const [draft, setDraft] = useState(serverKey);
  const baseRef = useRef(serverKey);
  const draftRef = useRef(serverKey);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // 서버 값이 바뀌면 따라감(내가 고치는 중이면 그대로 둠)
  useEffect(() => {
    const next = state?.key ?? '';
    if (draftRef.current === baseRef.current) {
      draftRef.current = next;
      setDraft(next);
    }
    baseRef.current = next;
  }, [state?.key]);

  // 잠기면 메모리의 키를 바로 비움
  useEffect(() => {
    if (unlocked !== true) {
      draftRef.current = '';
      baseRef.current = '';
      setDraft('');
    }
  }, [unlocked]);

  async function commit() {
    const v = draftRef.current.trim();
    if (v === baseRef.current.trim()) return;
    if (!v && baseRef.current.trim() && !window.confirm('라이선스 키를 지울까요? (계약관리에서도 지워져요)')) {
      draftRef.current = baseRef.current;
      setDraft(baseRef.current);
      return;
    }
    setStatus('saving');
    const ok = await onSave(v);
    setStatus(ok ? 'saved' : 'error');
  }

  if (needSql) {
    return (
      <div className="sc-key sc-key-off">
        <span className="sc-pill sc-pill-amber">계약관리 SQL 실행 필요</span>
        <span className="sc-muted">키 저장만 아직 안 돼요. 나머지 칸은 그대로 적을 수 있어요.</span>
      </div>
    );
  }
  if (unlocked === null) {
    return (
      <div className="sc-key sc-key-off">
        {loading ? (
          <span className="sc-muted">키 상태를 읽는 중…</span>
        ) : (
          <>
            <span className="sc-pill sc-pill-gray">키 상태를 못 읽었어요</span>
            {loadError && <span className="sc-muted">{loadError}</span>}
            <button type="button" className="btn btn-ghost sc-btn" onClick={onRetryLoad}>
              다시 읽기
            </button>
          </>
        )}
      </div>
    );
  }
  if (!unlocked) {
    return (
      <div className="sc-key sc-key-off">
        <span className={`sc-pill ${state?.hasKey ? 'sc-pill-indigo' : 'sc-pill-gray'}`}>🔒 키 {state?.hasKey ? '있음' : '없음'}</span>
        <button type="button" className="btn btn-ghost sc-btn" disabled={disabled} onClick={onUnlock}>
          🔓 열고 넣기·보기
        </button>
      </div>
    );
  }
  return (
    <div className="sc-key">
      <input
        id={id}
        data-field="licenseKey"
        className="sc-in sc-mono-in"
        value={draft}
        placeholder="라이선스 키를 넣어 주세요"
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          draftRef.current = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={() => void commit()}
      />
      <span className={`sc-save-state ${status}`}>
        {status === 'saving' ? '저장 중…' : status === 'saved' ? '저장됨' : status === 'error' ? '저장 안 됨' : ''}
      </span>
    </div>
  );
}
