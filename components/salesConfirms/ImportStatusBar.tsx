'use client';

import { useState } from 'react';
import type { SalesImportErrorCode, SalesImportState } from '@/lib/salesConfirms/types';
import { addDays, agoText, kstToday } from './format';

interface Props {
  /** 영업 웹앱 연결 키가 서버에 있는지(값은 안 옴). false 면 회색 띠 */
  hasKey: boolean;
  /** 마지막 가져오기 상태(저장돼 있던 것 또는 방금 결과) */
  state: SalesImportState | null;
  /** 지금 보여 줄 오류(없으면 null) — 저절로 안 닫힘 */
  errorCode: SalesImportErrorCode | null;
  error: string;
  importing: boolean;
  /** "n분 전" 계산용 지금 시각(ms) — 부모가 주기적으로 갱신 */
  nowMs: number;
  onRefresh: () => void;
  /** 'YYYY-MM-DD' 부터 다시 가져오기 */
  onPickDate: (since: string) => void;
}

/**
 * 목록 위 가져오기 띠.
 *   보통  : "영업 웹앱에서 n분 전에 가져옴(새 n·바뀜 n)" + 🔄 새로고침 + ⋯(날짜 골라 다시 가져오기)
 *   키 없음: 회색(저장된 목록은 그대로 보임)
 *   오류  : 주황 + 이유 + 마지막 성공 시각(저절로 안 닫힘)
 * 띠 모양은 계약관리의 .ct-band(good/warn/muted)를 그대로 씀.
 */
export default function ImportStatusBar({ hasKey, state, errorCode, error, importing, nowMs, onRefresh, onPickDate }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [since, setSince] = useState('');

  const noKey = !hasKey || errorCode === 'no_key';
  // errorCode 가 없어도 error 문구가 있으면(예: 고른 날짜를 서버가 거절) 띠로 보여 줌
  const hasError = !noKey && (errorCode !== null || error !== '');
  const tone = noKey ? 'muted' : hasError ? 'warn' : '';
  const lastOk = state?.lastSuccessAt ?? null;
  const ago = agoText(lastOk, nowMs);
  const counts = state?.lastCounts ?? null;

  function openPick() {
    setMenuOpen(false);
    setSince(addDays(kstToday(nowMs), -30));
    setPickOpen(true);
  }

  function submitPick() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return;
    setPickOpen(false);
    onPickDate(since);
  }

  return (
    <>
      <div className={`ct-band sc-importbar${tone ? ` ${tone}` : ''}`} role={hasError ? 'alert' : undefined}>
        <span className="sc-importtext">
          {importing && <span className="nav-spinner sc-spin" aria-hidden="true" />}
          {noKey ? (
            <>영업 웹앱 연결 키가 아직 없어요 — 개발 담당에게 알려 주세요. (이미 저장된 목록은 그대로 보여요)</>
          ) : hasError ? (
            <>
              ⚠ {error || '영업 웹앱에서 가져오지 못했어요.'}
              {ago ? <> · 마지막으로 가져온 때: {ago}</> : <> · 아직 한 번도 가져오지 못했어요</>}
            </>
          ) : importing && !lastOk ? (
            <>영업 웹앱에서 가져오는 중이에요…</>
          ) : lastOk ? (
            <>
              <span suppressHydrationWarning>영업 웹앱에서 {ago}에 가져옴</span>
              {counts ? <> (새 {counts.new} · 바뀜 {counts.updated})</> : null}
              {importing ? <> · 가져오는 중…</> : null}
            </>
          ) : (
            <>아직 영업 웹앱에서 가져온 적이 없어요{importing ? ' — 지금 가져오는 중이에요…' : ''}</>
          )}
        </span>
        <div className="ct-menu-wrap sc-refresh-wrap">
          <button type="button" className="btn btn-ghost sc-btn" disabled={importing || noKey} onClick={onRefresh} title="영업 웹앱에서 지금 다시 가져와요">
            🔄 새로고침
          </button>
        </div>
        <div className="ct-menu-wrap">
          <button
            type="button"
            className="btn btn-ghost sc-btn"
            aria-label="더 보기"
            aria-expanded={menuOpen}
            disabled={noKey}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="ct-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="ct-menu" role="menu">
                <button type="button" role="menuitem" disabled={importing} onClick={openPick}>
                  📅 날짜 골라 다시 가져오기
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {pickOpen && (
        <div className="modal-overlay open" onClick={() => setPickOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="날짜 골라 다시 가져오기" onClick={(e) => e.stopPropagation()}>
            <h2>날짜 골라 다시 가져오기</h2>
            <div className="sub">고른 날부터 영업 웹앱에서 다시 받아요. 이미 있는 확인서는 바뀐 것만 반영돼요. 우리가 적어 둔 처리여부·자산번호는 그대로예요.</div>
            <div className="form-field">
              <label htmlFor="sc-since">이 날부터</label>
              <input id="sc-since" type="date" value={since} min={addDays(kstToday(nowMs), -365)} max={kstToday(nowMs)} onChange={(e) => setSince(e.target.value)} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setPickOpen(false)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" disabled={!since} onClick={submitPick}>
                가져오기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
