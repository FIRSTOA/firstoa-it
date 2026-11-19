'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 필터 칩 줄(.filter-row 들)을 감싸서 핸드폰(≤640px)에서만 "필터" 버튼 하나로 접음 — 목록이 바로 보이게.
 * PC에선 버튼이 안 보이고 그대로 펼쳐져 있음(globals.css .m-filter-*).
 * 켜진 필터 수는 "전체"가 아닌 선택된 칩(.chip.active)을 세서 버튼에 표시.
 */
export default function MobileFilterRows({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const chips = ref.current?.querySelectorAll('.chip.active') ?? [];
    const n = Array.from(chips).filter((c) => c.textContent?.trim() !== '전체').length;
    if (n !== active) setActive(n);
  });

  return (
    <>
      <button type="button" className="m-filter-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>⚙︎ 필터</span>
        {active > 0 && <span className="m-filter-count">{active}개 적용</span>}
        <span className="m-filter-caret">{open ? '접기 ▴' : '펼치기 ▾'}</span>
      </button>
      <div ref={ref} className={`m-filter-rows${open ? ' open' : ''}`}>
        {children}
      </div>
    </>
  );
}
