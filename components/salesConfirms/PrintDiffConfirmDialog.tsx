'use client';

import type { DiffItem } from '@/lib/salesConfirms/types';
import { diffFieldLabel } from './detailShared';

/** 칸 하나의 확인 안 된 차이(출력 창이 상세 데이터에서 모음) */
export interface PrintDiffGroup {
  unitId: string;
  /** "1번 데스크탑 · 2번 기기 (추가한 줄) · A0123" */
  label: string;
  /** 소프트웨어 칸이면 '제품명' */
  modelLabel: string;
  diffs: DiffItem[];
}

interface Props {
  groups: PrintDiffGroup[];
  busy: boolean;
  /** [맞아요, 인쇄] — 확인 기록을 남기고 인쇄 */
  onConfirm: () => void;
  /** [다시 볼게요] — 이 창만 닫고 인쇄 안 함 */
  onBack: () => void;
}

/**
 * 출력 창 [인쇄](IT 기재 넣음) 전에 "영업 요청과 다른 칸"을 한 번에 보여 주는 창(2026-11-27 사용자 결정 — 저장 때 묻던 것을 인쇄 때 한 번으로).
 * 바깥 누르기로는 안 닫힘 — [맞아요, 인쇄] 나 [다시 볼게요](Esc 도 같음 — 출력 창이 처리). 핸드폰에선 아래 시트(.modal 공통 규칙).
 */
export default function PrintDiffConfirmDialog({ groups, busy, onConfirm, onBack }: Props) {
  const total = groups.reduce((n, g) => n + g.diffs.length, 0);
  return (
    <div className="modal-overlay open sc-z-top">
      <div className="modal sc-diff-modal" role="alertdialog" aria-modal="true" aria-labelledby="sc-pdiff-title">
        <h2 id="sc-pdiff-title">영업 요청과 다른 칸 {total}개</h2>
        <div className="sub">
          인쇄하기 전에 한 번만 봐 주세요. 맞으면 <b>[맞아요, 인쇄]</b> — 누가 언제 확인했는지 남기고 바로 인쇄 창이 떠요. 틀렸으면{' '}
          <b>[다시 볼게요]</b> → 출력 창을 닫고 상세에서 고쳐 주세요.
        </div>
        {groups.map((g) => (
          <div key={g.unitId} className="sc-pdiff-group">
            <div className="sc-pdiff-head">{g.label}</div>
            <ul className="sc-diff-list">
              {g.diffs.map((d) => (
                <li key={d.field}>
                  <span className="sc-diff-name">{diffFieldLabel(d.field, g.modelLabel)}</span>
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
          </div>
        ))}
        <div className="modal-footer sc-diff-footer">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBack}>
            다시 볼게요
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm} autoFocus>
            {busy ? '확인 기록 중…' : '맞아요, 인쇄'}
          </button>
        </div>
      </div>
    </div>
  );
}
