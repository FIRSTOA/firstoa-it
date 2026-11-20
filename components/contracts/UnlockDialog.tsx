'use client';

import { createContext, useContext } from 'react';
import type { UnlockState } from '@/lib/contracts/types';

/*
 * 계약 관리 화면이 같이 쓰는 것 — 쓰는 사람 이름 기억, 열림 상태, 알림, "잠겨 있었음" 처리.
 * (D13: 칸마다 인증 창은 없앰. 비밀번호는 PasswordGate.tsx 한 곳에서만 받음)
 */

/** 이름을 이 브라우저에 기억하는 칸 — 수정한 사람 기록에 씀 */
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

export type ContractsCtxValue = {
  unlock: UnlockState;
  toast: (message: string) => void;
  /** 서버가 needUnlock 을 돌려줬을 때(시간이 지나 잠김) — 비밀번호 화면으로 돌아감 */
  onNeedUnlock: () => void;
  /** 실패 결과 처리: 잠겨 있었으면 비밀번호 화면으로, 아니면 오류 문구를 알림 */
  fail: (r: { error: string; needUnlock?: boolean }) => void;
};

export const ContractsCtx = createContext<ContractsCtxValue>({
  unlock: { passwordSet: false, unlocked: false, expiresAt: null, lockedUntil: null },
  toast: () => {},
  onNeedUnlock: () => {},
  fail: () => {},
});

export const useContractsCtx = () => useContext(ContractsCtx);
