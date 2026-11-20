'use client';

import { useCallback, useEffect, useState } from 'react';
import { listSecretLog } from '@/app/contracts/secretActions';
import { SECRET_FIELD_LABEL, type SecretField, type SecretLogRow } from '@/lib/contracts/types';
import { useContractsCtx } from './UnlockDialog';

const KST_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "11. 20. 14:32" 꼴 — 한국 시간 */
export function formatKst(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '-';
  return KST_FORMAT.format(new Date(t));
}

const ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  unlock_ok: { label: '열람 시작', cls: 'badge-임대중' },
  unlock_fail: { label: '인증 틀림', cls: 'badge-수리중' },
  lock: { label: '잠금', cls: 'badge-미정' },
  view: { label: '값 보기', cls: 'badge-상품화준비중' },
  view_bulk: { label: '모두 보기', cls: 'badge-상품화준비중' },
  edit: { label: '수정', cls: 'badge-판매' },
  delete: { label: '삭제', cls: 'badge-수리중' },
  import: { label: '시트 옮기기', cls: 'badge-판매' },
};

function fieldLabel(field: string): string {
  return field in SECRET_FIELD_LABEL ? SECRET_FIELD_LABEL[field as SecretField] : field;
}

type Props = { open: boolean; onClose: () => void };

/** 열람 기록 — 최근 200건. 값은 기록에 없고 누가·언제·무엇만. */
export default function SecretLogView({ open, onClose }: Props) {
  const { onNeedUnlock } = useContractsCtx();
  const [rows, setRows] = useState<SecretLogRow[] | null>(null);
  const [failed24h, setFailed24h] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await listSecretLog(200);
      if (r.ok) {
        setRows(r.rows);
        setFailed24h(r.failed24h);
      } else {
        setRows(null);
        setError(r.error);
        if (r.needUnlock) onNeedUnlock();
      }
    } catch {
      setRows(null);
      setError('기록을 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setLoading(false);
    }
  }, [onNeedUnlock]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal ct-modal">
        <div className="ct-modal-head">
          <h2>🕘 열람 기록</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="sub">누가 언제 소프트웨어 계약을 열고(틀린 비밀번호 포함) 비밀 칸을 고치거나 지웠는지 기록이에요. 값은 기록에 남지 않아요. 최근 200건만 보여요.</div>

        {loading && !rows && (
          <div className="empty-state">
            <div>⏳</div>불러오는 중…
          </div>
        )}
        {error && (
          <div className="empty-state">
            <div>⚠️</div>
            {error}
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button type="button" className="btn btn-ghost" onClick={() => void load()}>
                다시 불러오기
              </button>
            </div>
          </div>
        )}
        {rows && (
          <>
            <div className={`ct-band ${failed24h > 0 ? 'warn' : 'good'}`}>
              최근 24시간 틀린 시도 {failed24h}회{failed24h > 0 ? ' — 모르는 시도라면 인증 비밀번호를 바꿔 주세요.' : ''}
            </div>
            <table className="m-cards">
              <thead>
                <tr>
                  <th data-m="title" data-label="언제">언제</th>
                  <th data-m="badge" data-label="무엇">무엇</th>
                  <th data-m="inline" data-label="누가">누가</th>
                  <th data-m="inline" data-label="거래처">거래처</th>
                  <th data-m="inline" data-label="칸">칸</th>
                  <th data-m="sub" data-label="기기">기기·메모</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const a = ACTION_LABEL[r.action] ?? { label: r.action, cls: 'badge-미정' };
                  return (
                    <tr key={`${r.at}-${i}`}>
                      <td>{formatKst(r.at)}</td>
                      <td>
                        <span className={`badge ${a.cls}`}>
                          {a.label}
                          {r.count > 1 ? ` ×${r.count}` : ''}
                        </span>
                      </td>
                      <td>{r.actor || '-'}</td>
                      <td>{r.clientName || '-'}</td>
                      <td>{r.field ? fieldLabel(r.field) : '-'}</td>
                      <td>{[r.ua, r.note].filter(Boolean).join(' · ') || '-'}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      <div>📋</div>아직 기록이 없어요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
