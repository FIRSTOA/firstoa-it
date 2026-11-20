'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addClientAlias, deleteClient, getClientDetail, saveClient } from '@/app/contracts/actions';
import type { ClientDetail, ClientInput, ClientSummary } from '@/lib/contracts/types';
import SwContractCard from './SwContractCard';
import { requireActor, useContractsCtx } from './UnlockDialog';

type Props = {
  clientKey: string;
  /** 목록에 있는 거래처들(옮기기·합치기 고르는 목록) */
  clients: ClientSummary[];
  onClose: () => void;
  /** 저장·삭제 뒤 바깥 목록을 다시 읽게 */
  onChanged: () => void;
};

type InfoForm = {
  name: string;
  keyPerson: string;
  keyPhone: string;
  salesOwner: string;
  itOwner: string;
  memo: string;
  manualStatus: ClientInput['manualStatus'];
};

function infoOf(d: ClientDetail): InfoForm {
  return {
    name: d.client.name,
    keyPerson: d.client.keyPerson,
    keyPhone: d.client.keyPhone,
    salesOwner: d.client.salesOwner,
    itOwner: d.client.itOwner,
    memo: d.client.memo,
    manualStatus: d.client.manualStatus,
  };
}

export default function SwClientModal({ clientKey, clients, onClose, onChanged }: Props) {
  const { toast } = useContractsCtx();
  const [key, setKey] = useState(clientKey);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<InfoForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [mergeKey, setMergeKey] = useState('');
  const [linesOpen, setLinesOpen] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async (k: string, silent: boolean) => {
    const id = ++reqRef.current;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const r = await getClientDetail(k);
      if (id !== reqRef.current) return;
      if (r.ok) {
        setDetail(r.detail);
        if (!silent) setInfo(infoOf(r.detail)); // 조용히 다시 읽을 땐 쓰던 칸을 덮지 않음
        setError('');
      } else {
        if (!silent) setDetail(null);
        setError(r.error);
      }
    } catch {
      if (id === reqRef.current) {
        if (!silent) setDetail(null);
        setError('거래처 정보를 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
      }
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(key, false);
  }, [key, load]);

  /** 상품·좌석을 고친 뒤 — 거래처가 새로 만들어졌으면 그 id 로 바꿔 읽음 */
  function afterChange(clientId?: string) {
    onChanged();
    setAdding(false);
    if (clientId && clientId !== key) setKey(clientId);
    else void load(key, true);
  }

  async function saveInfo() {
    if (!detail || !info) return;
    if (!info.name.trim()) {
      toast('거래처 이름을 적어 주세요.');
      return;
    }
    const actor = requireActor();
    if (!actor) {
      toast('이름을 적어야 저장할 수 있어요.');
      return;
    }
    setSaving(true);
    try {
      const r = await saveClient(
        {
          key: detail.client.key,
          name: info.name.trim(),
          keyPerson: info.keyPerson.trim(),
          keyPhone: info.keyPhone.trim(),
          salesOwner: info.salesOwner.trim(),
          itOwner: info.itOwner.trim(),
          memo: info.memo,
          manualStatus: info.manualStatus,
        },
        actor,
      );
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('거래처 정보를 저장했어요.');
      onChanged();
      if (r.id !== key) setKey(r.id);
      else void load(key, true);
    } catch {
      toast('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  async function merge() {
    if (!detail?.client.id || !mergeKey) return;
    const other = clients.find((c) => c.key === mergeKey);
    if (!window.confirm(`"${other?.name ?? '선택한 거래처'}"도 이 거래처(${detail.client.name})와 같은 곳으로 묶을까요?`)) return;
    const actor = requireActor();
    if (!actor) {
      toast('이름을 적어야 저장할 수 있어요.');
      return;
    }
    setSaving(true);
    try {
      const r = await addClientAlias(detail.client.id, mergeKey, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('같은 거래처로 묶었어요.');
      setMergeKey('');
      onChanged();
      void load(key, true);
    } catch {
      toast('묶지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!detail?.client.id) return;
    if (!window.confirm(`"${detail.client.name}" 거래처를 지울까요? 되돌릴 수 없어요.`)) return;
    const actor = requireActor();
    if (!actor) {
      toast('이름을 적어야 지울 수 있어요.');
      return;
    }
    setSaving(true);
    try {
      const r = await deleteClient(detail.client.id, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('거래처를 지웠어요.');
      onChanged();
      onClose();
    } catch {
      toast('지우지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  const setI = <K extends keyof InfoForm>(k: K, v: InfoForm[K]) => setInfo((f) => (f ? { ...f, [k]: v } : f));
  const c = detail?.client;
  const sourceNote =
    detail?.source === 'rental_copy'
      ? 'works를 못 읽어서 임대리스트 사본으로 보여 드려요.'
      : detail?.source === 'none'
        ? 'works를 읽지 못해 아래 임대 줄을 보여 드릴 수 없어요. 저장된 정보만 보여요.'
        : '';

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="modal ct-modal">
        <div className="ct-modal-head">
          <h2>{c ? c.name : '거래처'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {loading && !detail && (
          <div className="empty-state">
            <div>⏳</div>불러오는 중…
          </div>
        )}
        {error && (
          <div className="ct-band bad">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost" onClick={() => void load(key, false)}>
              다시 읽기
            </button>
          </div>
        )}

        {detail && c && info && (
          <>
            {c.notice && <div className="ct-band warn">{c.notice}</div>}
            {sourceNote && <div className="ct-band warn">{sourceNote}</div>}
            {c.needsDetail && !c.id && (
              <div className="ct-band muted">아직 저장한 적 없는 거래처예요. 정보나 계약 상품을 저장하면 목록에 기록돼요.</div>
            )}

            <div className="ct-section-title">
              <span>거래처 정보</span>
            </div>
            <div className="form-grid">
              <div className="form-field full">
                <label>거래처 이름</label>
                <input value={info.name} onChange={(e) => setI('name', e.target.value)} />
              </div>
              <div className="form-field">
                <label>키맨</label>
                <input value={info.keyPerson} onChange={(e) => setI('keyPerson', e.target.value)} />
              </div>
              <div className="form-field">
                <label>키맨 연락처</label>
                <input type="tel" value={info.keyPhone} onChange={(e) => setI('keyPhone', e.target.value)} />
              </div>
              <div className="form-field">
                <label>퍼스트 영업 담당</label>
                <input value={info.salesOwner} onChange={(e) => setI('salesOwner', e.target.value)} />
              </div>
              <div className="form-field">
                <label>퍼스트 전산 담당</label>
                <input value={info.itOwner} onChange={(e) => setI('itOwner', e.target.value)} />
              </div>
              <div className="form-field full">
                <label>표시 방식</label>
                <select value={info.manualStatus} onChange={(e) => setI('manualStatus', e.target.value as InfoForm['manualStatus'])}>
                  <option value="">자동 (works 기준)</option>
                  <option value="ended">계약 종료로 표시</option>
                  <option value="hidden">목록에서 숨김</option>
                </select>
              </div>
              <div className="form-field full">
                <label>메모</label>
                <textarea rows={2} value={info.memo} onChange={(e) => setI('memo', e.target.value)} />
              </div>
            </div>
            <div className="ct-btnrow">
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveInfo()}>
                {saving ? '저장 중…' : '거래처 정보 저장'}
              </button>
              {c.id && detail.contracts.length === 0 && (
                <button type="button" className="btn btn-ghost ct-danger" disabled={saving} onClick={() => void remove()}>
                  거래처 지우기
                </button>
              )}
            </div>
            {c.id && (
              <details className="ct-details">
                <summary>같은 거래처로 합치기</summary>
                <div className="ct-inline-form">
                  <select value={mergeKey} onChange={(e) => setMergeKey(e.target.value)} aria-label="같은 곳으로 묶을 거래처">
                    <option value="">같은 곳인 거래처를 고르세요</option>
                    {clients
                      .filter((x) => x.key !== c.key)
                      .map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                  <button type="button" className="btn btn-ghost" disabled={saving || !mergeKey} onClick={() => void merge()}>
                    묶기
                  </button>
                </div>
              </details>
            )}

            <details className="ct-details" open={linesOpen} onToggle={(e) => setLinesOpen((e.target as HTMLDetailsElement).open)}>
              <summary>works 임대 줄 {detail.lines.length}개 (자산번호·모델·현장)</summary>
              {detail.lines.length === 0 ? (
                <div className="empty-state">
                  <div>📋</div>
                  {detail.source === 'none' ? 'works를 읽지 못했어요.' : 'works에서 이 거래처의 소프트웨어 줄을 찾지 못했어요.'}
                </div>
              ) : (
                <table className="m-cards">
                  <thead>
                    <tr>
                      <th data-m="title" data-label="자산번호">자산번호</th>
                      <th data-m="badge" data-label="상태">상태</th>
                      <th data-m="inline" data-label="순">순</th>
                      <th data-m="inline" data-label="모델">모델</th>
                      <th data-m="sub" data-label="현장">현장</th>
                      <th data-m="hide">계약일</th>
                      <th data-m="hide">종료일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.assetId}>
                        <td>{l.assetCode || '(번호 없음)'}</td>
                        <td>
                          <span className={`badge ${l.status === '임대종료' ? 'badge-미정' : 'badge-임대중'}`}>{l.status || '-'}</span>
                        </td>
                        <td>{l.seq || '-'}</td>
                        <td>{l.modelName || '-'}</td>
                        <td>{l.siteName || '-'}</td>
                        <td>{l.contractDate || '-'}</td>
                        <td>{l.endDate || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>

            <div className="ct-section-title ct-section-big">
              <span>계약 상품 {detail.contracts.length}개</span>
              {!adding && (
                <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                  ＋ 상품 추가
                </button>
              )}
            </div>
            {adding && <SwContractCard contract={null} clientKey={c.key} clients={clients} onChanged={afterChange} onCancelNew={() => setAdding(false)} />}
            {detail.contracts.map((ct) => (
              <SwContractCard key={ct.id} contract={ct} clientKey={c.key} clients={clients} onChanged={afterChange} />
            ))}
            {detail.contracts.length === 0 && !adding && (
              <div className="empty-state">
                <div>📑</div>아직 계약 상품이 없어요. [상품 추가]로 이 거래처가 쓰는 소프트웨어를 적어 주세요.
              </div>
            )}
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
