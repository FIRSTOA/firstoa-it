'use client';

import { useState } from 'react';
import { itemKind } from '@/lib/salesConfirms/itemKind';
import type { SalesUnitRow } from '@/lib/salesConfirms/types';
import { fmtDateTime } from './format';

export interface OrphanTarget {
  slotKey: string;
  unitNo: number;
  label: string;
}

interface Props {
  orphans: SalesUnitRow[];
  /** 옮겨 갈 수 있는 빈 칸들 */
  targets: OrphanTarget[];
  disabled: boolean;
  onMove: (u: SalesUnitRow, to: OrphanTarget) => Promise<boolean>;
  onDelete: (u: SalesUnitRow) => Promise<boolean>;
}

/** 영업에서 빠진 칸 — 영업이 수량을 줄이거나 품목을 빼서 갈 곳이 없어졌지만 IT가 적어 둔 값이 있는 칸. 지우지 않고 모아 둠 */
export default function OrphanPanel({ orphans, targets, disabled, onMove, onDelete }: Props) {
  if (orphans.length === 0) return null;
  return (
    <section className="panel sc-orphans">
      <div className="sc-sec-title">영업에서 빠진 칸 ({orphans.length})</div>
      <div className="sc-muted sc-orphans-sub">
        영업이 수량을 줄이거나 품목을 빼서 갈 곳이 없어졌어요. 적어 둔 값은 그대로 있어요. 다른 칸으로 옮기거나, 필요 없으면 지워 주세요.
      </div>
      {orphans.map((u) => (
        <OrphanRow key={u.id} unit={u} targets={targets} disabled={disabled} onMove={onMove} onDelete={onDelete} />
      ))}
    </section>
  );
}

function OrphanRow({
  unit,
  targets,
  disabled,
  onMove,
  onDelete,
}: {
  unit: SalesUnitRow;
  targets: OrphanTarget[];
  disabled: boolean;
  onMove: Props['onMove'];
  onDelete: Props['onDelete'];
}) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const isSoftware = itemKind(unit.itemSnapshot?.cat ?? unit.slotKey.split('#')[0]) === 'software';
  const spec = Object.entries(unit.specOverride ?? {})
    .filter(([, v]) => (v ?? '').trim())
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
  const pieces: [string, string][] = [
    ['제조사', unit.actualMaker],
    ['모델명', unit.actualModel],
    [isSoftware ? '설치 PC' : '자산번호', isSoftware ? (unit.extra?.pc ?? '') : unit.assetId],
    ['시리얼', unit.serial],
    ['사양', spec],
    ['메모', unit.note],
  ];
  const target = targets.find((t) => `${t.slotKey}|${t.unitNo}` === to);

  async function move() {
    if (!target) return;
    setBusy(true);
    try {
      await onMove(unit, target);
    } finally {
      setBusy(false);
    }
  }
  async function del() {
    const extra = isSoftware ? '\n(계약관리 대장의 좌석·키는 그대로 남아요. 대장에서 지우려면 계약관리에서 하세요.)' : '';
    if (!window.confirm(`이 칸에 적어 둔 값을 지울까요?${extra}`)) return;
    setBusy(true);
    try {
      await onDelete(unit);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sc-orphan">
      <div className="sc-orphan-head">
        <b>
          {unit.slotKey} · {unit.unitNo}번
        </b>
        <span className="sc-muted">마지막 고친 때 {fmtDateTime(unit.updatedAt)}</span>
      </div>
      <div className="sc-orphan-vals">
        {pieces
          .filter(([, v]) => (v ?? '').trim())
          .map(([k, v]) => (
            <span key={k} className="sc-spec">
              <b>{k}</b> {v}
            </span>
          ))}
      </div>
      {isSoftware && <div className="sc-muted">대장 좌석·키는 그대로 있어요(계약관리에서 지우세요).</div>}
      <div className="sc-orphan-act">
        <select value={to} disabled={disabled || busy} onChange={(e) => setTo(e.target.value)} aria-label="옮겨 갈 칸">
          <option value="">옮겨 갈 빈 칸 고르기…</option>
          {targets.map((t) => (
            <option key={`${t.slotKey}|${t.unitNo}`} value={`${t.slotKey}|${t.unitNo}`}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost sc-btn" disabled={disabled || busy || !target} onClick={() => void move()}>
          다른 칸으로 옮기기
        </button>
        <button type="button" className="btn btn-ghost sc-btn sc-btn-danger" disabled={disabled || busy} onClick={() => void del()}>
          지우기
        </button>
      </div>
    </div>
  );
}
