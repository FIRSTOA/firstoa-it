'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createFeedback, plusFeedback, updateFeedback } from '@/app/home/feedbackActions';
import {
  FEEDBACK_KINDS,
  FEEDBACK_PAGES,
  FEEDBACK_STATUSES,
  type Feedback,
  type FeedbackKind,
  type FeedbackListResult,
  type FeedbackStatus,
} from '@/lib/feedback';

const KIND_ICON: Record<FeedbackKind, string> = { 불편: '😣', 버그: '🐞', 개선: '💡', 기타: '💬' };
const NAME_KEY = 'firstoa-it.feedback-name';

/** 처리 상태 탭 — 접수 / 진행 / 완료 / 보류·반려 / 전체 */
const TABS: { key: string; label: string; match: (s: FeedbackStatus) => boolean }[] = [
  { key: 'open', label: '접수', match: (s) => s === '접수' },
  { key: 'doing', label: '진행', match: (s) => s === '진행' },
  { key: 'done', label: '완료', match: (s) => s === '완료' },
  { key: 'hold', label: '보류·반려', match: (s) => s === '보류' || s === '반려' },
  { key: 'all', label: '전체', match: () => true },
];

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}일 전` : new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

/** 홈 맨 아래 — 불편·버그·개선 의견 적기 + 처리 상태 관리 (supabase/feedback_schema.sql) */
export default function FeedbackBoard({ initial }: { initial: FeedbackListResult }) {
  const [items, setItems] = useState<Feedback[]>(initial.ok ? initial.items : []);
  const [kind, setKind] = useState<FeedbackKind>('불편');
  const [body, setBody] = useState('');
  const [page, setPage] = useState('');
  const [name, setName] = useState('');
  const [tab, setTab] = useState('open');
  const [error, setError] = useState('');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [pending, startTransition] = useTransition();

  // 이름은 이 브라우저에 기억(로그인 기능 전이라)
  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? '');
    } catch {
      /* 저장소 막힘 — 그냥 빈칸 */
    }
  }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, items.filter((i) => t.match(i.status)).length])), [items]);
  const visible = useMemo(() => items.filter((i) => TABS.find((t) => t.key === tab)!.match(i.status)), [items, tab]);

  const replace = (item: Feedback) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));

  function submit() {
    if (!body.trim()) {
      setError('내용을 적어 주세요.');
      return;
    }
    setError('');
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      /* 무시 */
    }
    startTransition(async () => {
      const res = await createFeedback({ kind, body, author: name, page });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => [res.item, ...prev]);
      setBody('');
      setTab('open');
    });
  }

  function setStatus(item: Feedback, status: FeedbackStatus) {
    replace({ ...item, status }); // 누르는 즉시 반영
    startTransition(async () => {
      const res = await updateFeedback(item.id, { status });
      if (res.ok) replace(res.item);
      else {
        replace(item);
        setError(res.error);
      }
    });
  }

  function plus(item: Feedback) {
    replace({ ...item, plusCount: item.plusCount + 1 });
    startTransition(async () => {
      const res = await plusFeedback(item.id);
      if (res.ok) replace(res.item);
    });
  }

  function saveReply(item: Feedback) {
    startTransition(async () => {
      const res = await updateFeedback(item.id, { reply: replyText });
      if (res.ok) {
        replace(res.item);
        setReplyFor(null);
      } else setError(res.error);
    });
  }

  if (!initial.ok) {
    return (
      <section className="home-section">
        <div className="home-section-title">
          <span>📮 불편·버그·개선 — 편하게 적어 주세요</span>
        </div>
        <div className="home-empty">
          {initial.missingTable ? (
            <>
              피드백 표가 아직 없어요 — Supabase SQL Editor에서 <code>supabase/feedback_schema.sql</code>을 한 번 실행하면 바로 쓸 수 있어요.
            </>
          ) : (
            <>피드백을 못 읽었어요 — {initial.error}</>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="home-section">
      <div className="home-section-title">
        <span>📮 불편·버그·개선 — 편하게 적어 주세요</span>
        <span className="home-section-note">적어 주시면 확인하고 상태를 바꿔 드려요</span>
      </div>
      <div className="home-feedback">
        <div className="home-feedback-form">
          <div className="chip-group">
            {FEEDBACK_KINDS.map((k) => (
              <button key={k} type="button" className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
                {KIND_ICON[k]} {k}
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="예) 출고 준비 리스트에서 완료 보고 사진이 느리게 올라가요 / 확인서 인쇄할 때 두 장으로 나뉘어요"
          />
          <div className="home-feedback-row">
            <select value={page} onChange={(e) => setPage(e.target.value)} aria-label="관련 화면">
              <option value="">관련 화면(선택)</option>
              {FEEDBACK_PAGES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름(선택)" maxLength={30} />
          </div>
          <div className="home-feedback-row">
            <span className="home-section-note">{body.length}/2000</span>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
              {pending ? '저장 중…' : '등록'}
            </button>
          </div>
          {error && <div className="home-feedback-error">{error}</div>}
        </div>

        <div className="home-feedback-list">
          <div className="chip-group">
            {TABS.map((t) => (
              <button key={t.key} type="button" className={`chip${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                {t.label} {counts[t.key]}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <div className="home-empty">이 칸에 해당하는 의견이 없어요.</div>
          ) : (
            <ul>
              {visible.map((f) => (
                <li key={f.id} className={`home-fb status-${f.status}`}>
                  <div className="home-fb-head">
                    <span className={`home-fb-kind kind-${f.kind}`}>
                      {KIND_ICON[f.kind]} {f.kind}
                    </span>
                    <span className="home-fb-meta">
                      {f.author || '익명'} · {ago(f.createdAt)}
                      {f.page ? ` · ${f.page}` : ''}
                    </span>
                    <select
                      className={`home-fb-status status-${f.status}`}
                      value={f.status}
                      onChange={(e) => setStatus(f, e.target.value as FeedbackStatus)}
                      aria-label="처리 상태"
                    >
                      {FEEDBACK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="home-fb-body">{f.body}</div>
                  {f.reply && replyFor !== f.id && <div className="home-fb-reply">↳ {f.reply}</div>}
                  {replyFor === f.id ? (
                    <div className="home-fb-reply-edit">
                      <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="처리 메모·답변" maxLength={1000} autoFocus />
                      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => saveReply(f)}>
                        저장
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setReplyFor(null)}>
                        취소
                      </button>
                    </div>
                  ) : (
                    <div className="home-fb-actions">
                      <button type="button" className="chip" onClick={() => plus(f)}>
                        🙋 나도 그래요 {f.plusCount > 0 ? f.plusCount : ''}
                      </button>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          setReplyFor(f.id);
                          setReplyText(f.reply);
                        }}
                      >
                        {f.reply ? '답변 고치기' : '답변'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
