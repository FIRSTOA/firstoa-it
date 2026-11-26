'use client';

import Link from 'next/link';
import { regionFromEventTime } from '@/lib/salesConfirms/regionSlot';
import type { SalesConfirmDetailData } from '@/lib/salesConfirms/types';
import { fmtDate, fmtDateTime } from './format';

interface Props {
  hints: SalesConfirmDetailData['prepHints'];
}

/** "같은 건으로 보이는 출고 준비 일정" — 읽기만(D8). 출고 준비 쪽에는 아무것도 쓰지 않음 */
export default function PrepHintBox({ hints }: Props) {
  return (
    <section className="panel sc-prep">
      <div className="sc-sec-title">같은 건으로 보이는 출고 준비 일정</div>
      {hints.length === 0 ? (
        <div className="detail-empty">같은 건으로 보이는 출고 준비 일정을 아직 못 찾았어요.</div>
      ) : (
        <ul className="sc-prep-list">
          {hints.map((h) => {
            const region = regionFromEventTime(h.date);
            const when = h.date.includes('T') ? fmtDateTime(h.date) : fmtDate(h.date);
            return (
              <li key={h.eventId}>
                <span className="sc-prep-when">{when}</span>
                {region && <span className="sc-region-tag">{region}</span>}
                <span className="sc-prep-title">{h.title}</span>
                {h.prepState && <span className="sc-pill sc-pill-gray">{h.prepState}</span>}
                {h.reportSent && <span className="sc-pill sc-pill-indigo">완료 보고 보냄</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="sc-prep-foot">
        <Link href="/shipment-prep" className="sc-link">
          출고 준비 리스트 열기 →
        </Link>
        <span className="sc-muted">자산번호는 출고 준비 완료 보고에도 넣어 주세요(두 화면을 합치기 전까지).</span>
      </div>
    </section>
  );
}
