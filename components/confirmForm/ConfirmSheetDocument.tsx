'use client';

import { blockCells, type ConfirmDoc } from '@/lib/confirmSheet';
import type { PrintCell, PrintGrid } from '@/lib/confirmSheetServer';

const DEFAULT_COL_W = [100, 100, 100, 100, 139, 100, 176, 100];
const FONT = '"맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

/**
 * 확인서 인쇄 화면 — 시트 탭의 칸 값·배경색·병합·폭·글자 크기를 **시트와 같은 크기(px·pt)**로
 * 그리고, 출고시(기재사항) 칸은 지금 편집 중인 값으로 덮어씁니다. 종이에 맞추는 축소는 인쇄 직전에
 * 바깥에서 zoom으로 합니다(폭을 줄여 그리면 글자가 잘게 줄바꿈돼서).
 * 시트 탭이 없는(붙여넣기) 문서는 칸 값만 테두리 표로.
 */
export default function ConfirmSheetDocument({ doc, grid }: { doc: ConfirmDoc; grid: PrintGrid | null }) {
  const base: PrintCell[][] = grid
    ? grid.rows.map((r) => r.map((c) => ({ ...c })))
    : doc.grid.map((r) => Array.from({ length: 8 }, (_, c) => ({ v: r[c] ?? '', valign: 'middle' })));
  for (const b of doc.blocks) {
    if (b.row <= 0) continue;
    for (const c of blockCells(b)) {
      while (base.length <= c.r) base.push(Array.from({ length: 8 }, () => ({ v: '' })));
      base[c.r][c.c] = { ...base[c.r][c.c], v: c.v };
    }
  }
  const merges = grid?.merges ?? [];
  const covered = new Set<string>();
  const spanAt = new Map<string, { rs: number; cs: number }>();
  for (const m of merges) {
    spanAt.set(`${m.r0}:${m.c0}`, { rs: m.r1 - m.r0, cs: m.c1 - m.c0 });
    for (let r = m.r0; r < m.r1; r++) for (let c = m.c0; c < m.c1; c++) if (r !== m.r0 || c !== m.c0) covered.add(`${r}:${c}`);
  }
  const colW = grid?.colW?.length === 8 ? grid.colW : DEFAULT_COL_W;
  const totalW = colW.reduce((a, b) => a + b, 0);

  if (!base.length) {
    return <div style={{ padding: 20, color: '#64748b' }}>인쇄할 확인서 칸 값이 없어요(사진으로 불러온 문서).</div>;
  }

  return (
    <table
      style={{
        width: totalW,
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        fontFamily: FONT,
        fontSize: '10pt',
        color: '#000',
        background: '#fff',
      }}
    >
      <colgroup>
        {colW.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {base.map((row, r) => (
          <tr key={r} style={{ height: grid?.rowH?.[r] ?? 21, breakInside: 'avoid' }}>
            {row.map((c, ci) => {
              const k = `${r}:${ci}`;
              if (covered.has(k)) return null;
              const span = spanAt.get(k);
              // 시트 기본값(아래)은 줄 높이가 낮아 티가 안 나지만, 여기선 칸이 내용만큼 커져서
              // 항목명이 바닥에 붙어 보임 → 위로 지정한 칸만 위, 나머지는 가운데
              const valign = c.valign === 'top' ? 'top' : 'middle';
              return (
                <td
                  key={ci}
                  rowSpan={span?.rs}
                  colSpan={span?.cs}
                  style={{
                    border: '1px solid #000',
                    padding: '1px 3px',
                    background: c.bg ?? '#fff',
                    fontWeight: c.bold ? 700 : 400,
                    textAlign: (c.align === 'center' || c.align === 'right' ? c.align : grid ? 'left' : 'center') as 'left' | 'center' | 'right',
                    fontSize: c.size ? `${c.size}pt` : undefined,
                    color: c.color,
                    whiteSpace: c.nowrap ? 'pre' : 'pre-wrap',
                    // 한글은 단어 단위로 줄바꿈(시트처럼), 너무 긴 단어만 칸 안에서 끊음
                    wordBreak: 'keep-all',
                    overflowWrap: 'anywhere',
                    verticalAlign: valign,
                    lineHeight: 1.25,
                    overflow: 'hidden',
                  }}
                >
                  {c.v}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
