'use client';

import { useState } from 'react';
import { moveSwContract, renewSwContract, addSwSeats, deleteSwContract, saveSwContract, saveSwSeat } from '@/app/contracts/actions';
import { deleteSwSeat, revealContractSecrets } from '@/app/contracts/secretActions';
import {
  SW_CONTRACT_STATUSES,
  SW_SEAT_STATUSES,
  type ClientSummary,
  type LicenseType,
  type RenewalState,
  type SwContract,
  type SwContractInput,
  type SwSeat,
  type SwSeatInput,
} from '@/lib/contracts/types';
import { SecretFields, secretKey, useAutoHide, type BulkSecrets } from './SecretValue';
import { requireActor, useContractsCtx } from './UnlockDialog';

export const RENEWAL_BADGE: Record<RenewalState, { cls: string; label: string }> = {
  expired: { cls: 'badge-수리중', label: '날짜 지남' },
  due30: { cls: 'badge-상품화준비중', label: '30일 안' },
  ok: { cls: 'badge-상품화완료', label: '날짜 정상' },
  nodate: { cls: 'badge-미정', label: '날짜 없음' },
};

const LICENSE_LABEL: Record<LicenseType, string> = {
  perpetual: '영구(한 번 구매)',
  subscription: '구독',
  free: '무료',
  unknown: '모름',
};
const TERM_LABEL = { '': '-', monthly: '월 단위', yearly: '연 단위' } as const;
const PAY_LABEL = { '': '-', monthly: '월 결제', yearly: '연 결제', once: '한 번 결제' } as const;

type ContractForm = {
  product: string;
  supplier: string;
  licenseType: LicenseType;
  term: SwContractInput['term'];
  payCycle: SwContractInput['payCycle'];
  quantity: string;
  startsOn: string;
  renewsOn: string;
  endsOn: string;
  costNote: string;
  adminPortal: string;
  setupVendor: string;
  status: SwContractInput['status'];
  memo: string;
};

function formOf(c: SwContract | null): ContractForm {
  return {
    product: c?.product ?? '',
    supplier: c?.supplier ?? '',
    licenseType: c?.licenseType ?? 'subscription',
    term: c?.term ?? '',
    payCycle: c?.payCycle ?? '',
    quantity: c?.quantity === null || c?.quantity === undefined ? '' : String(c.quantity),
    startsOn: c?.startsOn ?? '',
    renewsOn: c?.renewsOn ?? '',
    endsOn: c?.endsOn ?? '',
    costNote: c?.costNote ?? '',
    adminPortal: c?.adminPortal ?? '',
    setupVendor: c?.setupVendor ?? '',
    status: (SW_CONTRACT_STATUSES as readonly string[]).includes(c?.status ?? '') ? (c?.status as SwContractInput['status']) : '사용중',
    memo: c?.memo ?? '',
  };
}

type SeatForm = {
  userName: string;
  dept: string;
  pcAssetCode: string;
  mfaNote: string;
  worksAssetId: string;
  worksSeq: string;
  installedOn: string;
  purchasedOn: string;
  renewsOn: string;
  endsOn: string;
  status: SwSeatInput['status'];
  memo: string;
};

function seatFormOf(s: SwSeat): SeatForm {
  return {
    userName: s.userName,
    dept: s.dept,
    pcAssetCode: s.pcAssetCode,
    mfaNote: s.mfaNote,
    worksAssetId: s.worksAssetId === null ? '' : String(s.worksAssetId),
    worksSeq: s.worksSeq,
    installedOn: s.installedOn ?? '',
    purchasedOn: s.purchasedOn ?? '',
    renewsOn: s.renewsOn ?? '',
    endsOn: s.endsOn ?? '',
    status: (SW_SEAT_STATUSES as readonly string[]).includes(s.status) ? (s.status as SwSeatInput['status']) : '사용중',
    memo: s.memo,
  };
}

const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

type Props = {
  /** null = 새 상품 만들기 */
  contract: SwContract | null;
  /** 저장된 거래처는 id, 아직 없으면 'new:…' */
  clientKey: string;
  /** 옮기기 목록 */
  clients: ClientSummary[];
  /** 저장·삭제 뒤 — 거래처 창이 다시 읽음. clientId 가 오면 그 거래처로 바꿔 읽음 */
  onChanged: (clientId?: string) => void;
  onCancelNew?: () => void;
};

export default function SwContractCard({ contract, clientKey, clients, onChanged, onCancelNew }: Props) {
  const { unlock, askUnlock, toast } = useContractsCtx();
  const isNew = contract === null;
  const [editing, setEditing] = useState(isNew);
  const [form, setForm] = useState<ContractForm>(() => formOf(contract));
  const [busy, setBusy] = useState(false);
  const [seatEditId, setSeatEditId] = useState<string | null>(null);
  const [seatForm, setSeatForm] = useState<SeatForm | null>(null);
  const [addCount, setAddCount] = useState('1');
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [bulk, setBulk] = useState<BulkSecrets | undefined>(undefined);

  const seats = contract?.seats ?? [];
  const set = <K extends keyof ContractForm>(k: K, v: ContractForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setSeat = <K extends keyof SeatForm>(k: K, v: SeatForm[K]) => setSeatForm((f) => (f ? { ...f, [k]: v } : f));

  const hasAnySecret = !!contract && (contract.secretFields.length > 0 || contract.seats.some((s) => s.secretFields.length > 0));
  // 모두 보기로 받은 값은 60초 뒤·탭이 숨겨지면 비움(칸마다 자기 시간도 따로 있음)
  useAutoHide(!!bulk, !!bulk, () => setBulk(undefined));

  function actorOrWarn(): string | null {
    const a = requireActor();
    if (!a) toast('이름을 적어야 저장할 수 있어요.');
    return a;
  }

  async function run(fn: () => Promise<void>, failMsg: string) {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast(failMsg);
    } finally {
      setBusy(false);
    }
  }

  async function saveContract() {
    if (!form.product.trim()) {
      toast('상품 이름을 적어 주세요.');
      return;
    }
    const q = form.quantity.trim();
    if (q && !/^\d+$/.test(q)) {
      toast('수량은 숫자로 적어 주세요.');
      return;
    }
    const actor = actorOrWarn();
    if (!actor) return;
    const input: SwContractInput = {
      id: contract?.id ?? null,
      clientKey,
      product: form.product.trim(),
      supplier: form.supplier.trim(),
      licenseType: form.licenseType,
      term: form.term,
      payCycle: form.payCycle,
      quantity: q ? Number(q) : null,
      startsOn: orNull(form.startsOn),
      renewsOn: orNull(form.renewsOn),
      endsOn: orNull(form.endsOn),
      costNote: form.costNote.trim(),
      adminPortal: form.adminPortal.trim(),
      setupVendor: form.setupVendor.trim(),
      status: form.status,
      memo: form.memo,
    };
    await run(async () => {
      const r = await saveSwContract(input, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('저장했어요.');
      setEditing(false);
      onChanged(r.clientId);
    }, '저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async function renew() {
    if (!contract) return;
    if (!window.confirm(`"${contract.product}"의 갱신일을 다음 주기로 미룰까요?`)) return;
    const actor = actorOrWarn();
    if (!actor) return;
    await run(async () => {
      const r = await renewSwContract(contract.id, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast(r.renewsOn ? `갱신 처리했어요. 다음 갱신일 ${r.renewsOn}` : '갱신 처리했어요.');
      onChanged();
    }, '갱신 처리하지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async function move() {
    if (!contract || !moveTo) return;
    const target = clients.find((c) => c.key === moveTo);
    if (!window.confirm(`"${contract.product}"을(를) ${target?.name ?? '선택한 거래처'}(으)로 옮길까요? 좌석도 같이 옮겨져요.`)) return;
    const actor = actorOrWarn();
    if (!actor) return;
    await run(async () => {
      const r = await moveSwContract(contract.id, moveTo, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('옮겼어요.');
      setMoving(false);
      onChanged();
    }, '옮기지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async function removeContract() {
    if (!contract) return;
    if (!window.confirm(`"${contract.product}" 계약 상품을 지울까요? 되돌릴 수 없어요.`)) return;
    await run(async () => {
      const r = await deleteSwContract(contract.id);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('지웠어요.');
      onChanged();
    }, '지우지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async function addSeats() {
    if (!contract) return;
    const n = Number(addCount);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      toast('좌석 수는 1~200 사이 숫자로 적어 주세요.');
      return;
    }
    const actor = actorOrWarn();
    if (!actor) return;
    await run(async () => {
      const r = await addSwSeats(contract.id, n, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast(`좌석 ${r.ids.length}개를 만들었어요.`);
      setAddCount('1');
      onChanged();
    }, '좌석을 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async function saveSeat(seat: SwSeat) {
    if (!seatForm || !contract) return;
    const wid = seatForm.worksAssetId.trim();
    if (wid && !/^\d+$/.test(wid)) {
      toast('임대 건 번호는 숫자로 적어 주세요.');
      return;
    }
    const actor = actorOrWarn();
    if (!actor) return;
    const input: SwSeatInput = {
      id: seat.id,
      contractId: contract.id,
      userName: seatForm.userName.trim(),
      dept: seatForm.dept.trim(),
      pcAssetCode: seatForm.pcAssetCode.trim().toUpperCase().replace(/\s+/g, ''),
      mfaNote: seatForm.mfaNote,
      worksAssetId: wid ? Number(wid) : null,
      worksSeq: seatForm.worksSeq.trim(),
      installedOn: orNull(seatForm.installedOn),
      purchasedOn: orNull(seatForm.purchasedOn),
      renewsOn: orNull(seatForm.renewsOn),
      endsOn: orNull(seatForm.endsOn),
      status: seatForm.status,
      memo: seatForm.memo,
    };
    await run(async () => {
      const r = await saveSwSeat(input, actor);
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast('좌석을 저장했어요.');
      setSeatEditId(null);
      setSeatForm(null);
      onChanged();
    }, '좌석을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async function removeSeat(seat: SwSeat) {
    const msg = seat.secretFields.length > 0
      ? `${seat.userName || '이 좌석'}을(를) 지울까요? 저장된 비밀 칸 ${seat.secretFields.length}개도 같이 지워져요. 되돌릴 수 없어요.`
      : `${seat.userName || '이 좌석'}을(를) 지울까요? 되돌릴 수 없어요.`;
    if (!window.confirm(msg)) return;
    await run(async () => {
      const r = await deleteSwSeat(seat.id);
      if (r.ok) {
        toast('좌석을 지웠어요.');
        onChanged();
        return;
      }
      if (r.needUnlock) {
        toast('비밀 칸이 있는 좌석은 열람 중에만 지울 수 있어요.');
        askUnlock(() => void removeSeat(seat));
        return;
      }
      toast(r.error);
    }, '좌석을 지우지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async function revealAll() {
    if (!contract) return;
    await run(async () => {
      const r = await revealContractSecrets(contract.id);
      if (r.ok) {
        const values: Record<string, string> = {};
        for (const v of r.values) values[secretKey(v.owner, v.field)] = v.value;
        setBulk({ nonce: Date.now(), values });
        toast(`${r.values.length}개 칸을 열었어요. 60초 뒤 다시 가려져요.`);
        return;
      }
      if (r.needUnlock) {
        askUnlock(() => void revealAll());
        return;
      }
      toast(r.error);
    }, '값을 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  // ---------- 편집 칸(상품) ----------
  const contractForm = (
    <div className="ct-form">
      <div className="form-grid">
        <div className="form-field">
          <label>상품 이름 <span className="required">*</span></label>
          <input value={form.product} onChange={(e) => set('product', e.target.value)} placeholder="예: Microsoft 365 Apps" />
        </div>
        <div className="form-field">
          <label>매입처</label>
          <input value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
        </div>
        <div className="form-field">
          <label>라이선스 종류</label>
          <select value={form.licenseType} onChange={(e) => set('licenseType', e.target.value as LicenseType)}>
            {(Object.keys(LICENSE_LABEL) as LicenseType[]).map((k) => (
              <option key={k} value={k}>{LICENSE_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>상태</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value as SwContractInput['status'])}>
            {SW_CONTRACT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>구독 단위</label>
          <select value={form.term} onChange={(e) => set('term', e.target.value as ContractForm['term'])}>
            {(Object.keys(TERM_LABEL) as (keyof typeof TERM_LABEL)[]).map((k) => (
              <option key={k} value={k}>{k === '' ? '없음' : TERM_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>결제 주기</label>
          <select value={form.payCycle} onChange={(e) => set('payCycle', e.target.value as ContractForm['payCycle'])}>
            {(Object.keys(PAY_LABEL) as (keyof typeof PAY_LABEL)[]).map((k) => (
              <option key={k} value={k}>{k === '' ? '없음' : PAY_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>수량 (비우면 좌석 수로 셈)</label>
          <input inputMode="numeric" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </div>
        <div className="form-field">
          <label>시작일</label>
          <input type="date" value={form.startsOn} onChange={(e) => set('startsOn', e.target.value)} />
        </div>
        <div className="form-field">
          <label>다음 갱신일</label>
          <input type="date" value={form.renewsOn} onChange={(e) => set('renewsOn', e.target.value)} />
        </div>
        <div className="form-field">
          <label>만료일</label>
          <input type="date" value={form.endsOn} onChange={(e) => set('endsOn', e.target.value)} />
        </div>
        <div className="form-field">
          <label>비용 (적은 대로)</label>
          <input value={form.costNote} onChange={(e) => set('costNote', e.target.value)} />
        </div>
        <div className="form-field">
          <label>관리 콘솔 주소</label>
          <input value={form.adminPortal} onChange={(e) => set('adminPortal', e.target.value)} placeholder="예: admin.microsoft.com" />
        </div>
        <div className="form-field">
          <label>초기 세팅 업체</label>
          <input value={form.setupVendor} onChange={(e) => set('setupVendor', e.target.value)} />
        </div>
        <div className="form-field full">
          <label>메모</label>
          <textarea rows={2} value={form.memo} onChange={(e) => set('memo', e.target.value)} />
        </div>
      </div>
      <div className="ct-btnrow">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveContract()}>
          {busy ? '저장 중…' : isNew ? '상품 추가' : '저장'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            if (isNew) onCancelNew?.();
            else {
              setForm(formOf(contract));
              setEditing(false);
            }
          }}
        >
          취소
        </button>
      </div>
    </div>
  );

  if (contract === null) {
    return (
      <div className="ct-card ct-card-new">
        <div className="ct-card-title">＋ 새 계약 상품</div>
        {contractForm}
      </div>
    );
  }

  const c = contract;
  const rb = RENEWAL_BADGE[c.renewal];
  const qtyDiffers = c.quantity !== null && c.quantity !== seats.length;
  const statusCls = c.status === '사용중' ? 'badge-상품화완료' : c.status === '보류' ? 'badge-상품화준비중' : 'badge-미정';

  const editingSeat = seatEditId ? seats.find((s) => s.id === seatEditId) ?? null : null;

  return (
    <div className="ct-card">
      <div className="ct-card-head">
        <div className="ct-card-title">{c.product}</div>
        <span className={`badge ${statusCls}`}>{c.status}</span>
        <span className={`badge ${rb.cls}`}>
          {rb.label}
          {c.nextDate ? ` · ${c.nextDate}` : ''}
        </span>
        <span className="ct-muted">
          {LICENSE_LABEL[c.licenseType]}
          {c.supplier ? ` · ${c.supplier}` : ''}
        </span>
      </div>

      {editing ? (
        contractForm
      ) : (
        <>
          <dl className="ct-kv">
            <div><dt>수량 / 좌석</dt><dd>{c.quantity ?? '-'}{qtyDiffers ? <span className="ct-warn"> (좌석 {seats.length}개와 달라요)</span> : ` / 좌석 ${seats.length}개`}</dd></div>
            <div><dt>구독 · 결제</dt><dd>{TERM_LABEL[c.term]} · {PAY_LABEL[c.payCycle]}</dd></div>
            <div><dt>시작일</dt><dd>{c.startsOn ?? '-'}</dd></div>
            <div><dt>다음 갱신일</dt><dd>{c.renewsOn ?? '-'}</dd></div>
            <div><dt>만료일</dt><dd>{c.endsOn ?? '-'}</dd></div>
            <div><dt>비용</dt><dd>{c.costNote || '-'}</dd></div>
            <div><dt>관리 콘솔</dt><dd>{c.adminPortal || '-'}</dd></div>
            <div><dt>초기 세팅 업체</dt><dd>{c.setupVendor || '-'}</dd></div>
            {c.licenseTypeRaw && <div><dt>시트 원문 유형</dt><dd>{c.licenseTypeRaw}</dd></div>}
            {c.memo && <div className="ct-kv-wide"><dt>메모</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.memo}</dd></div>}
          </dl>
          <div className="ct-btnrow">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setForm(formOf(c)); setEditing(true); }}>
              수정
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void renew()}>
              갱신 처리
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setMoving((m) => !m)}>
              다른 거래처로 옮기기
            </button>
            {seats.length === 0 && (
              <button type="button" className="btn btn-ghost ct-danger" disabled={busy} onClick={() => void removeContract()}>
                상품 지우기
              </button>
            )}
          </div>
          {moving && (
            <div className="ct-inline-form">
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="옮길 거래처">
                <option value="">옮길 거래처를 고르세요</option>
                {clients
                  .filter((x) => x.key !== clientKey)
                  .map((x) => (
                    <option key={x.key} value={x.key}>{x.name}</option>
                  ))}
              </select>
              <button type="button" className="btn btn-primary" disabled={busy || !moveTo} onClick={() => void move()}>
                옮기기
              </button>
            </div>
          )}
        </>
      )}

      {/* 계약 단위 비밀 칸(관리 콘솔 계정·결제 카드 등) */}
      <div className="ct-section-title">
        <span>🔒 상품 비밀 칸 (관리 콘솔 계정·결제 카드 등)</span>
        {hasAnySecret && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void revealAll()}>
            이 상품 모두 보기
          </button>
        )}
      </div>
      <SecretFields owner={{ contractId: c.id }} fields={c.secretFields} bulk={bulk} onChanged={() => onChanged()} />

      <div className="ct-section-title">
        <span>사용자(좌석) {seats.length}개</span>
      </div>
      <table className="m-cards ct-seat-table">
        <thead>
          <tr>
            <th data-m="title" data-label="사용자">사용자</th>
            <th data-m="badge" data-label="상태">상태</th>
            <th data-m="inline" data-label="PC">PC 자산번호</th>
            <th data-m="inline" data-label="부서">부서</th>
            <th data-m="sub" data-label="날짜">날짜</th>
            <th data-m="full" data-label="2차인증">2차인증 메모</th>
            <th data-m="full nolabel">비밀 칸</th>
            <th data-m="actions"></th>
          </tr>
        </thead>
        <tbody>
          {seats.map((s) => (
            <tr key={s.id}>
              <td>{s.userName || '(사용자 없음)'}</td>
              <td>
                <span className={`badge ${s.status === '사용중' ? 'badge-상품화완료' : s.status === '미배정' ? 'badge-상품화준비중' : 'badge-미정'}`}>{s.status}</span>
              </td>
              <td>
                {s.pcAssetCode ? (
                  <a className="asset-id" href={`/?asset=${encodeURIComponent(s.pcAssetCode)}`} target="_blank" rel="noreferrer">
                    {s.pcAssetCode}
                  </a>
                ) : (
                  '-'
                )}
              </td>
              <td>{s.dept || '-'}</td>
              <td className="ct-dates">
                {[s.installedOn && `설치 ${s.installedOn}`, s.purchasedOn && `구매 ${s.purchasedOn}`, s.renewsOn && `갱신 ${s.renewsOn}`, s.endsOn && `만료 ${s.endsOn}`]
                  .filter(Boolean)
                  .join(' · ') || '-'}
              </td>
              <td style={{ whiteSpace: 'pre-wrap' }}>{s.mfaNote || '-'}</td>
              <td>
                <SecretFields owner={{ seatId: s.id }} fields={s.secretFields} bulk={bulk} onChanged={() => onChanged()} />
              </td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost ct-small"
                    disabled={busy}
                    onClick={() => {
                      setSeatEditId(s.id);
                      setSeatForm(seatFormOf(s));
                    }}
                  >
                    편집
                  </button>
                  <button type="button" className="btn btn-ghost ct-small ct-danger" disabled={busy} onClick={() => void removeSeat(s)}>
                    {s.secretFields.length > 0 && !unlock.unlocked ? '🔒 삭제' : '삭제'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {seats.length === 0 && (
            <tr>
              <td colSpan={8} className="empty-state">
                <div>👤</div>아직 사용자(좌석)가 없어요. 아래에서 좌석을 추가해 주세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {bulk && <div className="ct-muted ct-bulk-note">모두 보기로 연 칸 {Object.keys(bulk.values).length}개 — 60초 뒤 가려져요.</div>}

      {editingSeat && seatForm && (
        <div className="ct-card ct-card-edit">
          <div className="ct-card-title">좌석 편집 · {editingSeat.userName || '(사용자 없음)'}</div>
          <div className="form-grid">
            <div className="form-field">
              <label>사용자</label>
              <input value={seatForm.userName} onChange={(e) => setSeat('userName', e.target.value)} />
            </div>
            <div className="form-field">
              <label>부서</label>
              <input value={seatForm.dept} onChange={(e) => setSeat('dept', e.target.value)} />
            </div>
            <div className="form-field">
              <label>설치 PC 자산번호</label>
              <input value={seatForm.pcAssetCode} onChange={(e) => setSeat('pcAssetCode', e.target.value)} autoCapitalize="characters" />
            </div>
            <div className="form-field">
              <label>상태</label>
              <select value={seatForm.status} onChange={(e) => setSeat('status', e.target.value as SwSeatInput['status'])}>
                {SW_SEAT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="form-field full">
              <label>2차인증 메모 (가려지지 않는 칸이에요)</label>
              <textarea rows={2} value={seatForm.mfaNote} onChange={(e) => setSeat('mfaNote', e.target.value)} />
            </div>
            <div className="form-field">
              <label>설치일</label>
              <input type="date" value={seatForm.installedOn} onChange={(e) => setSeat('installedOn', e.target.value)} />
            </div>
            <div className="form-field">
              <label>구매일</label>
              <input type="date" value={seatForm.purchasedOn} onChange={(e) => setSeat('purchasedOn', e.target.value)} />
            </div>
            <div className="form-field">
              <label>다음 갱신일</label>
              <input type="date" value={seatForm.renewsOn} onChange={(e) => setSeat('renewsOn', e.target.value)} />
            </div>
            <div className="form-field">
              <label>만료일</label>
              <input type="date" value={seatForm.endsOn} onChange={(e) => setSeat('endsOn', e.target.value)} />
            </div>
            <div className="form-field">
              <label>임대 건 번호 (선택, works 번호)</label>
              <input inputMode="numeric" value={seatForm.worksAssetId} onChange={(e) => setSeat('worksAssetId', e.target.value)} />
            </div>
            <div className="form-field">
              <label>임대 건 순 (선택)</label>
              <input value={seatForm.worksSeq} onChange={(e) => setSeat('worksSeq', e.target.value)} />
            </div>
            <div className="form-field full">
              <label>메모</label>
              <textarea rows={2} value={seatForm.memo} onChange={(e) => setSeat('memo', e.target.value)} />
            </div>
          </div>
          <div className="ct-btnrow">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveSeat(editingSeat)}>
              {busy ? '저장 중…' : '좌석 저장'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setSeatEditId(null);
                setSeatForm(null);
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      <div className="ct-inline-form">
        <input
          inputMode="numeric"
          value={addCount}
          onChange={(e) => setAddCount(e.target.value)}
          aria-label="추가할 좌석 수"
          className="ct-count-input"
        />
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void addSeats()}>
          좌석 {Number(addCount) > 0 ? Number(addCount) : 'n'}개 추가
        </button>
        <span className="ct-muted">한 번에 200개까지</span>
      </div>
    </div>
  );
}
