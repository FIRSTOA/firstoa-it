'use client';

import { blockCells, type ConfirmDoc } from '@/lib/confirmSheet';
import type { PrintCell, PrintGrid } from '@/lib/confirmSheetServer';

/**
 * 확인서 인쇄 화면 — 시트 탭의 칸 값·배경색·병합·폭을 그대로 그리고, 출고시(기재사항) 칸은
 * 지금 편집 중인 값으로 덮어씁니다. 시트 탭이 없는(붙여넣기) 문서는 칸 값만 테두리 표로.
 */
export default function ConfirmSheetDocument({ doc, grid }: { doc: ConfirmDoc; grid: PrintGrid | null }) {
  const base: PrintCell[][] = grid
    ? grid.rows.map((r) => r.map((c) => ({ ...c })))
    : doc.grid.map((r) => Array.from({ length: 8 }, (_, c) => ({ v: r[c] ?? '' })));
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
  const colW = grid?.colW?.length === 8 ? grid.colW : [90, 160, 140, 140, 140, 140, 140, 130];
  const totalW = colW.reduce((a, b) => a + b, 0);

  if (!base.length) {
    return <div style={{ padding: 20, color: '#64748b' }}>인쇄할 확인서 칸 값이 없어요(사진으로 불러온 문서).</div>;
  }

  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        fontSize: 11,
        color: '#111',
        background: '#fff',
      }}
    >
      <colgroup>
        {colW.map((w, i) => (
          <col key={i} style={{ width: `${(w / totalW) * 100}%` }} />
        ))}
      </colgroup>
      <tbody>
        {base.map((row, r) => (
          <tr key={r} style={{ height: grid?.rowH?.[r] ? Math.max(18, grid.rowH[r] * 0.85) : undefined }}>
            {row.map((c, ci) => {
              const k = `${r}:${ci}`;
              if (covered.has(k)) return null;
              const span = spanAt.get(k);
              return (
                <td
                  key={ci}
                  rowSpan={span?.rs}
                  colSpan={span?.cs}
                  style={{
                    border: '1px solid #333',
                    padding: '2px 4px',
                    background: c.bg ?? '#fff',
                    fontWeight: c.bold ? 700 : 400,
                    textAlign: (c.align === 'center' || c.align === 'right' ? c.align : grid ? 'left' : 'center') as 'left' | 'center' | 'right',
                    fontSize: c.size ? Math.max(8, Math.min(20, c.size * 1.15)) : undefined,
                    color: c.color,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    verticalAlign: 'middle',
                    lineHeight: 1.3,
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
