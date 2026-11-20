import type { ManualBlock } from '@/lib/manual/types';
import ManualInline from './ManualInline';

/** 설명서 블록 그리기(서버에서 그림 — 상태 없음). 형식은 lib/manual/types.ts */
export default function ManualBlocks({ blocks }: { blocks: ManualBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  );
}

function Block({ block: b }: { block: ManualBlock }) {
  switch (b.t) {
    case 'p':
      return (
        <p className="mn-p">
          <ManualInline text={b.text} />
        </p>
      );
    case 'steps':
      return (
        <ol className="mn-steps">
          {b.items.map((x, i) => (
            <li key={i}>
              <span className="mn-step-no" aria-hidden>
                {i + 1}
              </span>
              <span>
                <ManualInline text={x} />
              </span>
            </li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className="mn-list-dots">
          {b.items.map((x, i) => (
            <li key={i}>
              <ManualInline text={x} />
            </li>
          ))}
        </ul>
      );
    case 'tip': {
      const warn = b.tone === 'warn';
      return (
        <div className={`mn-tip${warn ? ' warn' : ''}`}>
          <span className="mn-tip-badge">{warn ? '주의' : '팁'}</span>
          <div>
            <ManualInline text={b.text} />
          </div>
        </div>
      );
    }
    case 'buttons':
      return (
        <div className="mn-buttons">
          {b.items.map((x, i) => (
            <div key={i} className="mn-button-row">
              <div className="mn-button-cell">
                <span className={`mn-fake mn-fake-${x.style ?? 'ghost'}`}>{x.label}</span>
              </div>
              <div className="mn-button-text">
                <ManualInline text={x.text} />
              </div>
            </div>
          ))}
        </div>
      );
    case 'table':
      return (
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i}>
                    <ManualInline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <ManualInline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'compare':
      return (
        <div className="mn-compare">
          <div className="mn-compare-card before">
            <div className="mn-compare-tag">예전엔</div>
            <div className="mn-compare-title">
              <ManualInline text={b.before.title} />
            </div>
            <ul>
              {b.before.items.map((x, i) => (
                <li key={i}>
                  <ManualInline text={x} />
                </li>
              ))}
            </ul>
          </div>
          <div className="mn-compare-arrow" aria-hidden>
            →
          </div>
          <div className="mn-compare-card after">
            <div className="mn-compare-tag">지금은</div>
            <div className="mn-compare-title">
              <ManualInline text={b.after.title} />
            </div>
            <ul>
              {b.after.items.map((x, i) => (
                <li key={i}>
                  <ManualInline text={x} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    case 'faq':
      return (
        <div className="mn-faq">
          {b.items.map((x, i) => (
            <details key={i} className="mn-faq-item">
              <summary>
                <span className="mn-faq-q">Q</span>
                <ManualInline text={x.q} />
              </summary>
              <div className="mn-faq-a">
                <ManualInline text={x.a} />
              </div>
            </details>
          ))}
        </div>
      );
    default:
      return null;
  }
}
