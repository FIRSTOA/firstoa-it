'use client';

import { useState } from 'react';
import { fmtDateTime } from './format';

interface Props {
  /** 항목 이름들(it_prep_photo_items 의 label — 읽기만) */
  items: { label: string }[];
  checks: Record<string, { at: string; by: string }>;
  /** 체크·해제 저장 — 성공이면 true */
  onToggle: (label: string, on: boolean) => Promise<boolean>;
  disabled?: boolean;
  /** 접힌 줄에 보일 이름(기본 "체크") */
  title?: string;
  /** 처음부터 펼침(건 단위 '기타' 묶음용) */
  defaultOpen?: boolean;
}

/** 출고 체크리스트 — 접힌 "체크 7/20 ▸", 펼치면 항목마다 체크(누른 사람·시각 작게). 항목 추가·삭제는 출고 준비 완료 보고에서만 */
export default function ChecklistPanel({ items, checks, onToggle, disabled, title = '체크', defaultOpen }: Props) {
  const [pending, setPending] = useState<Record<string, boolean>>({});

  if (items.length === 0) return null;

  const isOn = (label: string) => (label in pending ? pending[label] : !!checks[label]);
  const done = items.filter((i) => isOn(i.label)).length;

  async function toggle(label: string, on: boolean) {
    setPending((p) => ({ ...p, [label]: on }));
    const ok = await onToggle(label, on);
    // 저장이 끝나면 서버 값을 따라감(실패하면 원래대로)
    setPending((p) => {
      const n = { ...p };
      delete n[label];
      return n;
    });
    return ok;
  }

  return (
    <details className="sc-check" open={defaultOpen}>
      <summary>
        {title} <b className={done >= items.length ? 'done' : ''}>{done}/{items.length}</b>
      </summary>
      <div className="sc-check-list">
        {items.map((i) => {
          const c = checks[i.label];
          return (
            <label key={i.label} className="toggle sc-check-item">
              <input type="checkbox" checked={isOn(i.label)} disabled={disabled} onChange={(e) => void toggle(i.label, e.target.checked)} />
              <span>{i.label}</span>
              {c && !(i.label in pending) && (
                <span className="sc-muted">
                  {c.by} {fmtDateTime(c.at)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </details>
  );
}
