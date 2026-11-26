'use client';

import { useMemo, useState } from 'react';
import type { LedgerClientCandidate, LedgerClientChoice } from '@/lib/salesConfirms/types';

interface Props {
  /** 확인서의 상호('-현장명' 포함 그대로) */
  company: string;
  candidates: LedgerClientCandidate[];
  busy?: boolean;
  /** 고름 — 이 거래처로 계속 저장 */
  onPick: (choice: LedgerClientChoice) => void;
  /** 키 저장을 그만둠(거래처를 안 정한 채 넘어가는 건 없음) */
  onCancel: () => void;
}

/** 상호에서 '-현장명' 뗀 이름 */
function baseName(company: string): string {
  const s = company.trim();
  const i = s.indexOf('-');
  return (i > 0 ? s.slice(0, i) : s).trim();
}

const keyOf = (c: LedgerClientChoice): string => {
  switch (c.type) {
    case 'existing':
      return `e:${c.clientId}`;
    case 'works':
      return `w:${c.groupKey}`;
    case 'new':
      return `n:${c.name}`;
    default:
      return 'u';
  }
};

/**
 * 거래처 고르기 — 이 확인서의 소프트웨어를 계약관리 소프트웨어 대장 어느 거래처 아래에 쌓을지(처음 키를 저장할 때 한 번).
 * 건너뛰기 없음: 추천·검색해서 고르거나, 새 거래처로 만들거나, 못 정하면 '미분류'.
 */
export default function LedgerClientDialog({ company, candidates, busy, onPick, onCancel }: Props) {
  const name = baseName(company);
  // 서버가 안 준 '새 거래처'·'미분류'는 여기서 덧붙임(고를 길이 늘 있게)
  const all = useMemo(() => {
    const list = [...candidates];
    if (!list.some((c) => c.choice.type === 'new') && name) {
      list.push({ choice: { type: 'new', name }, label: `새 거래처로 만들기: ${name}`, recommended: false });
    }
    if (!list.some((c) => c.choice.type === 'unsorted')) {
      list.push({ choice: { type: 'unsorted' }, label: '미분류 (나중에 계약관리에서 옮기기)', recommended: false });
    }
    return list;
  }, [candidates, name]);

  const initial = all.find((c) => c.recommended) ?? all.find((c) => c.choice.type === 'new') ?? all[0];
  const [sel, setSel] = useState(initial ? keyOf(initial.choice) : '');
  const [q, setQ] = useState('');

  const shown = all.filter((c) => {
    const s = q.trim().toLowerCase();
    // 고른 것·고정 선택지(새·미분류)는 검색해도 늘 보임
    if (!s || keyOf(c.choice) === sel || c.choice.type === 'new' || c.choice.type === 'unsorted') return true;
    return c.label.toLowerCase().includes(s);
  });
  const picked = all.find((c) => keyOf(c.choice) === sel);

  return (
    <div className="modal-overlay open sc-z-top">
      <div className="modal sc-client-modal" role="dialog" aria-modal="true" aria-labelledby="sc-client-title">
        <h2 id="sc-client-title">어느 거래처의 소프트웨어인가요?</h2>
        <div className="sub">
          <b>{company || '(상호 없음)'}</b> 확인서의 소프트웨어를 계약관리 대장에 같이 올려요. 한 번만 정하면 돼요.
        </div>
        {all.length > 4 && (
          <div className="form-field">
            <label htmlFor="sc-client-q">거래처 찾기</label>
            <input id="sc-client-q" type="search" value={q} placeholder="거래처 이름" onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </div>
        )}
        <div className="sc-client-list" role="radiogroup" aria-label="거래처">
          {shown.map((c) => {
            const k = keyOf(c.choice);
            return (
              <label key={k} className={`sc-client-opt${sel === k ? ' on' : ''}`}>
                <input type="radio" name="sc-client" checked={sel === k} onChange={() => setSel(k)} />
                <span>{c.label}</span>
                {c.recommended && <span className="sc-pill sc-pill-new">추천</span>}
              </label>
            );
          })}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            그만두기 (키는 저장 안 해요)
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !picked} onClick={() => picked && onPick(picked.choice)}>
            {busy ? '저장 중…' : '이 거래처로 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
