import { manualGroupLabel } from '@/lib/manual';
import type { ManualDoc } from '@/lib/manual/types';
import ManualBlocks from './ManualBlocks';
import ManualDocActions from './ManualDocActions';
import ManualInline from './ManualInline';
import ManualToc, { type TocItem } from './ManualToc';

/** 문서 안 꼭지 주소(#…) — 다른 화면 요소 id 와 안 겹치게 앞에 붙임 */
const anchor = (id: string) => `mn-${id}`;

/** 설명서 한 화면 — 검은 소개 상자 · "이 화면이 해 주는 것" 색 카드 · 번호 꼭지. 서버에서 그림. */
export default function ManualDocView({ doc }: { doc: ManualDoc }) {
  const highlights = (doc.highlights ?? []).slice(0, 4);
  const toc: TocItem[] = [
    ...(highlights.length > 0 ? [{ id: anchor('highlights'), title: '이 화면이 해 주는 것' }] : []),
    ...doc.sections.map((s, i) => ({
      id: anchor(s.id),
      title: `${i + 1}. ${s.title}`,
      sub: s.sub?.map((x) => ({ id: anchor(x.id), title: x.title })),
    })),
  ];

  return (
    <article className="mn-doc">
      <header className="mn-doc-bar">
        <div className="mn-doc-bar-title">
          <span aria-hidden>{doc.icon}</span>
          {doc.title}
        </div>
        <ManualDocActions docKey={doc.key} href={doc.href} />
      </header>

      <div className="mn-doc-body">
        <ManualToc items={toc} />

        <div className="mn-content">
          <section className="mn-hero">
            <div className="mn-hero-eyebrow">
              퍼스트전산 IT 웹앱 · {manualGroupLabel(doc.group)}
            </div>
            <h2 className="mn-hero-title">{doc.title} 길잡이</h2>
            <p className="mn-hero-intro">
              <ManualInline text={doc.intro} />
            </p>
            {doc.tags && doc.tags.length > 0 && (
              <div className="mn-hero-tags">
                {doc.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
          </section>

          {highlights.length > 0 && (
            <section className="mn-sec" id={anchor('highlights')}>
              <h3 className="mn-h3">이 화면이 해 주는 것</h3>
              <div className="mn-hl-grid">
                {highlights.map((h, i) => (
                  <div key={i} className={`mn-hl mn-hl-${i % 4}`}>
                    <div className="mn-hl-label">{h.label}</div>
                    <div className="mn-hl-value">{h.value}</div>
                    <div className="mn-hl-note">
                      <ManualInline text={h.note} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {doc.sections.map((s, i) => (
            <section key={s.id} className="mn-sec" id={anchor(s.id)}>
              <h3 className="mn-h3">
                <span className="mn-h3-no">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </h3>
              <ManualBlocks blocks={s.blocks} />
              {s.sub?.map((x) => (
                <div key={x.id} className="mn-sub" id={anchor(x.id)}>
                  <h4 className="mn-h4">{x.title}</h4>
                  <ManualBlocks blocks={x.blocks} />
                </div>
              ))}
            </section>
          ))}

          <footer className="mn-foot">
            이 설명서는 {doc.updated} 기준이에요. 화면과 다른 곳이 있으면 홈 아래 피드백 게시판에 알려 주세요.
          </footer>
        </div>
      </div>
    </article>
  );
}
