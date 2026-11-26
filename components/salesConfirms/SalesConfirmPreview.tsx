'use client';

import { useEffect, useState } from 'react';
import { acknowledgeSalesConfirmChange, openSalesConfirmPreview } from '@/app/confirm-form/salesActions';
import {
  SALES_SPEC_KEYS,
  safeDocUrl,
  type SalesConfirmPreviewData,
  type SalesConfirmStatus,
} from '@/lib/salesConfirms/types';
import { fmtDate, fmtDateTime, statusClass } from './format';

interface Props {
  id: string;
  /** 지금 기억된 이름(비어 있어도 열기는 됨) */
  actor: string;
  /** [확인함]처럼 이름이 꼭 필요할 때 이름을 묻고 돌려줌(취소하면 null) */
  ensureActor: () => Promise<string | null>;
  /** 닫음 — 부모가 그 줄의 '새로' 표시를 끔 */
  onClose: (id: string) => void;
  /** 열었을 때 서버가 준 최신 처리 정보(목록 줄의 workUpdatedAt 을 맞춰 두려고 — 안 맞으면 처리여부 바꿀 때 '다른 사람이 고쳤어요'가 뜸) */
  onLoaded: (id: string, info: { workUpdatedAt: string | null; status: SalesConfirmStatus; processors: string[]; note: string }) => void;
  /** [확인함] 성공 */
  onAcknowledged: (id: string, workUpdatedAt: string) => void;
}

type LoadState = { phase: 'loading' } | { phase: 'error'; error: string } | { phase: 'ok'; data: SalesConfirmPreviewData };

/**
 * 영업 확인서 읽기 전용 미리보기 창(1단계 — 2단계부터는 상세 주소로 바뀜).
 * 열 때 서버가 "처음 열어 봄"을 기록해서 목록의 '새로' 표시가 꺼짐. 영업 값은 보기만.
 * 핸드폰에선 .modal 이 아래에서 올라오는 시트가 됨.
 */
export default function SalesConfirmPreview({ id, actor, ensureActor, onClose, onLoaded, onAcknowledged }: Props) {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [tryNo, setTryNo] = useState(0);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoad({ phase: 'loading' });
    openSalesConfirmPreview({ id, actor })
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setLoad({ phase: 'ok', data: res.data });
          onLoaded(id, {
            workUpdatedAt: res.data.workUpdatedAt,
            status: res.data.status,
            processors: res.data.processors,
            note: res.data.note,
          });
        } else {
          setLoad({ phase: 'error', error: res.error });
        }
      })
      .catch((e) => {
        if (alive) setLoad({ phase: 'error', error: e instanceof Error ? e.message : '확인서를 불러오지 못했어요.' });
      });
    return () => {
      alive = false;
    };
    // actor·콜백이 바뀌어도 다시 열지 않음 — 열 때의 id·시도 횟수만 기준
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tryNo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, onClose]);

  async function acknowledge(data: SalesConfirmPreviewData) {
    setAckError('');
    const who = await ensureActor();
    if (who === null) return;
    setAckBusy(true);
    try {
      const res = await acknowledgeSalesConfirmChange({ id, ver: data.confirm.ver, payloadHash: data.payloadHash, actor: who });
      if (res.ok) {
        setLoad({ phase: 'ok', data: { ...data, salesChanged: null, workUpdatedAt: res.workUpdatedAt } });
        onAcknowledged(id, res.workUpdatedAt);
      } else {
        setAckError(res.error || '확인함으로 바꾸지 못했어요.');
      }
    } catch (e) {
      setAckError(e instanceof Error ? e.message : '확인함으로 바꾸지 못했어요.');
    } finally {
      setAckBusy(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => onClose(id)}>
      <div className="modal sc-preview" role="dialog" aria-modal="true" aria-label="영업 확인서 미리보기" onClick={(e) => e.stopPropagation()}>
        {load.phase === 'loading' && (
          <div className="page-loading">
            <span className="nav-spinner" aria-hidden="true" />
            확인서를 불러오는 중이에요…
          </div>
        )}
        {load.phase === 'error' && (
          <>
            <h2>확인서를 열지 못했어요</h2>
            <div className="ct-band warn" role="alert">
              <span>{load.error}</span>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => onClose(id)}>
                닫기
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setTryNo((n) => n + 1)}>
                다시 시도
              </button>
            </div>
          </>
        )}
        {load.phase === 'ok' && <PreviewBody data={load.data} ackBusy={ackBusy} ackError={ackError} onAck={() => void acknowledge(load.data)} onClose={() => onClose(id)} />}
      </div>
    </div>
  );
}

function PreviewBody({
  data,
  ackBusy,
  ackError,
  onAck,
  onClose,
}: {
  data: SalesConfirmPreviewData;
  ackBusy: boolean;
  ackError: string;
  onAck: () => void;
  onClose: () => void;
}) {
  const c = data.confirm;
  const docUrl = safeDocUrl(data.docUrl);
  const hasReplace = c.replaceInfo && (!isBlank(c.replaceInfo.before) || !isBlank(c.replaceInfo.after));

  return (
    <>
      <div className="sc-pv-head">
        <div>
          <h2>{c.company || '(상호 없음)'}</h2>
          <div className="sub" style={{ marginBottom: 0 }}>
            {c.docNo || '-'} · {c.type || '-'}
            {c.term ? ` · ${c.term}` : ''} · 영업 v{c.ver}
          </div>
        </div>
        <span className={`sc-status-tag ${statusClass(data.status)}`}>{data.status}</span>
      </div>

      {data.salesChanged && (
        <div className="ct-band warn sc-pv-band" role="status">
          <span>
            영업에서 수정됨 (v{data.salesChanged.fromVer} → v{data.salesChanged.toVer}) — 아래 내용을 확인하고 [확인함]을 눌러 주세요.
          </span>
          <button type="button" className="btn btn-primary" disabled={ackBusy} onClick={onAck}>
            {ackBusy ? '저장 중…' : '확인함'}
          </button>
        </div>
      )}
      {ackError && (
        <div className="ct-band warn sc-pv-band" role="alert">
          <span>{ackError}</span>
        </div>
      )}

      <div className="detail-grid sc-pv-grid">
        <Field label="납품/교체일" value={fmtDate(c.deliveryDate)} />
        <Field label="접수자" value={c.savedBy} />
        <Field label="영업담당" value={c.salesRep} />
        <Field label="지역" value={c.region} />
        <Field label="주소" value={c.address} wide />
        <Field label="IT 담당" value={c.contacts.manager} />
        <Field label="현장 상주" value={c.contacts.resident} />
        <Field label="결제 담당" value={c.contacts.payer} />
        <Field label="연락처" value={c.contacts.phone} />
        <Field label="처리자" value={data.processors.join(', ')} />
        <Field label="비고" value={data.note} />
      </div>

      <div className="detail-section-title">품목</div>
      {c.items.length === 0 ? (
        <div className="detail-empty">품목이 없어요.</div>
      ) : (
        <div className="sc-scroll">
          <table className="m-cards sc-mini">
            <thead>
              <tr>
                <th data-m="title">종류</th>
                <th>제조사</th>
                <th data-m="inline" data-label="모델">모델</th>
                <th data-m="inline" data-label="상태">새/중고</th>
                <th data-m="badge">수량</th>
                <th data-m="full" data-label="사양">사양</th>
                <th data-m="full" data-label="설치장소">설치장소</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it, i) => {
                const specs = SALES_SPEC_KEYS.filter((k) => (it.spec[k] ?? '').trim());
                return (
                  <tr key={i}>
                    <td>{it.cat || '기타'}</td>
                    <td>{it.maker || '-'}</td>
                    <td>{it.model || '-'}</td>
                    <td>{it.state || '-'}</td>
                    <td>{it.qty}</td>
                    <td>
                      {specs.length === 0 ? (
                        '-'
                      ) : (
                        <span className="sc-specs">
                          {specs.map((k) => (
                            <span key={k} className="sc-spec">
                              <b>{k}</b> {it.spec[k]}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>{it.place || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="detail-section-title">소모품</div>
      {c.supplies.length === 0 ? (
        <div className="detail-empty">소모품이 없어요.</div>
      ) : (
        <div className="sc-scroll">
          <table className="m-cards sc-mini">
            <thead>
              <tr>
                <th data-m="title">이름</th>
                <th data-m="badge">수량</th>
                <th data-m="inline" data-label="">무상/청구</th>
                <th data-m="full" data-label="메모">메모</th>
              </tr>
            </thead>
            <tbody>
              {c.supplies.map((s, i) => (
                <tr key={i}>
                  <td>{s.name || '-'}</td>
                  <td>{s.qty}</td>
                  <td>{s.charge || '-'}</td>
                  <td>{s.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="detail-section-title">특이사항</div>
      {c.special.trim() ? <div className="sc-pre">{c.special}</div> : <div className="detail-empty">적힌 특이사항이 없어요.</div>}

      {hasReplace && c.replaceInfo && (
        <>
          <div className="detail-section-title">교체 내용</div>
          <div className="sc-replace">
            <div>
              <div className="detail-label">교체 전</div>
              <Unknown value={c.replaceInfo.before} />
            </div>
            <div>
              <div className="detail-label">교체 후</div>
              <Unknown value={c.replaceInfo.after} />
            </div>
          </div>
        </>
      )}

      <div className="sc-pv-meta">
        영업 웹앱에서 받은 버전 {data.versionCount}개 (지금 v{c.ver}) · 처음 받은 때 {fmtDateTime(data.firstSeenAt)}
        {data.changedAt ? ` · 바뀐 때 ${fmtDateTime(data.changedAt)}` : ''} · 마지막으로 받은 때 {fmtDateTime(data.fetchedAt)}
      </div>
      <div className="sc-pv-hint">자산번호·시리얼·사양 고치기는 다음 단계에서 이 창에 붙어요. 지금은 보기만 돼요.</div>

      <div className="modal-footer">
        {docUrl && (
          <a className="btn btn-ghost" href={docUrl} target="_blank" rel="noopener noreferrer">
            영업 원본 열기 ↗
          </a>
        )}
        <button type="button" className="btn btn-primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className="detail-field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value && value.trim() ? value : '-'}</span>
    </div>
  );
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0 || v.every(isBlank);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isBlank);
  return false;
}

/** 모양을 모르는 값(문자열·숫자·목록·객체)을 안전하게 읽기 좋게 — 깊이 4까지 */
function Unknown({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isBlank(value)) return <div className="detail-empty">-</div>;
  if (typeof value === 'string') return <div className="sc-pre">{value}</div>;
  if (typeof value === 'number' || typeof value === 'boolean') return <div className="sc-pre">{String(value)}</div>;
  if (depth >= 4) return <div className="sc-pre">(내용이 너무 깊어서 줄였어요)</div>;
  if (Array.isArray(value)) {
    return (
      <ul className="sc-unk-list">
        {value
          .filter((v) => !isBlank(v))
          .map((v, i) => (
            <li key={i}>
              <Unknown value={v} depth={depth + 1} />
            </li>
          ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => !isBlank(v));
    return (
      <dl className="sc-unk-dl">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <Unknown value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <div className="sc-pre">{String(value)}</div>;
}
