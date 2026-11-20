'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';

export type TocItem = { id: string; title: string; sub?: { id: string; title: string }[] };

/**
 * 설명서 안 목차 — 왼쪽에 붙어 있고, 읽는 곳에 맞춰 지금 꼭지를 진하게.
 * 화면이 스크롤되는 곳은 창이 아니라 Shell 의 .content-scroll 이라 그 상자를 봄.
 */
export default function ManualToc({ items }: { items: TocItem[] }) {
  const ids = items.flatMap((i) => [i.id, ...(i.sub ?? []).map((s) => s.id)]);
  const sig = ids.join('|');
  const [active, setActive] = useState(ids[0] ?? '');
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const list = sig ? sig.split('|') : [];
    const box = navRef.current?.closest<HTMLElement>('.content-scroll') ?? null;
    const target: HTMLElement | Window = box ?? window;
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = (box ? box.getBoundingClientRect().top : 0) + 110;
      let cur = list[0] ?? '';
      for (const id of list) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) cur = id;
        else break;
      }
      setActive(cur);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sig]);

  function go(e: MouseEvent<HTMLAnchorElement>, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
    try {
      window.history.replaceState(window.history.state, '', `#${id}`);
    } catch {
      /* 주소 바꾸기 실패 — 이동은 됨 */
    }
  }

  return (
    <nav className="mn-toc" ref={navRef} aria-label="이 설명서 목차">
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <a href={`#${it.id}`} className={active === it.id ? 'on' : undefined} onClick={(e) => go(e, it.id)}>
              {it.title}
            </a>
            {it.sub && it.sub.length > 0 && (
              <ul>
                {it.sub.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className={active === s.id ? 'on' : undefined} onClick={(e) => go(e, s.id)}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
