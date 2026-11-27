'use client';

import Link from 'next/link';
import { useState, type MouseEvent } from 'react';
import { fmtDate } from '@/components/salesConfirms/format';
import { salesConfirmHref, type PrepConfirmBadge as BadgeData, type PrepConfirmBadgeItem } from '@/lib/salesConfirms/types';

interface Props {
  /** 이 일정의 확인서 배지. undefined = 아직 못 읽음/못 읽었음 */
  badge: BadgeData | undefined;
  /** 배지를 읽는 중이면 true("확인서 확인 중…") */
  loading?: boolean;
  /** 후보 하나를 이 일정에 잇기 — 호출하는 쪽이 linkConfirmPrepEvent 를 부르고 배지를 다시 읽음. 실패하면 { ok:false, error } */
  onLink: (item: PrepConfirmBadgeItem) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const GRADE_TEXT = { sure: '제목·날짜 같음', strong: '거의 같음', weak: '비슷함' } as const;
const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * 출고 준비 리스트 일정 카드 안의 "📋 확인서" 한 줄(PC 표·핸드폰 카드 둘 다).
 * 확인서가 이어져 있으면 눌러서 확인서 상세로, 후보만 있으면 [고르기] 팝업, 없으면 흐리게.
 * 글자 크기·색은 출고 준비 화면(12~13px, 초록 = 이어짐, 주황 = 주의, 회색 = 없음)에 맞춤.
 */
export default function PrepConfirmBadge({ badge, loading = false, onLink }: Props) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [err, setErr] = useState('');

  if (!badge) {
    return loading ? (
      <div className="pcb" onClick={stop}>
        <span className="pcb-muted">📋 확인서 확인 중…</span>
      </div>
    ) : null; // 못 읽었으면 배지 없이 그대로(출고 준비 쪽은 원래 모양)
  }

  async function pick(item: PrepConfirmBadgeItem) {
    if (busyId) return;
    setBusyId(item.confirmId);
    setErr('');
    try {
      const r = await onLink(item);
      if (r.ok) setOpen(false);
      else setErr(r.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잇지 못했어요.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="pcb" onClick={stop}>
      {badge.linked.map((it) => (
        <div key={it.confirmId} className="pcb-line">
          <span className="pcb-ico">📋</span>
          <Link href={salesConfirmHref(it.confirmId)} className="pcb-link" title="확인서 열기">
            확인서 {it.docNo || ''} · {it.company || '(상호 없음)'}
          </Link>
          {it.type && <span className="pcb-pill">{it.type}</span>}
          {it.link === 'computed' && <span className="pcb-pill good">자동 연결</span>}
          {it.directShip && <span className="pcb-pill warn">확인서는 직송</span>}
          {it.salesDeleted && <span className="pcb-pill bad">영업에서 지움</span>}
          {it.other && <span className="pcb-pill">따로 보는 종류</span>}
        </div>
      ))}

      {badge.kind === 'none' && (
        <div className="pcb-line">
          <span className="pcb-muted">📋 확인서 없음</span>
        </div>
      )}

      {badge.candidates.length > 0 && (
        <div className="pcb-line">
          <span className="pcb-ico">📋</span>
          <button type="button" className="pcb-btn" onClick={() => setOpen(true)}>
            {badge.kind === 'linked' ? `다른 후보 ${badge.candidates.length}` : `확인서 후보 ${badge.candidates.length} — 고르기`}
          </button>
        </div>
      )}

      {open && (
        <div className="modal-overlay open pcb-overlay" onClick={() => setOpen(false)}>
          <div className="modal pcb-modal" role="dialog" aria-modal="true" aria-label="확인서 고르기" onClick={(e) => e.stopPropagation()}>
            <h2>이 일정과 이을 확인서</h2>
            <div className="sub">같은 건으로 보이는 영업 확인서예요. 맞는 것을 골라 [연결]을 눌러 주세요.</div>
            {err && (
              <div className="ct-band bad" role="alert">
                <span>{err}</span>
              </div>
            )}
            <ul className="pcb-cands">
              {badge.candidates.map((it) => (
                <li key={it.confirmId}>
                  <div className="pcb-cand-main">
                    <b>
                      {it.docNo || '(순번 없음)'} · {it.company || '(상호 없음)'}
                    </b>
                    <div className="pcb-cand-meta">
                      {[it.type, it.deliveryDate ? `납품 ${fmtDate(it.deliveryDate)}` : '', it.region, it.status].filter(Boolean).join(' · ')}
                    </div>
                    <div className="pcb-cand-pills">
                      {it.grade && <span className="pcb-pill">{GRADE_TEXT[it.grade]}</span>}
                      {it.directShip && <span className="pcb-pill warn">확인서는 직송</span>}
                      {it.salesDeleted && <span className="pcb-pill bad">영업에서 지움</span>}
                      {it.linkedElsewhere && <span className="pcb-pill warn">같은 확인서가 다른 일정에 이어져 있어요 — 연결하면 옮겨져요</span>}
                    </div>
                  </div>
                  <button type="button" className="btn btn-primary pcb-cand-btn" disabled={!!busyId} onClick={() => void pick(it)}>
                    {busyId === it.confirmId ? '잇는 중…' : '연결'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
