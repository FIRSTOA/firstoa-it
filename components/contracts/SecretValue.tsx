'use client';

import { useEffect, useRef, useState } from 'react';
import { revealSecret, saveSecret } from '@/app/contracts/secretActions';
import { SECRET_FIELDS, SECRET_FIELD_LABEL, type SecretField, type SecretOwner } from '@/lib/contracts/types';
import { useContractsCtx } from './UnlockDialog';

/** 값이 보이는 시간 — 이 뒤엔 다시 가림 */
export const SECRET_SHOW_MS = 60_000;

export function secretKey(owner: SecretOwner, field: SecretField): string {
  return `${'seatId' in owner ? `s:${owner.seatId}` : `c:${owner.contractId}`}:${field}`;
}

/** "이 상품 모두 보기"로 한꺼번에 받은 값 — 화면 state 에만 두고 60초 뒤 비움 */
export type BulkSecrets = { nonce: number; values: Record<string, string> };

/**
 * 값이 보이는 동안: timer 가 켜져 있으면 60초 뒤, watch 가 켜져 있으면 탭이 숨겨지는 즉시 hide 를 부름.
 */
export function useAutoHide(timer: boolean, watch: boolean, hide: () => void) {
  const hideRef = useRef(hide);
  useEffect(() => {
    hideRef.current = hide;
  });
  useEffect(() => {
    if (!timer) return;
    const t = window.setTimeout(() => hideRef.current(), SECRET_SHOW_MS);
    return () => window.clearTimeout(t);
  }, [timer]);
  useEffect(() => {
    if (!watch) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hideRef.current();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onVis);
    };
  }, [watch]);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* 아래 방법으로 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type Props = {
  owner: SecretOwner;
  field: SecretField;
  /** 저장된 값이 있는지(없으면 새로 넣는 칸) */
  exists: boolean;
  bulk?: BulkSecrets;
  /** 저장·삭제가 끝나면 — 위에서 다시 읽음 */
  onChanged: () => void;
  /** 새 칸 넣기를 그만둘 때 */
  onCancel?: () => void;
  /** 새 칸이면 처음부터 입력 상태 */
  startEditing?: boolean;
};

/** 🔒 •••• [보기] — 누른 칸 하나만 서버에서 풀어 보여 주고, 60초 뒤·탭이 숨겨지면 바로 가림. 값은 이 state 에만. */
export default function SecretValue({ owner, field, exists, bulk, onChanged, onCancel, startEditing }: Props) {
  const { unlock, askUnlock, toast } = useContractsCtx();
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!exists && !!startEditing);
  const [draft, setDraft] = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const label = SECRET_FIELD_LABEL[field];

  function hideAll() {
    setValue(null);
    setDraft('');
    setShowDraft(false);
    setEditing(false);
  }

  useAutoHide(value !== null && !editing, value !== null || editing, hideAll);

  // 잠겼거나 시간이 다 되면 바로 가림
  useEffect(() => {
    if (!unlock.unlocked) hideAll();
  }, [unlock.unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // 모두 보기로 받은 값
  useEffect(() => {
    if (!bulk) return;
    const v = bulk.values[secretKey(owner, field)];
    if (v !== undefined) setValue(v);
  }, [bulk?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reveal(after?: (v: string) => void) {
    setBusy(true);
    try {
      const r = await revealSecret(owner, field);
      if (r.ok) {
        setValue(r.value);
        after?.(r.value);
        return;
      }
      if (r.needUnlock) {
        askUnlock(() => void reveal(after));
        return;
      }
      toast(r.error);
    } catch {
      toast('값을 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (value === null) return;
    toast((await copyText(value)) ? '복사했어요. 60초 뒤 화면에서 가려져요.' : '복사하지 못했어요. 값을 길게 눌러 직접 복사해 주세요.');
  }

  function beginEdit() {
    if (!exists) {
      setDraft('');
      setEditing(true);
      return;
    }
    if (value !== null) {
      setDraft(value);
      setEditing(true);
      return;
    }
    // 지금 값을 먼저 불러 넣어 둠 — 빈 칸으로 열면 실수로 지울 수 있어서
    void reveal((v) => {
      setDraft(v);
      setEditing(true);
    });
  }

  async function save() {
    const empty = draft.trim() === '';
    if (empty) {
      if (!exists) {
        toast('값을 적어 주세요.');
        return;
      }
      if (!window.confirm(`${label} 값을 지울까요? 되돌릴 수 없어요.`)) return;
    }
    setBusy(true);
    try {
      const r = await saveSecret(owner, field, empty ? '' : draft);
      if (r.ok) {
        hideAll();
        toast(empty ? '지웠어요.' : '저장했어요.');
        onChanged();
        return;
      }
      if (r.needUnlock) {
        askUnlock();
        return;
      }
      toast(r.error);
    } catch {
      toast('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setDraft('');
    setShowDraft(false);
    if (!exists) onCancel?.();
  }

  if (editing) {
    return (
      <div className="ct-secret ct-secret-edit">
        <span className="ct-secret-label">✏️ {label}</span>
        <textarea
          className={`ct-secret-input${showDraft ? '' : ' ct-mask'}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={exists ? '비워서 저장하면 지워져요' : '값을 적어 주세요'}
          aria-label={`${label} 새 값`}
        />
        <div className="ct-secret-btns">
          <button type="button" className="btn btn-ghost" onClick={() => setShowDraft((s) => !s)}>
            {showDraft ? '가리기' : '글자 보기'}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancelEdit}>
            취소
          </button>
        </div>
      </div>
    );
  }

  if (!exists) return null;

  return (
    <div className="ct-secret">
      <span className="ct-secret-label">🔒 {label}</span>
      {value === null ? (
        <>
          <span className="ct-secret-dots" aria-hidden="true">
            ••••••••
          </span>
          <div className="ct-secret-btns">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void reveal()}>
              {busy ? '여는 중…' : '보기'}
            </button>
            {unlock.unlocked && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={beginEdit}>
                수정
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <code className="ct-secret-val">{value}</code>
          <div className="ct-secret-btns">
            <button type="button" className="btn btn-primary ct-copy" onClick={() => void copy()}>
              복사
            </button>
            <button type="button" className="btn btn-ghost" onClick={hideAll}>
              가리기
            </button>
            {unlock.unlocked && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={beginEdit}>
                수정
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type FieldsProps = {
  owner: SecretOwner;
  fields: SecretField[];
  bulk?: BulkSecrets;
  onChanged: () => void;
};

/** 한 주인(계약 상품 또는 좌석)의 비밀 칸들 — 있는 칸은 가려서 보여 주고, 열람 중이면 빈 칸을 새로 넣는 선택도 */
export function SecretFields({ owner, fields, bulk, onChanged }: FieldsProps) {
  const { unlock } = useContractsCtx();
  const [adding, setAdding] = useState<SecretField[]>([]);
  const missing = SECRET_FIELDS.filter((f) => !fields.includes(f) && !adding.includes(f));

  return (
    <div className="ct-secrets">
      {fields.map((f) => (
        <SecretValue key={f} owner={owner} field={f} exists bulk={bulk} onChanged={onChanged} />
      ))}
      {adding.map((f) => (
        <SecretValue
          key={`new-${f}`}
          owner={owner}
          field={f}
          exists={false}
          startEditing
          onCancel={() => setAdding((a) => a.filter((x) => x !== f))}
          onChanged={() => {
            setAdding((a) => a.filter((x) => x !== f));
            onChanged();
          }}
        />
      ))}
      {unlock.unlocked && missing.length > 0 && (
        <select
          className="ct-add-secret"
          value=""
          onChange={(e) => {
            const f = e.target.value as SecretField;
            if (f) setAdding((a) => [...a, f]);
          }}
          aria-label="비밀 칸 추가"
        >
          <option value="">＋ 비밀 칸 넣기</option>
          {missing.map((f) => (
            <option key={f} value={f}>
              {SECRET_FIELD_LABEL[f]}
            </option>
          ))}
        </select>
      )}
      {fields.length === 0 && adding.length === 0 && !unlock.unlocked && <span className="ct-muted">비밀 칸 없음</span>}
    </div>
  );
}
