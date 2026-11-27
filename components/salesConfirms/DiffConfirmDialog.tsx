'use client';

import type { DiffItem } from '@/lib/salesConfirms/types';
import { diffFieldLabel } from './detailShared';

interface Props {
  items: DiffItem[];
  /** 소프트웨어 칸이면 '제품명' */
  modelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onRedo: () => void;
}

/**
 * 칸 하나의 "요청과 다름" [확인] 창 — 닫기 버튼·바깥 누르기·Esc 로 닫히지 않음.
 * 반드시 [맞아요, 이대로] 나 [다시 고칠게요] 중 하나. 핸드폰에선 아래에서 올라오는 시트(.modal 공통 규칙).
 * (2026-11-27부터 저장 때는 안 뜸 — 저장은 그대로 되고, 확인은 출력 창 [인쇄] 때 PrintDiffConfirmDialog 로 한 번에. 이 창은 칸의 [확인]만)
 */
export default function DiffConfirmDialog({ items, modelLabel = '모델명', busy, onConfirm, onRedo }: Props) {
  return (
    <div className="modal-overlay open sc-z-top">
      <div className="modal sc-diff-modal" role="alertdialog" aria-modal="true" aria-labelledby="sc-diff-title">
        <h2 id="sc-diff-title">영업이 요청한 것과 달라요</h2>
        <div className="sub">아래 값이 맞는지 한 번만 더 확인해 주세요. 맞으면 그대로 저장하고, 틀렸으면 돌아가서 고쳐요.</div>
        <ul className="sc-diff-list">
          {items.map((d) => (
            <li key={d.field}>
              <span className="sc-diff-name">{diffFieldLabel(d.field, modelLabel)}</span>
              <span className="sc-diff-vals">
                <span className="sc-diff-from">영업 요청 {d.sales}</span>
                <span className="sc-diff-arrow" aria-hidden="true">
                  →
                </span>
                <span className="sc-diff-to">출고 {d.actual || '(비움)'}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-footer sc-diff-footer">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRedo}>
            다시 고칠게요
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm} autoFocus>
            {busy ? '저장 중…' : '맞아요, 이대로'}
          </button>
        </div>
      </div>
    </div>
  );
}
