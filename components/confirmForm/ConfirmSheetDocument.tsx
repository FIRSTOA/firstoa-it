'use client';

import type { CSSProperties } from 'react';
import { blockCells, requestModelsFromUnits, type ConfirmBlock, type ConfirmDoc, type ConfirmUnit } from '@/lib/confirmSheet';
import type { PrintCell, PrintGrid } from '@/lib/confirmSheetServer';

/** 인쇄 양식 — table: 출고시 칸을 대수별 표로(제조사·모델명·자산번호·시리얼·사양), sheet: 시트 모양 그대로 */
export type PrintLayout = 'table' | 'sheet';

const DEFAULT_COL_W = [100, 100, 100, 100, 139, 100, 176, 100];
const FONT = '"맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

/**
 * 확인서 인쇄 화면 — 시트 탭의 칸 값·배경색·병합·폭·글자 크기를 **시트와 같은 크기(px·pt)**로
 * 그리고, 출고시(기재사항) 칸은 지금 편집 중인 값으로 덮어씁니다. 종이에 맞추는 축소는 인쇄 직전에
 * 바깥에서 zoom으로 합니다(폭을 줄여 그리면 글자가 잘게 줄바꿈돼서).
 * 표 양식(layout='table')이면 "작성시/출고시" 부분만 대수별 표로 바꿔 그립니다(시트는 그대로).
 * 시트 탭이 없는(붙여넣기) 문서는 칸 값만 테두리 표로.
 */
export default function ConfirmSheetDocument({
  doc,
  grid,
  layout = 'table',
}: {
  doc: ConfirmDoc;
  grid: PrintGrid | null;
  layout?: PrintLayout;
}) {
  const base: PrintCell[][] = grid
    ? grid.rows.map((r) => r.map((c) => ({ ...c })))
    : doc.grid.map((r) => Array.from({ length: 8 }, (_, c) => ({ v: r[c] ?? '', valign: 'middle' })));
  for (const b of doc.blocks) {
    if (b.row <= 0) continue;
    for (const c of blockCells(b, doc.cellMode)) {
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
  const region = layout === 'table' ? blockRegion(base, merges) : null;

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
        {base.map((row, r) => {
          if (region && r > region.start && r < region.end) return null;
          if (region && r === region.start) {
            return (
              <tr key={r}>
                <td colSpan={8} style={{ padding: 0, border: '1px solid #000' }}>
                  <ShipmentTable doc={doc} base={base} heading={[row[0]?.v ?? '', row[4]?.v ?? '']} />
                </td>
              </tr>
            );
          }
          return (
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
                      // 시트에선 옆 칸으로 넘쳐 보이는(넘침·자르기) 칸도 종이에선 잘리니 전부 칸 안에서 줄바꿈
                      whiteSpace: 'pre-wrap',
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
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * 표 양식으로 바꿔 그릴 줄 범위 — "작성시 (요청사항)" 줄부터 마지막 품목 묶음(6줄) 끝까지.
 * 병합이 범위 밖으로 걸치면 범위를 늘려서 칸이 어긋나지 않게.
 */
function blockRegion(base: PrintCell[][], merges: { r0: number; r1: number }[]): { start: number; end: number } | null {
  const start = base.findIndex((row) => /작성시/.test(row[0]?.v ?? ''));
  if (start < 0) return null;
  let last = -1;
  for (let i = start + 1; i < base.length; i++) {
    if (/^구\s*분$/.test((base[i][0]?.v ?? '').trim()) && (base[i][4]?.v ?? '').trim() === '제조사') last = i;
  }
  if (last < 0) return null;
  let end = Math.min(base.length, last + 6);
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of merges) {
      if (m.r0 >= start && m.r0 < end && m.r1 > end) {
        end = m.r1;
        grew = true;
      }
    }
  }
  return { start, end };
}

// 시트와 같은 색 — 항목명(진한 살구), 출고시 값(옅은 살구), 요청 값(흰색)
const LABEL_BG = '#fbc9b3';
const OUT_BG = '#fde3d7';
// 구분 · 품목 · 수량 | 제조사 · 모델명 · 자산번호 · 시리얼 · 사양 (합 915 = 시트 폭)
const TABLE_COL_W = [70, 150, 45, 90, 140, 75, 150, 195];
const TABLE_W = TABLE_COL_W.reduce((a, b) => a + b, 0);
const HEADERS = ['구 분', '품목', '수량', '제조사', '모델명', '자산번호', '시리얼', '사양'];

const cellStyle = (extra: CSSProperties = {}): CSSProperties => ({
  border: '1px solid #000',
  padding: '2px 4px',
  textAlign: 'center',
  verticalAlign: 'middle',
  whiteSpace: 'pre-wrap',
  wordBreak: 'keep-all',
  overflowWrap: 'anywhere',
  lineHeight: 1.25,
  fontSize: '10.5pt',
  ...extra,
});
/** 항목명·출고시 값 칸 색 — 탭마다 양식 색이 달라서(살구/연두) 그 탭의 첫 묶음 칸 색을 따름 */
type Palette = { label: string; out: string };
const labelStyle = (pal: Palette, extra: CSSProperties = {}) =>
  cellStyle({ background: pal.label, fontWeight: 700, fontSize: '11pt', ...extra });

/** 모델명에서 제조사 머리말 떼기("삼성 S27F354FHK" → "S27F354FHK") */
function modelOnly(model: string, brand: string): string {
  const m = model.trim();
  const b = brand.trim();
  return b && m.startsWith(`${b} `) ? m.slice(b.length + 1).trim() : m;
}

/**
 * 요청사항 칸 값이 우리가 적은 모델명 목록인지 — 줄마다(×대수 떼고) 기기 모델명과 같으면(제조사
 * 머리말 있든 없든) 우리 것. 인쇄 표엔 모델명 칸이 따로 있어서 왼쪽 요청사항에선 뺌.
 */
function isOwnModelList(b: ConfirmBlock): boolean {
  const req = b.request.trim();
  if (!req) return true;
  if (req === requestModelsFromUnits(b.units, b.manufacturer)) return true;
  const known = new Set<string>();
  for (const u of b.units) {
    const m = (u.model ?? '').trim();
    if (!m) continue;
    known.add(m.toUpperCase());
    known.add(modelOnly(m, u.brand ?? '').toUpperCase());
    known.add(modelOnly(m, b.manufacturer).toUpperCase());
  }
  if (!known.size) return false;
  return req
    .split('\n')
    .map((l) => l.replace(/\s*×\s*\d+\s*$/, '').trim().toUpperCase())
    .filter(Boolean)
    .every((l) => known.has(l));
}

/** 출고시(기재사항)를 대수별 표로 — 왼쪽은 영업 요청(품목·수량·요청사항), 오른쪽은 실제 나간 장비 */
function ShipmentTable({ doc, base, heading }: { doc: ConfirmDoc; base: PrintCell[][]; heading: [string, string] }) {
  const first = doc.blocks.find((b) => b.row > 0);
  const pal: Palette = {
    label: (first && base[first.row - 1]?.[0]?.bg) || LABEL_BG,
    out: (first && base[first.row - 1]?.[5]?.bg) || OUT_BG,
  };
  return (
    // 바깥 테두리는 감싼 칸(td)이 그리고, 안쪽 표는 안쪽 선만(hidden) — 선이 두 겹 안 되게
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderStyle: 'hidden' }}>
      <colgroup>
        {TABLE_COL_W.map((w, i) => (
          <col key={i} style={{ width: `${(w / TABLE_W) * 100}%` }} />
        ))}
      </colgroup>
      <tbody>
        <tr style={{ height: 24 }}>
          <td colSpan={3} style={labelStyle(pal)}>
            {heading[0] || '작성시 (요청사항)'}
          </td>
          <td colSpan={5} style={labelStyle(pal)}>
            {heading[1] || '출고시 (기재사항)'}
          </td>
        </tr>
      </tbody>
      {doc.blocks
        .filter((b) => b.row > 0)
        .map((b) => (
          <BlockRows key={b.row} b={b} base={base} pal={pal} />
        ))}
    </table>
  );
}

function BlockRows({ b, base, pal }: { b: ConfirmBlock; base: PrintCell[][]; pal: Palette }) {
  const r = b.row - 1;
  const filled = b.units.filter((u) => u.assetId.trim() || u.serial.trim() || (u.model ?? '').trim());
  // 아직 안 채운 대수만큼은 빈 줄(손으로 적을 수 있게)
  const n = Math.max(filled.length, b.quantity, 1);
  const rows: (ConfirmUnit | null)[] = [...filled, ...Array.from({ length: n - filled.length }, () => null)];
  const singleBrand = /[\n/]/.test(b.manufacturer) ? '' : b.manufacturer.trim();
  // [납품사양]이 한 가지면(요약의 "×대수"는 떼고) 그게 확인서에 적은 사양 — 지금 IT재고 사양보다 우선
  // (지난 확인서를 다시 뽑을 때 그사이 바뀐 재고 사양이 나오지 않게). 여러 가지면 기기별 사양.
  const specLines = [
    ...new Set(
      b.deliverySpec
        .split('\n')
        .map((s) => s.replace(/\s*×\s*\d+\s*$/, '').trim())
        .filter(Boolean),
    ),
  ];
  const blockSpec = specLines.length === 1 ? specLines[0] : '';
  // 요청사항 칸에 우리가 적은 모델명은 오른쪽 모델명 칸과 겹치니 빼고, 영업이 적은 것만
  const request = isOwnModelList(b) ? '' : b.request.trim();
  const hw = b.requestHardware.trim();
  const software = base[r + 4]?.[5]?.v?.trim() ?? '';
  const softwareHint = base[r + 5]?.[5]?.v?.trim() || 'WIN 및 기타 프로그램';

  // 요청사항은 품목 줄 아래부터 소프트웨어 두 줄까지 세로로 이어짐
  const requestCells = (
    <>
      <td rowSpan={n + 1} style={labelStyle(pal)}>
        요청사항
      </td>
      <td rowSpan={n + 1} colSpan={2} style={cellStyle({ textAlign: 'left', verticalAlign: 'top' })}>
        {request}
        {hw && (
          <div style={{ marginTop: request ? 6 : 0 }}>
            <b>하드웨어</b> {hw}
          </div>
        )}
      </td>
    </>
  );

  const unitCells = (u: ConfirmUnit | null) => {
    const brand = u ? (u.brand ?? '').trim() || singleBrand : '';
    return (
      <>
        <td style={cellStyle({ background: pal.out })}>{brand}</td>
        <td style={cellStyle({ background: pal.out })}>{u ? modelOnly(u.model ?? '', brand) : ''}</td>
        <td style={cellStyle({ background: pal.out, fontWeight: 700 })}>{u?.assetId ?? ''}</td>
        <td style={cellStyle({ background: pal.out })}>{u?.serial ?? ''}</td>
        <td style={cellStyle({ background: pal.out })}>{u ? blockSpec || (u.spec ?? '').trim() : ''}</td>
      </>
    );
  };

  return (
    <tbody style={{ breakInside: 'avoid' }}>
      <tr style={{ height: 24 }}>
        {HEADERS.map((h) => (
          <td key={h} style={labelStyle(pal)}>
            {h}
          </td>
        ))}
      </tr>
      {rows.map((u, k) => (
        <tr key={k} style={{ height: 24 }}>
          {k === 0 && (
            <>
              <td style={labelStyle(pal)}>품목</td>
              <td style={cellStyle({ fontWeight: 700, fontSize: '11pt' })}>{b.item}</td>
              <td style={cellStyle({ fontWeight: 700, fontSize: '11pt' })}>{b.quantity || ''}</td>
            </>
          )}
          {k === 1 && requestCells}
          {unitCells(u)}
        </tr>
      ))}
      <tr style={{ height: 28 }}>
        {n === 1 && requestCells}
        <td rowSpan={2} style={labelStyle(pal, { whiteSpace: 'nowrap', fontSize: '10.5pt' })}>
          소프트웨어
        </td>
        <td colSpan={4} style={cellStyle({ background: pal.out })}>
          {software}
        </td>
      </tr>
      <tr style={{ height: 22 }}>
        <td colSpan={4} style={labelStyle(pal, { fontSize: '10pt' })}>
          {softwareHint}
        </td>
      </tr>
    </tbody>
  );
}
