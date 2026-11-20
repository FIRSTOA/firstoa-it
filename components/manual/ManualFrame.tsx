'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { ManualDocMeta } from '@/lib/manual';
import type { ManualGroupKey } from '@/lib/manual/types';

type Props = {
  groups: { key: ManualGroupKey; label: string }[];
  docs: ManualDocMeta[];
  defaultKey: string;
  children: ReactNode;
};

/**
 * 사용설명서 틀(app/manual/layout.tsx 에서 씀 — 설명서를 바꿔도 이 틀은 그대로라 펼친 묶음이 유지됨).
 * PC: 왼쪽 묶음별 설명서 카드 + 오른쪽 설명서. 핸드폰: 목록은 "설명서 목록" 버튼 안으로 접힘.
 */
export default function ManualFrame({ groups, docs, defaultKey, children }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/')[2];
  const currentKey = seg ? decodeURIComponent(seg) : defaultKey;
  const current = docs.find((d) => d.key === currentKey) ?? docs.find((d) => d.key === defaultKey) ?? docs[0];

  const [openGroups, setOpenGroups] = useState<Set<ManualGroupKey>>(() => new Set(current ? [current.group] : []));
  const [pickerOpen, setPickerOpen] = useState(false);

  // 다른 설명서로 넘어가면 그 묶음을 펴고, 핸드폰 목록은 닫음
  useEffect(() => {
    if (!current) return;
    setOpenGroups((prev) => (prev.has(current.group) ? prev : new Set(prev).add(current.group)));
    setPickerOpen(false);
  }, [current]);

  function toggle(g: ManualGroupKey) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  return (
    <div className="mn">
      <header className="mn-banner">
        <div className="mn-banner-title">📖 사용설명서</div>
        <div className="mn-banner-sub">IT 웹앱 전체 사용설명서 — 화면별로 버튼 하나하나, 처음 쓰는 분 기준 · 링크는 로그인 없이 열려요</div>
      </header>

      <div className="mn-layout">
        <aside className="mn-side">
          <button type="button" className="mn-picker-btn" aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)}>
            <span className="mn-picker-label">📚 설명서 목록</span>
            <span className="mn-picker-now">
              {current ? `${current.icon} ${current.title}` : ''}
            </span>
            <span aria-hidden>{pickerOpen ? '▲' : '▼'}</span>
          </button>

          <div className={`mn-list${pickerOpen ? ' open' : ''}`}>
            {groups.map((g) => {
              const items = docs.filter((d) => d.group === g.key);
              if (items.length === 0) return null;
              const open = openGroups.has(g.key);
              return (
                <div key={g.key} className="mn-group">
                  <button type="button" className="mn-group-head" aria-expanded={open} onClick={() => toggle(g.key)}>
                    <span>
                      {g.label} <em>{items.length}</em>
                    </span>
                    <span className="mn-group-sign" aria-hidden>
                      {open ? '−' : '+'}
                    </span>
                  </button>
                  {open && (
                    <ul className="mn-cards">
                      {items.map((d) => {
                        const on = current?.key === d.key;
                        return (
                          <li key={d.key}>
                            <Link
                              href={`/manual/${d.key}`}
                              className={`mn-card${on ? ' active' : ''}`}
                              aria-current={on ? 'page' : undefined}
                            >
                              <div className="mn-card-title">
                                <span aria-hidden>{d.icon}</span>
                                {d.title}
                              </div>
                              <div className="mn-card-sum">{d.summary}</div>
                              <div className="mn-card-date">{d.updated} 갱신</div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="mn-main">{children}</div>
      </div>
    </div>
  );
}
