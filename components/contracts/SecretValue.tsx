'use client';

import { useState } from 'react';
import { saveSecret } from '@/app/contracts/secretActions';
import { SECRET_FIELDS, SECRET_FIELD_LABEL, type SecretField, type SecretOwner } from '@/lib/contracts/types';
import { useContractsCtx } from './UnlockDialog';

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
  /** 서버가 열려 있을 때 채워 준 값(없으면 undefined) */
  value: string | undefined;
  /** 저장·삭제가 끝나면 — 위에서 다시 읽음 */
  onChanged: () => void;
  /** 새 칸 넣기를 그만둘 때 */
  onCancel?: () => void;
  /** 처음부터 입력 상태로 */
  startEditing?: boolean;
};

/** 비밀 칸 하나 — 값을 그대로 보여 주고 [복사] [수정]. 빈 칸은 "—" + [넣기]. 값은 props 로만 받음. */
export default function SecretValue({ owner, field, value, onChanged, onCancel, startEditing }: Props) {
  const { toast, fail } = useContractsCtx();
  const has = value !== undefined && value !== '';
  const [editing, setEditing] = useState(!!startEditing);
  const [draft, setDraft] = useState(startEditing ? '' : (value ?? ''));
  const [busy, setBusy] = useState(false);
  const label = SECRET_FIELD_LABEL[field];

  async function copy() {
    if (!has) return;
    toast((await copyText(value as string)) ? '복사했어요.' : '복사하지 못했어요. 값을 길게 눌러 직접 복사해 주세요.');
  }

  async function save() {
    const empty = draft.trim() === '';
    if (empty) {
      if (!has) {
        toast('값을 적어 주세요.');
        return;
      }
      if (!window.confirm(`${label} 값을 지울까요? 되돌릴 수 없어요.`)) return;
    }
    setBusy(true);
    try {
      const r = await saveSecret(owner, field, empty ? '' : draft);
      if (r.ok) {
        setEditing(false);
        toast(empty ? '지웠어요.' : '저장했어요.');
        onChanged();
        return;
      }
      fail(r);
    } catch {
      toast('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(value ?? '');
    if (!has) onCancel?.();
  }

  if (editing) {
    return (
      <div className="ct-secret ct-secret-edit">
        <span className="ct-secret-label">✏️ {label}</span>
        <textarea
          className="ct-secret-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={has ? '비워서 저장하면 지워져요' : '값을 적어 주세요'}
          aria-label={`${label} 값`}
        />
        <div className="ct-secret-btns">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancel}>
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ct-secret">
      <span className="ct-secret-label">{label}</span>
      {has ? <code className="ct-secret-val">{value}</code> : <span className="ct-muted">—</span>}
      <div className="ct-secret-btns">
        {has && (
          <button type="button" className="btn btn-primary ct-copy" onClick={() => void copy()}>
            복사
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setDraft(value ?? '');
            setEditing(true);
          }}
        >
          {has ? '수정' : '넣기'}
        </button>
      </div>
    </div>
  );
}

type FieldsProps = {
  owner: SecretOwner;
  secrets: Partial<Record<SecretField, string>>;
  onChanged: () => void;
};

/** 한 주인(계약 상품 또는 좌석)의 비밀 칸들 — 값이 있는 칸은 그대로 보여 주고, 빈 칸은 선택해서 새로 넣음 */
export function SecretFields({ owner, secrets, onChanged }: FieldsProps) {
  const [adding, setAdding] = useState<SecretField[]>([]);
  const filled = SECRET_FIELDS.filter((f) => (secrets[f] ?? '') !== '');
  const missing = SECRET_FIELDS.filter((f) => !filled.includes(f) && !adding.includes(f));

  return (
    <div className="ct-secrets">
      {filled.map((f) => (
        <SecretValue key={`${f}:${secrets[f]}`} owner={owner} field={f} value={secrets[f]} onChanged={onChanged} />
      ))}
      {adding.map((f) => (
        <SecretValue
          key={`new-${f}`}
          owner={owner}
          field={f}
          value={undefined}
          startEditing
          onCancel={() => setAdding((a) => a.filter((x) => x !== f))}
          onChanged={() => {
            setAdding((a) => a.filter((x) => x !== f));
            onChanged();
          }}
        />
      ))}
      {missing.length > 0 && (
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
    </div>
  );
}
