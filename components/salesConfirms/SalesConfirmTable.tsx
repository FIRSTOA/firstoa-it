'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  SALES_CONFIRM_DONE_STATUSES,
  SALES_CONFIRM_STATUSES,
  SALES_STATE_DELETED,
  isSalesConfirmStatus,
  salesConfirmHref,
  type SalesConfirmListRow,
  type PrepLinkState,
  type SalesConfirmStatus,
  type SheetCompareEntry,
} from '@/lib/salesConfirms/types';
import { addDays, fmtDate, fmtDateTime, headAndMore, statusClass } from './format';

/** "시트" 칸 상태 — 부모(SalesConfirmListPage)가 들고 있음 */
export type SheetColumnState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'fail'; error: string }
  | { state: 'ok'; byConfirm: Record<string, SheetCompareEntry> };

interface Props {
  rows: SalesConfirmListRow[];
  /** 처리자 고르기 명단 */
  people: string[];
  /** 한국 시간 오늘 'YYYY-MM-DD' */
  today: string;
  /**
   * 따로 보는 종류(철수·이전·판매) 목록 — 출고 준비가 아니라 자산번호·시리얼·진행·출력(출력함·다시 뽑기·다시 확인 필요) 칸·표시를 안 그림.
   * 처리여부·처리자 바꾸기는 그대로.
   */
  other?: boolean;
  /** 직송 목록(참고용 — 줄에 매입처는 row.directShip 으로 그림) */
  direct?: boolean;
  /** 출고 일정 연결 표시(확인서 id → 상태). 처음 읽을 때·새로고침 때만 채움. 없으면 표시 없음 */
  prepBadges?: Record<string, PrepLinkState>;
  /** 📄 시트와 비교 를 켰는지(PC 만 — 핸드폰에선 칸이 숨음) */
  showSheet: boolean;
  sheet: SheetColumnState;
  /** 저장 중인 줄 id */
  busyIds: ReadonlySet<string>;
  onOpen: (row: SalesConfirmListRow) => void;
  onStatus: (row: SalesConfirmListRow, status: SalesConfirmStatus) => void;
  onProcessors: (row: SalesConfirmListRow, processors: string[]) => void;
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** 목록 칸 폭(PC). 합계가 표 최소 폭 — 넓은 표라 가로로 밀어 봄(globals.css .sc-scroll) */
// 순번 · 납품/교체일 · 지역 · 접수일시 · 처리여부 · 접수자 · 처리자 · 구분 · 상호 · 연락처 · 품목 · 사양 · 자산번호 · 시리얼 · 소모품/특이사항 · 비고
const COL_WIDTHS = [88, 92, 76, 92, 104, 72, 128, 64, 160, 116, 132, 150, 150, 120, 190, 130];
/** 따로 보는 종류 — 자산번호(12번째)·시리얼(13번째) 칸 없음(합계 1594px — globals.css .sc-table.sc-table-other) */
const OTHER_COL_WIDTHS = COL_WIDTHS.filter((_, i) => i !== 12 && i !== 13);

/** 줄의 "출고 일정" 표시 — 이어짐 초록 / 후보·일정 없음·끊김 주황. 그 밖(꺼 둠·직송·모름)은 표시 없음 */
function prepChip(st: PrepLinkState | undefined) {
  if (!st) return null;
  const ev = st.event;
  switch (st.kind) {
    case 'linked':
    case 'auto': {
      const when = ev ? `${fmtDate(ev.date)}${ev.time ? ` ${ev.time}` : ''}${ev.regionOfEvent ? ` ${ev.regionOfEvent}` : ''}` : '';
      return <span className="sc-pill sc-pill-green" title={st.kind === 'auto' ? '제목과 날짜가 같아 자동으로 이어졌어요' : '출고 준비 일정과 이어져 있어요'}>📋 출고 일정 {when}{st.kind === 'auto' ? ' (자동)' : ''}</span>;
    }
    case 'candidates':
      return <span className="sc-pill sc-pill-amber" title="열어서 맞는 일정을 골라 주세요">📋 일정 후보 {st.candidates.length}</span>;
    case 'broken':
      return <span className="sc-pill sc-pill-amber" title="연결했던 일정이 지워졌어요. 열어서 다시 골라 주세요">📋 연결한 일정이 없어졌어요</span>;
    case 'noEvent':
      return st.alertNoEvent ? <span className="sc-pill sc-pill-amber" title="영업에 네이버 일정을 부탁하세요">📋 출고 일정 없음</span> : null;
    default:
      return null;
  }
}

export default function SalesConfirmTable({ rows, people, today, other = false, prepBadges, showSheet, sheet, busyIds, onOpen, onStatus, onProcessors }: Props) {
  const tomorrow = addDays(today, 1);
  const widths = other ? OTHER_COL_WIDTHS : COL_WIDTHS;
  return (
    <div className="sc-scroll">
      {/* 핸드폰에선 카드(m-cards) — data-m 은 components/MobileTableCards.tsx 참고 */}
      <table className={`m-cards sc-table${other ? ' sc-table-other' : ''}${showSheet ? ' sc-with-sheet' : ''}`}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${w}px` }} />
          ))}
          {showSheet && <col style={{ width: '120px' }} />}
        </colgroup>
        <thead>
          <tr>
            <th data-m="hide">순번</th>
            {other ? (
              <th data-m="inline" data-label="날짜">
                날짜
              </th>
            ) : (
              <th data-m="inline" data-label="납품일">
                납품/교체일
              </th>
            )}
            <th data-m="inline" data-label="지역">지역</th>
            <th data-m="hide">접수일시</th>
            <th data-m="badge">처리여부</th>
            <th data-m="hide">접수자</th>
            <th data-m="full">처리자</th>
            <th data-m="inline" data-label="구분">구분</th>
            <th data-m="title">상호</th>
            <th data-m="full">연락처</th>
            <th data-m="inline" data-label="품목">품목</th>
            <th data-m="sub" data-label="사양">사양</th>
            {!other && <th data-m="full">자산번호</th>}
            {!other && <th data-m="hide">시리얼</th>}
            <th data-m="sub" data-label="소모품/특이사항">소모품/특이사항</th>
            <th data-m="hide">비고</th>
            {showSheet && <th data-m="hide">시트</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              people={people}
              today={today}
              tomorrow={tomorrow}
              other={other}
              prep={other ? undefined : (prepBadges?.[row.id] ?? row.prepBadge)}
              showSheet={showSheet}
              sheet={sheet}
              busy={busyIds.has(row.id)}
              onOpen={onOpen}
              onStatus={onStatus}
              onProcessors={onProcessors}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  row,
  people,
  today,
  tomorrow,
  other,
  prep,
  showSheet,
  sheet,
  busy,
  onOpen,
  onStatus,
  onProcessors,
}: {
  row: SalesConfirmListRow;
  people: string[];
  today: string;
  tomorrow: string;
  other: boolean;
  prep: PrepLinkState | undefined;
  showSheet: boolean;
  sheet: SheetColumnState;
  busy: boolean;
  onOpen: (row: SalesConfirmListRow) => void;
  onStatus: (row: SalesConfirmListRow, status: SalesConfirmStatus) => void;
  onProcessors: (row: SalesConfirmListRow, processors: string[]) => void;
}) {
  const finished = SALES_CONFIRM_DONE_STATUSES.includes(row.status);
  const due = !finished && row.deliveryDate === today ? 'today' : !finished && row.deliveryDate === tomorrow ? 'tomorrow' : '';
  const assetText = headAndMore(row.assetIds, 3);
  const serialText = headAndMore(row.serials, 3);
  const extra = [row.suppliesSummary, row.special].filter((s) => s && s.trim()).join(' / ');
  // 영업에서 지운 건 — 빨간 "영업에서 지움" + 지운 시각·사람(작게), "새로" 없음(설계 E27)
  const deleted = row.salesState === SALES_STATE_DELETED;
  const isNew = row.isNew && !deleted;
  const deletedMeta = deleted
    ? [row.salesDeletedAt ? fmtDateTime(row.salesDeletedAt) : '', (row.salesDeletedBy ?? '').trim()].filter((s) => s && s !== '-').join(' · ')
    : '';
  // 따로 보는 종류는 진행·출력·다시 확인 표시 없음
  const recheck = other ? 0 : (row.recheckCount ?? 0);
  const printed = !other && row.printedVer != null;
  const cls = ['sc-row', isNew ? 'sc-new' : '', deleted ? 'sc-deleted' : '', row.status === '취소' ? 'sc-cancel' : '', busy ? 'sc-busy' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={cls} onClick={() => onOpen(row)}>
      <td className="sc-mono">{row.docNo || '-'}</td>
      <td>
        <span className={`sc-due${due ? ` sc-due-${due}` : ''}`}>{fmtDate(row.deliveryDate)}</span>
        {due === 'today' && <span className="sc-pill sc-pill-red">오늘</span>}
        {due === 'tomorrow' && <span className="sc-pill sc-pill-amber">내일</span>}
      </td>
      <td>
        {row.region ? (
          <span className="sc-region-tag">
            {row.region}
            {row.regionGuessed && <span className="sc-region-guess-mark">(추정)</span>}
          </span>
        ) : (
          '-'
        )}
      </td>
      <td className="sc-small">{fmtDateTime(row.receivedAt)}</td>
      <td onClick={stop}>
        <select
          className={`sc-status ${statusClass(row.status)}`}
          value={row.status}
          disabled={busy}
          aria-label={`${row.company || row.docNo} 처리여부`}
          onChange={(e) => {
            const v = e.target.value;
            if (isSalesConfirmStatus(v) && v !== row.status) onStatus(row, v);
          }}
        >
          {SALES_CONFIRM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="sc-small">{row.savedBy || '-'}</td>
      <td onClick={stop}>
        <ProcessorPicker row={row} people={people} busy={busy} onChange={(list) => onProcessors(row, list)} />
      </td>
      <td>
        {row.type || '-'}
        {row.term === '현장/단기' && <span className="sc-pill sc-pill-gray">단기</span>}
      </td>
      <td>
        <Link href={salesConfirmHref(row.id)} className="ct-name-btn sc-name sc-name-link" onClick={stop}>
          {row.company || '(상호 없음)'}
        </Link>
        {row.directShip && (
          <div className="sc-consign" title="우리를 안 거치고 매입처에서 고객사로 바로 가는 건이에요">
            직송 · 매입처 {row.consignName || '(이름 없음)'}
          </div>
        )}
        {(isNew || row.salesChanged || row.salesState || printed || recheck > 0 || prepChip(prep)) && (
          <div className="sc-flags">
            {prepChip(prep)}
            {isNew && <span className="sc-pill sc-pill-new">새로</span>}
            {deleted && (
              <span className="sc-del-flag">
                <span className="sc-pill sc-pill-red">영업에서 지움</span>
                {deletedMeta && <span className="sc-del-meta">{deletedMeta}</span>}
              </span>
            )}
            {recheck > 0 && (
              <span className="sc-pill sc-pill-amber" title="영업 요청과 다른 기기 칸 — 인쇄할 때 한 번에 확인해요">
                요청과 다름 {recheck}
              </span>
            )}
            {printed &&
              (row.printStale ? (
                <span className="sc-pill sc-pill-amber" title="출력한 뒤 영업이 고쳤거나 IT 값이 바뀌었어요">
                  출력 뒤 바뀜 · 다시 뽑기
                </span>
              ) : (
                <span className="sc-pill sc-pill-indigo">출력함 v{row.printedVer}</span>
              ))}
            {row.salesChanged && (
              <span className="sc-pill sc-pill-amber">
                영업에서 수정됨 v{row.salesChanged.fromVer}→v{row.salesChanged.toVer}
              </span>
            )}
            {row.salesState && !deleted && <span className="sc-pill sc-pill-red">영업에서 {row.salesState}</span>}
          </div>
        )}
      </td>
      <td onClick={stop} className="sc-small">
        {(() => {
          if (!row.phone) return '-';
          // 연락처 칸엔 "IT담당 홍길동 010-1234-5678" 처럼 이름이 같이 올 수 있음 → 첫 전화번호 꼴만 링크로(없으면 글자만)
          const m = row.phone.match(/\+?\d[\d\s-]{6,}\d/);
          const tel = m ? m[0].replace(/[^\d+]/g, '') : '';
          return tel.length >= 8 ? (
            <a className="sc-tel" href={`tel:${tel}`}>
              {row.phone}
            </a>
          ) : (
            row.phone
          );
        })()}
      </td>
      <td>{row.itemSummary || '-'}</td>
      <td>
        {row.specSummary || '-'}
        {!other && row.specEdited && row.specSummary && (
          <span className="sc-pill sc-pill-indigo" title="IT가 고친 사양이 있어요">
            ✎ IT 수정
          </span>
        )}
      </td>
      {!other && (
        <td>
          {row.unitsTotal > 0 && (
            <span className={`sc-prog${row.unitsFilled >= row.unitsTotal ? ' done' : row.unitsFilled > 0 ? ' part' : ''}`}>
              {row.unitsFilled}/{row.unitsTotal}
            </span>
          )}
          {assetText ? <span className="sc-ids"> {assetText}</span> : row.unitsTotal > 0 ? null : '-'}
        </td>
      )}
      {!other && <td className="sc-small">{serialText || '-'}</td>}
      <td>{extra ? <div className="sc-clamp2" title={extra}>{extra}</div> : '-'}</td>
      <td>{row.note ? <div className="sc-clamp2" title={row.note}>{row.note}</div> : '-'}</td>
      {showSheet && <td className="sc-small">{sheetCell(row, sheet)}</td>}
    </tr>
  );
}

function sheetCell(row: SalesConfirmListRow, sheet: SheetColumnState) {
  if (sheet.state === 'idle') return <span className="sc-muted">-</span>;
  if (sheet.state === 'loading') return <span className="sc-muted">비교 중…</span>;
  if (sheet.state === 'fail') {
    return (
      <span className="sc-sheet-warn" title={sheet.error}>
        {sheet.error}
      </span>
    );
  }
  const e = sheet.byConfirm[row.id];
  if (!e) return <span className="sc-muted" title="이 줄은 아직 비교하지 않았어요">비교 전</span>;
  if (e.state === 'same') return <span className="sc-sheet-ok">✓ 같음</span>;
  if (e.state === 'diff') {
    return (
      <span className="sc-sheet-warn" title={e.diffs.length ? `다른 칸: ${e.diffs.join(', ')}` : '시트와 다른 칸이 있어요'}>
        ⚠ 다름{e.diffs.length ? `: ${e.diffs.join(', ')}` : ''}
      </span>
    );
  }
  return <span className="sc-muted">— 시트에 없음</span>;
}

/** 처리자: 현재 이름들을 작은 칩으로 보이고, 누르면 명단에서 체크로 고름(체크할 때마다 바로 저장) */
function ProcessorPicker({
  row,
  people,
  busy,
  onChange,
}: {
  row: SalesConfirmListRow;
  people: string[];
  busy: boolean;
  onChange: (list: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  // 명단에 없는 이름(예전에 적은 사람)도 지울 수 있게 합침
  const options = [...people, ...row.processors.filter((p) => !people.includes(p))];

  // 표가 옆으로 밀리는 칸(overflow) 안이라 팝업은 화면 기준(fixed)으로 띄우고, 스크롤하면 닫음
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = 230;
      const height = Math.min(300, 56 + Math.max(1, options.length) * 36);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = r.bottom + 4 + height > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4;
      setPos({ left, top });
    }
    setOpen((o) => !o);
  }

  function toggle(name: string) {
    const next = row.processors.includes(name) ? row.processors.filter((p) => p !== name) : [...row.processors, name];
    onChange(next);
  }

  return (
    <div className="sc-proc">
      <button
        ref={btnRef}
        type="button"
        className={`sc-proc-btn${row.processors.length ? '' : ' empty'}`}
        aria-expanded={open}
        disabled={busy}
        onClick={toggleOpen}
        title="처리자 고르기"
      >
        {row.processors.length ? row.processors.join(', ') : '미지정'} ▾
      </button>
      {open && (
        <>
          <div className="ct-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="sc-proc-pop" role="group" aria-label="처리자 고르기" style={{ left: pos.left, top: pos.top }}>
            {options.length === 0 ? (
              <div className="sc-muted">명단이 비어 있어요. 출고 준비의 [담당자 관리]에서 먼저 넣어 주세요.</div>
            ) : (
              options.map((name) => (
                <label key={name} className="toggle sc-proc-opt">
                  <input type="checkbox" checked={row.processors.includes(name)} disabled={busy} onChange={() => toggle(name)} />
                  {name}
                </label>
              ))
            )}
            <button type="button" className="btn btn-ghost sc-proc-close" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
