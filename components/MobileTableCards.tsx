'use client';

import { useEffect } from 'react';

/**
 * 핸드폰(≤640px)에서 목록 표를 카드로 — `table.m-cards` 의 머리줄(<th>) 이름·역할을 각 칸(<td>)에 옮겨 적음.
 * 실제 모양은 globals.css 의 "핸드폰 카드 표" 부분이 data-ml(이름)·data-mr(역할)을 보고 그림.
 *
 * 표마다 할 일은 <table className="m-cards"> + 필요한 <th data-m="…"> 뿐:
 *   title   카드 맨 위 굵은 제목(자산번호·상호 등)      badge  제목 줄 오른쪽(상태 배지)
 *   check   제목 줄 맨 앞(선택 체크박스)                inline 제목 아래 한 줄로 이어 붙임(브랜드 모델명)
 *   full    한 줄 통째로(이름 표시)                     sub    한 줄 통째로, 이름 없이 흐린 글씨
 *   actions 맨 아래 오른쪽 버튼들                       hide   핸드폰에선 숨김
 *   nolabel 이름 빼기(다른 역할과 같이: "full nolabel")
 * 아무것도 안 적은 칸은 반 칸 너비로 "이름 / 값".
 * 여러 칸을 합친 줄(colSpan, 빈 목록 안내 등)은 자동으로 한 줄 통째로.
 */
const MOBILE = '(max-width: 640px)';
const doneRows = new WeakMap<HTMLTableRowElement, string>();

function headerColumns(table: HTMLTableElement): { label: string; role: string }[] {
  const head = table.tHead;
  const row = head?.rows[head.rows.length - 1];
  const cols: { label: string; role: string }[] = [];
  if (!row) return cols;
  for (const th of Array.from(row.cells)) {
    const label = (th.dataset.label ?? th.textContent ?? '').replace(/[▲▼↑↓⇅]/g, '').trim();
    const role = th.dataset.m ?? '';
    for (let i = 0; i < Math.max(1, th.colSpan); i++) cols.push({ label, role });
  }
  return cols;
}

function labelTable(table: HTMLTableElement) {
  const cols = headerColumns(table);
  const sig = cols.map((c) => `${c.label}\u0001${c.role}`).join('\u0002');
  const sections = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const section of sections) {
    for (const tr of Array.from(section.rows)) {
      if (doneRows.get(tr) === sig && tr.cells.length === Number(tr.dataset.mCells)) continue;
      let col = 0;
      for (const td of Array.from(tr.cells)) {
        const span = Math.max(1, td.colSpan);
        if (span > 1) {
          td.dataset.ml = '';
          td.dataset.mr = 'full nolabel';
        } else {
          const c = cols[col];
          td.dataset.ml = c?.label ?? '';
          td.dataset.mr = c?.role ?? '';
        }
        // 값이 없거나 "-" 뿐인 칸은 카드에서 뺌(버튼·입력칸이 있으면 그대로)
        const text = td.textContent?.trim() ?? '';
        const blank = (text === '' || text === '-') && !td.querySelector('input,select,textarea,button,img,svg,a');
        if (blank) td.dataset.mEmpty = '';
        else delete td.dataset.mEmpty;
        col += span;
      }
      tr.dataset.mCells = String(tr.cells.length);
      doneRows.set(tr, sig);
    }
  }
}

export default function MobileTableCards() {
  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    let frame = 0;
    const run = () => {
      frame = 0;
      document.querySelectorAll<HTMLTableElement>('table.m-cards').forEach(labelTable);
    };
    const schedule = () => {
      if (!mq.matches || frame) return;
      frame = requestAnimationFrame(run);
    };
    // 목록은 필터·불러오기·이어 그리기(앞 120줄 먼저)로 계속 바뀌므로 바뀔 때마다 새 줄·내용이 바뀐 줄만 다시 적음
    const observer = new MutationObserver((mutations) => {
      if (!mq.matches) return;
      for (const m of mutations) {
        const el = m.target instanceof Element ? m.target : m.target.parentElement;
        const tr = el?.closest('table.m-cards tr');
        if (tr) doneRows.delete(tr as HTMLTableRowElement);
      }
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    mq.addEventListener('change', schedule);
    schedule();
    return () => {
      observer.disconnect();
      mq.removeEventListener('change', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
