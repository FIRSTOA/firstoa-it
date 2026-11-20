import { Fragment } from 'react';

/** 설명서 글 안의 꾸밈 — **굵게**, `버튼 이름`(화면 버튼 모양 알약). 나머지는 글자 그대로. */
const TOKEN = /(\*\*[^*]+?\*\*|`[^`]+?`)/g;

export default function ManualInline({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i}>
              <ManualInline text={part.slice(2, -2)} />
            </strong>
          );
        }
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return (
            <span key={i} className="mn-ui">
              {part.slice(1, -1)}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
