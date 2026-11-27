'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  getConfirmPrepLink,
  linkConfirmPrepEvent,
  resetConfirmPrepLink,
  unlinkConfirmPrepEvent,
} from '@/app/confirm-form/prepLinkActions';
import type { PrepLinkCandidate, PrepLinkGrade, PrepLinkSaveResult, PrepLinkState } from '@/lib/salesConfirms/types';
import { fmtDate } from './format';

interface Props {
  confirmId: string;
  /** 상세가 읽어 온 연결 상태. null = 못 읽음 */
  link: PrepLinkState | null;
  /** 지금 ③ 의 updated_at(늘 최신 — 다른 저장 뒤에도 바뀐 값) */
  getWorkUpdatedAt: () => string | null;
  /** 이름이 있으면 바로, 없으면 물음(취소 = null) */
  ensureActor: () => Promise<string | null>;
  /** 연결·풀기 뒤 받은 workUpdatedAt 을 상세 ③ 값에 넣음(가짜 충돌 방지) */
  onSaved: (workUpdatedAt: string) => void;
  /** 충돌 등으로 상세 전체를 다시 읽음 */
  onReload: () => void;
  /** 저장을 한 번에 하나씩 줄 세우는 함수(상세의 serial) */
  serial: <T,>(fn: () => Promise<T>) => Promise<T>;
  toast: { show: (m: string) => void; warn: (m: string) => void };
}

const GRADE_TEXT: Record<PrepLinkGrade, string> = {
  sure: '제목·날짜 같음',
  strong: '거의 같음',
  weak: '비슷함',
};

const BLOCKED_TEXT: Record<string, string> = {
  copies: '같은 제목의 일정이 여러 개예요(복사본일 수 있어요). 맞는 것을 골라 주세요.',
  shared: '제목이 같은 다른 확인서도 있어서 자동으로 잇지 않았어요. 맞는 일정을 골라 주세요.',
  taken: '그 일정에는 다른 확인서가 이미 이어져 있어서 자동으로 잇지 않았어요.',
  excluded: '영업에서 지웠거나 취소한 확인서라 자동으로 잇지 않았어요.',
};

export function prepEventHref(eventId: string): string {
  return `/shipment-prep?event=${encodeURIComponent(eventId)}`;
}

/** 확인서 상세 위 "출고 준비" 상자 — 이 확인서가 출고 준비 리스트의 어느 일정과 이어졌는지 */
export default function PrepLinkPanel({ confirmId, link, getWorkUpdatedAt, ensureActor, onSaved, onReload, serial, toast }: Props) {
  const [state, setState] = useState<PrepLinkState | null>(link);
  const [busy, setBusy] = useState('');
  const [showCands, setShowCands] = useState(false);

  // 상세를 다시 읽어 새 값이 오면 따라감
  useEffect(() => {
    setState(link);
  }, [link]);

  async function run(key: string, exec: (who: string, expected: string | null) => Promise<PrepLinkSaveResult>, doneMsg: string) {
    if (busy) return;
    const who = await ensureActor();
    if (!who) return;
    setBusy(key);
    try {
      const res = await serial(() => exec(who, getWorkUpdatedAt()));
      if (!res.ok) {
        if (res.conflict) {
          toast.warn('다른 사람이 방금 바꿨어요 — 새로 불러왔어요. 다시 한 번 해 주세요.');
          onReload();
        } else {
          toast.warn(`저장하지 못했어요 — ${res.error}`);
        }
        return;
      }
      onSaved(res.workUpdatedAt);
      setShowCands(false);
      toast.show(doneMsg);
      const again = await getConfirmPrepLink({ confirmId });
      if (again.ok) setState(again.data);
      else {
        toast.warn('저장은 됐는데 상자를 다시 읽지 못했어요 — 화면을 새로 읽어 올게요.');
        onReload();
      }
    } catch (e) {
      toast.warn(`저장하지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setBusy('');
    }
  }

  const doLink = (ev: PrepLinkCandidate) =>
    run(
      `link:${ev.eventId}`,
      (who, expected) => linkConfirmPrepEvent({ confirmId, eventId: ev.eventId, expectedUpdatedAt: expected, actor: who }),
      '출고 일정과 이었어요.',
    );
  const doUnlink = (msg: string) => run('unlink', (who, expected) => unlinkConfirmPrepEvent({ confirmId, expectedUpdatedAt: expected, actor: who }), msg);
  const doReset = () => run('reset', (who, expected) => resetConfirmPrepLink({ confirmId, expectedUpdatedAt: expected, actor: who }), '다시 찾아볼게요.');

  if (!state) {
    return (
      <section className="panel sc-prepbox">
        <div className="sc-sec-title">출고 준비</div>
        <div className="detail-empty">출고 준비 일정과 이어진 상태를 읽지 못했어요. 화면을 새로 읽어 보세요.</div>
      </section>
    );
  }

  const k = state.kind;

  if (k === 'notTarget') {
    return (
      <section className="panel sc-prepbox sc-prepbox-slim">
        <span className="sc-pl-slim">
          {state.notTargetReason === 'direct'
            ? '📋 직송 건이라 출고 준비 리스트에는 안 나와요.'
            : '📋 철수·이전·판매 확인서라 출고 준비 대상이 아니에요.'}
        </span>
      </section>
    );
  }

  const ev = state.event;
  const cands = state.candidates;
  const blocked = state.autoBlocked ? BLOCKED_TEXT[state.autoBlocked] : '';
  const canPickList = k === 'candidates' || k === 'broken' || (k === 'linked' && showCands) || (k === 'off' && showCands);

  return (
    <section className="panel sc-prepbox">
      <div className="sc-pl-head">
        <div className="sc-sec-title">출고 준비</div>
        {k === 'linked' && <span className="sc-pill sc-pill-green">{state.savedSource === 'auto' ? '이어짐(자동)' : '이어짐'}</span>}
        {k === 'auto' && <span className="sc-pill sc-pill-green">자동으로 이어졌어요</span>}
        {k === 'candidates' && <span className="sc-pill sc-pill-amber">골라 주세요</span>}
        {k === 'broken' && <span className="sc-pill sc-pill-amber">일정이 없어졌어요</span>}
        {k === 'noEvent' && <span className="sc-pill sc-pill-amber">일정 없음</span>}
        {k === 'off' && <span className="sc-pill sc-pill-gray">이어지 않게 둠</span>}
        {k === 'unknown' && <span className="sc-pill sc-pill-gray">납품일 없음</span>}
      </div>

      {(k === 'linked' || k === 'auto') && ev && (
        <>
          <EventLine ev={ev} />
          {k === 'auto' && <div className="sc-pl-note">제목과 날짜가 같아서 자동으로 이어졌어요. 따로 누를 것은 없어요. 틀렸으면 [풀기]를 눌러 주세요.</div>}
          {ev.linkedConfirms.length > 0 && (
            <div className="sc-pl-note">이 일정에는 다른 확인서도 이어져 있어요: {ev.linkedConfirms.map((c) => c.docNo || '(순번 없음)').join(', ')}</div>
          )}
          <div className="sc-pl-btns">
            <Link href={prepEventHref(ev.eventId)} className="btn btn-ghost sc-pl-btn">
              출고 준비 리스트에서 보기 →
            </Link>
            {k === 'linked' && cands.length > 0 && (
              <button type="button" className="btn btn-ghost sc-pl-btn" disabled={!!busy} onClick={() => setShowCands((v) => !v)}>
                {showCands ? '바꾸기 닫기' : '다른 일정으로 바꾸기'}
              </button>
            )}
            <button type="button" className="btn btn-ghost sc-pl-btn" disabled={!!busy} onClick={() => void doUnlink('풀었어요.')}>
              {busy === 'unlink' ? '푸는 중…' : '풀기'}
            </button>
          </div>
        </>
      )}

      {k === 'candidates' && (
        <div className="sc-pl-note">
          같은 건으로 보이는 출고 일정이에요. 맞는 것을 골라 [연결]을 눌러 주세요.
          {blocked ? ` ${blocked}` : ''}
        </div>
      )}

      {k === 'broken' && (
        <div className="ct-band warn sc-pl-band" role="status">
          <span>연결했던 출고 일정이 없어졌어요(네이버에서 지워졌을 수 있어요). 다시 골라 주세요.</span>
        </div>
      )}

      {k === 'noEvent' && (
        <div className="ct-band warn sc-pl-band" role="status">
          <span>출고 일정이 아직 없어요 — 영업에 네이버 일정을 부탁하세요. 일정이 생기면 여기에 저절로 나와요.</span>
        </div>
      )}

      {k === 'off' && (
        <div className="sc-pl-note">&lsquo;출고 일정과 이어지지 않게 둠&rsquo;으로 해 뒀어요. 일정을 다시 찾으려면 [다시 찾기]를 눌러 주세요.</div>
      )}

      {k === 'unknown' && <div className="sc-pl-note">납품일이 없어서 출고 일정을 찾을 수 없어요. 영업에서 납품일이 오면 찾아봐요.</div>}

      {canPickList && cands.length > 0 && (
        <ul className="sc-pl-cands">
          {cands.slice(0, 8).map((c) => (
            <li key={c.eventId}>
              <EventLine ev={c} showGrade />
              <div className="sc-pl-btns">
                <button type="button" className="btn btn-primary sc-pl-btn" disabled={!!busy} onClick={() => void doLink(c)}>
                  {busy === `link:${c.eventId}` ? '잇는 중…' : '연결'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canPickList && cands.length === 0 && k !== 'linked' && <div className="sc-pl-note">고를 수 있는 일정이 아직 없어요.</div>}

      {(k === 'candidates' || k === 'broken' || k === 'noEvent') && (
        <div className="sc-pl-btns">
          <button type="button" className="btn btn-ghost sc-pl-btn" disabled={!!busy} onClick={() => void doUnlink('출고 일정 없음으로 뒀어요.')}>
            {busy === 'unlink' ? '저장 중…' : '출고 일정 없음으로 두기'}
          </button>
        </div>
      )}

      {k === 'off' && (
        <div className="sc-pl-btns">
          <button type="button" className="btn btn-ghost sc-pl-btn" disabled={!!busy} onClick={() => void doReset()}>
            {busy === 'reset' ? '찾는 중…' : '다시 찾기'}
          </button>
          {cands.length > 0 && (
            <button type="button" className="btn btn-ghost sc-pl-btn" disabled={!!busy} onClick={() => setShowCands((v) => !v)}>
              {showCands ? '후보 닫기' : `후보 ${cands.length}개 보기`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function EventLine({ ev, showGrade = false }: { ev: PrepLinkCandidate; showGrade?: boolean }) {
  return (
    <div className="sc-pl-event">
      <span className="sc-prep-when">{fmtDate(ev.date)}</span>
      <span className="sc-pl-time">{ev.time || '종일'}</span>
      {ev.regionOfEvent && <span className="sc-region-tag">{ev.regionOfEvent}</span>}
      <span className="sc-prep-title">{ev.title}</span>
      <span className="sc-pl-pills">
        {showGrade && ev.grade && <span className="sc-pill sc-pill-indigo">{GRADE_TEXT[ev.grade]}</span>}
        {ev.prepState && <span className="sc-pill sc-pill-gray">{ev.prepState}</span>}
        {ev.reportSent && <span className="sc-pill sc-pill-indigo">완료 보고 보냄</span>}
        {ev.notPrepTarget && <span className="sc-pill sc-pill-amber">★ 없음 — 출고 준비 리스트엔 안 보여요(영업에 별표 부탁)</span>}
        {showGrade && ev.linkedConfirms.length > 0 && <span className="sc-pill sc-pill-amber">다른 확인서 {ev.linkedConfirms.length}개 이어짐</span>}
      </span>
    </div>
  );
}
