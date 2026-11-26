import { isBlank } from './unknownValueHelpers';

/** 모양을 모르는 값(문자열·숫자·목록·객체)을 안전하게 읽기 좋게 — 깊이 4까지(교체 건 before/after 읽기용) */
export default function UnknownValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isBlank(value)) return <div className="detail-empty">-</div>;
  if (typeof value === 'string') return <div className="sc-pre">{value}</div>;
  if (typeof value === 'number' || typeof value === 'boolean') return <div className="sc-pre">{String(value)}</div>;
  if (depth >= 4) return <div className="sc-pre">(내용이 너무 깊어서 줄였어요)</div>;
  if (Array.isArray(value)) {
    return (
      <ul className="sc-unk-list">
        {value
          .filter((v) => !isBlank(v))
          .map((v, i) => (
            <li key={i}>
              <UnknownValue value={v} depth={depth + 1} />
            </li>
          ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => !isBlank(v));
    return (
      <dl className="sc-unk-dl">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <UnknownValue value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <div className="sc-pre">{String(value)}</div>;
}
