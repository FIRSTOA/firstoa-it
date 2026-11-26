'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SALES_CONFIRM_ACTOR_KEY } from '@/lib/salesConfirms/types';

/**
 * 영업 확인서 상세·출력 화면이 같이 쓰는 두 가지 — 쓰는 사람 이름(1단계 목록과 같은 localStorage 열쇠)과 알림(.toast).
 * 목록 화면(SalesConfirmListPage)은 자기 코드를 그대로 쓰고 이 파일은 상세 쪽만 씀.
 */

export function useSalesActor(): {
  actor: string;
  actorRef: { current: string };
  /** 이름이 있으면 바로, 없으면 이름 창을 띄워 물음(취소하면 null) */
  ensureActor: () => Promise<string | null>;
  changeName: () => void;
  nameDialog: ReactNode;
} {
  const [actor, setActor] = useState('');
  const actorRef = useRef('');
  const [ask, setAsk] = useState<((v: string | null) => void) | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    try {
      const saved = (localStorage.getItem(SALES_CONFIRM_ACTOR_KEY) ?? '').trim();
      if (saved) {
        actorRef.current = saved;
        setActor(saved);
      }
    } catch {
      // 브라우저 저장소를 못 읽으면 이름은 필요할 때 묻기
    }
  }, []);

  const open = useCallback((initial: string) => {
    return new Promise<string | null>((resolve) => {
      setDraft(initial);
      setAsk(() => resolve);
    });
  }, []);

  const ensureActor = useCallback(async (): Promise<string | null> => {
    const have = actorRef.current.trim();
    if (have) return have;
    return open('');
  }, [open]);

  const changeName = useCallback(() => {
    void open(actorRef.current);
  }, [open]);

  function submit() {
    const v = draft.trim();
    if (!v || !ask) return;
    try {
      localStorage.setItem(SALES_CONFIRM_ACTOR_KEY, v);
    } catch {
      // 저장 못 해도 이번엔 그대로 진행
    }
    actorRef.current = v;
    setActor(v);
    ask(v);
    setAsk(null);
  }

  function cancel() {
    ask?.(null);
    setAsk(null);
  }

  const nameDialog = ask ? (
    <div className="modal-overlay open sc-z-top" onClick={cancel}>
      <div className="modal sc-name-modal" role="dialog" aria-modal="true" aria-label="이름 적기" onClick={(e) => e.stopPropagation()}>
        <h2>누가 고치나요?</h2>
        <div className="sub">고친 사람 이름을 남겨요. 이 브라우저에 기억해 두니 한 번만 적으면 돼요.</div>
        <div className="form-field">
          <label htmlFor="sc-d-name">이름</label>
          <input
            id="sc-d-name"
            value={draft}
            maxLength={30}
            autoFocus
            placeholder="예: 홍길동"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={submit}>
            저장
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { actor, actorRef, ensureActor, changeName, nameDialog };
}

export function useSalesToast(): {
  /** 잠깐 보이고 사라짐 */
  show: (msg: string) => void;
  /** 실패·주의 — 저절로 안 닫힘(× 로 닫음) */
  warn: (msg: string) => void;
  node: ReactNode;
} {
  const [t, setT] = useState({ msg: '', show: false, warn: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setT({ msg, show: true, warn: false });
    timer.current = setTimeout(() => setT((x) => ({ ...x, show: false })), 2200);
  }, []);
  const warn = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setT({ msg, show: true, warn: true });
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const node = (
    <div className={`toast${t.show ? ' show' : ''}${t.warn ? ' toast-warn' : ''}`} role={t.warn ? 'alert' : undefined}>
      <span>{t.msg}</span>
      <button type="button" className="toast-close" onClick={() => setT((x) => ({ ...x, show: false }))} aria-label="닫기">
        ×
      </button>
    </div>
  );
  return { show, warn, node };
}
