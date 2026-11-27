'use client';

import { useState } from 'react';
import { specKeys } from '@/lib/salesConfirms/salesForm/confirm';
import type { SalesSlotLine, SalesSpec, SalesSpecKey } from '@/lib/salesConfirms/types';
import { cleanSpec } from './detailShared';
import SpecDiffEditor from './SpecDiffEditor';

export type LineBulkMode = 'spec' | 'software' | 'key';

interface Props {
  mode: LineBulkMode;
  line: SalesSlotLine;
  onClose: () => void;
  /** 사양·제품명·제조사 한꺼번에 — 비워 둔 칸은 보내지 않음(그 칸은 그대로 둠). 성공이면 true */
  onApplyValues: (values: { specOverride?: SalesSpec; actualModel?: string; actualMaker?: string }) => Promise<boolean>;
  /** 같은 키를 모든 칸에 — 성공이면 true */
  onApplyKey: (key: string) => Promise<boolean>;
}

/**
 * 품목 줄 머리의 한꺼번에 고치기 창.
 *  spec     = [이 품목 사양 한꺼번에] — 그 줄 모든 칸의 출고사양을 같은 값으로
 *  software = [제품명 한꺼번에] — 그 줄 모든 칸의 제품명·제조사
 *  key      = [같은 키를 모든 칸에] — 볼륨 라이선스(잠금 풀린 상태에서만 저장)
 * 영업 요청과 달라도 그대로 저장(노란 표시) — 확인은 인쇄할 때 한 번에(2026-11-27).
 */
export default function LineBulkDialog({ mode, line, onClose, onApplyValues, onApplyKey }: Props) {
  const keys = specKeys(line.item.cat) as SalesSpecKey[];
  const [spec, setSpec] = useState<Record<string, string>>({});
  const [model, setModel] = useState('');
  const [maker, setMaker] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const cleaned = cleanSpec(spec);
  const canApply =
    mode === 'spec' ? Object.keys(cleaned).length > 0 : mode === 'software' ? !!(model.trim() || maker.trim()) : !!key.trim();

  async function apply() {
    if (!canApply || busy) return;
    setBusy(true);
    try {
      let ok = false;
      if (mode === 'spec') ok = await onApplyValues({ specOverride: cleaned });
      else if (mode === 'software') {
        ok = await onApplyValues({
          ...(model.trim() ? { actualModel: model.trim() } : {}),
          ...(maker.trim() ? { actualMaker: maker.trim() } : {}),
        });
      } else ok = await onApplyKey(key.trim());
      if (ok) {
        setKey('');
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'spec' ? '이 품목 사양 한꺼번에' : mode === 'software' ? '제품명 한꺼번에' : '같은 키를 모든 칸에';
  const qty = line.slots.length;

  return (
    <div className="modal-overlay open sc-z-dlg">
      <div className="modal sc-bulk-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="sub">
          {line.item.cat} {line.item.model} · 칸 {qty}개 모두에 적용해요.
          {mode === 'key' ? ' 비밀번호를 풀어야 저장돼요. 키는 저장하면 이 창에서 사라져요.' : ' 비워 둔 칸은 그대로 둬요.'}
        </div>

        {mode === 'spec' && (
          <SpecDiffEditor keys={keys} sales={line.item.spec} value={spec} idPrefix={`sc-bulk-${line.itemIndex}`} onChange={(k, v) => setSpec((s) => ({ ...s, [k]: v }))} />
        )}
        {mode === 'software' && (
          <div className="sc-bulk-fields">
            <div className="form-field">
              <label htmlFor="sc-bulk-model">제품명</label>
              <input id="sc-bulk-model" value={model} placeholder={line.item.model || '제품명'} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
            </div>
            <div className="form-field">
              <label htmlFor="sc-bulk-maker">제조사</label>
              <input id="sc-bulk-maker" value={maker} placeholder={line.item.maker || '제조사'} onChange={(e) => setMaker(e.target.value)} autoComplete="off" />
            </div>
          </div>
        )}
        {mode === 'key' && (
          <div className="form-field">
            <label htmlFor="sc-bulk-key">라이선스 키</label>
            <input
              id="sc-bulk-key"
              className="sc-mono-in"
              value={key}
              placeholder="모든 칸에 넣을 키"
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !canApply} onClick={() => void apply()}>
            {busy ? '저장 중…' : `칸 ${qty}개에 적용`}
          </button>
        </div>
      </div>
    </div>
  );
}
