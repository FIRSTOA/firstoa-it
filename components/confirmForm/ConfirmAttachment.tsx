'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ConfirmDoc } from '@/lib/confirmSheet';

const FONT = '"맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const th: CSSProperties = { border: '1px solid #000', padding: '4px 6px', background: '#f4cccc', fontWeight: 700, textAlign: 'center', color: '#000', fontSize: '9.5pt', textTransform: 'none', letterSpacing: 0 };
const td: CSSProperties = { border: '1px solid #000', padding: '3px 6px', verticalAlign: 'middle', wordBreak: 'break-all' };

/**
 * 확인서 별첨 — 대수별 출고 명세(자산번호·모델명·S/N·사양). 데스크탑이거나 3대 넘는 품목은
 * 확인서 칸에 다 안 들어가서 인쇄할 때 2장째로 붙입니다. 시트에는 안 남기고 인쇄 전용.
 * A4 안쪽 폭(194mm ≈ 733px)에 맞춘 크기라 따로 줄이지 않고, 길면 머리줄을 반복하며 다음 장으로.
 */
export default function ConfirmAttachment({ doc }: { doc: ConfirmDoc }) {
  const blocks = doc.blocks.filter((b) => b.units.some((u) => u.assetId.trim() || u.serial.trim()));
  const total = blocks.reduce((n, b) => n + b.units.filter((u) => u.assetId.trim() || u.serial.trim()).length, 0);
  let no = 0;
  return (
    <div style={{ width: 733, fontFamily: FONT, fontSize: '9.5pt', color: '#000' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', borderBottom: '2px solid #000', paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ fontSize: '16pt', fontWeight: 800, flex: 1 }}>출고 명세 (별첨)</div>
        <div style={{ fontSize: '9pt' }}>{doc.formNo && `순번 ${doc.formNo}`}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10, fontSize: '9.5pt' }}>
        <tbody>
          <tr>
            <td style={{ ...th, width: 70 }}>상 호</td>
            <td style={td}>{doc.company}</td>
            <td style={{ ...th, width: 70 }}>납품일</td>
            <td style={{ ...td, width: 200 }}>{doc.deliveryDateText || doc.deliveryDate}</td>
          </tr>
          <tr>
            <td style={th}>확인서</td>
            <td style={td} colSpan={3}>
              {doc.title || doc.tab}
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 34 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 160 }} />
          <col />
        </colgroup>
        <thead style={{ display: 'table-header-group' }}>
          <tr>
            <th style={th}>No</th>
            <th style={th}>자산번호</th>
            <th style={th}>모델명</th>
            <th style={th}>S/N</th>
            <th style={th}>사양</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <FragmentRows key={b.row} title={`${b.item || '품목'} × ${b.units.filter((u) => u.assetId.trim() || u.serial.trim()).length}대${b.manufacturer ? ` · ${b.manufacturer}` : ''}`}>
              {b.units
                .filter((u) => u.assetId.trim() || u.serial.trim())
                .map((u, k) => {
                  no += 1;
                  return (
                    <tr key={`${b.row}-${k}`} style={{ breakInside: 'avoid' }}>
                      <td style={{ ...td, textAlign: 'center' }}>{no}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{u.assetId}</td>
                      <td style={td}>{u.model || '-'}</td>
                      <td style={td}>{u.serial || '-'}</td>
                      <td style={td}>{u.spec || '-'}</td>
                    </tr>
                  );
                })}
            </FragmentRows>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', marginTop: 12, fontSize: '9.5pt', breakInside: 'avoid' }}>
        <div style={{ flex: 1 }}>총 {total}대 · 위 내역대로 납품하였음을 확인합니다.</div>
        <div>
          인수자 확인 <span style={{ display: 'inline-block', width: 140, borderBottom: '1px solid #000' }} /> (인)
        </div>
      </div>
    </div>
  );
}

function FragmentRows({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <tr style={{ breakInside: 'avoid', breakAfter: 'avoid' }}>
        <td colSpan={5} style={{ ...td, background: '#fce5cd', fontWeight: 700 }}>
          ■ {title}
        </td>
      </tr>
      {children}
    </>
  );
}
