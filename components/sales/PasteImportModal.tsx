'use client';

import { useState } from 'react';
import { expandParsedSaleGroup, parseSalesPaste, type ParsedSaleGroup } from '@/lib/salesParser';
import type { SaleInput } from '@/lib/sales';

type Props = {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onImport: (entries: SaleInput[]) => void;
};

/**
 * 판매처에서 오는 "업체명/주소/담당자/모델명/매입가" 형식 문구를 붙여넣으면
 * lib/salesParser.ts가 미리 뽑아 편집 가능한 목록으로 보여줍니다. 판매금액/자산번호는
 * 보통 문구에 없어서 여기서 직접 채우면 됩니다.
 */
export default function PasteImportModal({ open, pending, onClose, onImport }: Props) {
  const [text, setText] = useState('');
  const [groups, setGroups] = useState<ParsedSaleGroup[] | null>(null);

  function reset() {
    setText('');
    setGroups(null);
  }

  function handlePreview() {
    if (!text.trim()) return;
    setGroups(parseSalesPaste(text));
  }

  function updateGroup(index: number, patch: Partial<ParsedSaleGroup>) {
    setGroups((prev) => (prev ? prev.map((g, i) => (i === index ? { ...g, ...patch } : g)) : prev));
  }

  function removeGroup(index: number) {
    setGroups((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleImport() {
    if (!groups || groups.length === 0) return;
    onImport(groups.flatMap(expandParsedSaleGroup));
  }

  if (!open) return null;

  const totalRows = groups?.reduce((sum, g) => sum + Math.max(Math.trunc(g.quantity) || 1, 1), 0) ?? 0;

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) {
          reset();
          onClose();
        }
      }}
    >
      <div className="modal" style={{ width: '680px', maxWidth: '95vw' }}>
        <h2>붙여넣기로 판매 등록</h2>
        <div className="sub">거래처 안내 문구(업체명/주소/담당자/모델명/매입가)를 그대로 붙여넣으면 자동으로 목록이 만들어져요.</div>

        {!groups && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'예)\n업체명 : 영인에너지솔루션-상대원 본사\n주소 : 경기 성남시 ...\n담당자 : 김한솔 010-...\n모델명: LG그램 15Z90T-GP7DL 노트북 2대\n(울트라7(S2)-255H/32GB/512GB/내장/15.6인치/윈11프로)\n> 매입가: 대당 220만원'}
            rows={12}
            style={{
              width: '100%',
              marginTop: '10px',
              fontFamily: 'inherit',
              fontSize: '13px',
              padding: '10px',
              border: '1px solid var(--ink-200)',
              borderRadius: '8px',
              resize: 'vertical',
            }}
          />
        )}

        {groups && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '12.5px', color: 'var(--ink-500)', marginBottom: '8px' }}>
              {groups.length}개 품목군 · 총 {totalRows}건으로 등록돼요. 확인하고 필요하면 고쳐주세요.
            </div>
            {groups.map((g, i) => (
              <div key={i} className="panel" style={{ marginBottom: '10px', padding: '12px', display: 'grid', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button type="button" className="icon-btn danger" title="이 항목 제거" onClick={() => removeGroup(i)}>
                    🗑
                  </button>
                </div>
                <div className="form-grid">
                  <div className="form-field full">
                    <label>모델명</label>
                    <input value={g.model} onChange={(e) => updateGroup(i, { model: e.target.value })} />
                  </div>
                  <div className="form-field full">
                    <label>스펙</label>
                    <input value={g.spec} onChange={(e) => updateGroup(i, { spec: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>구매처</label>
                    <input value={g.purchaseVendor} onChange={(e) => updateGroup(i, { purchaseVendor: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>매입금액</label>
                    <input value={g.purchasePrice} onChange={(e) => updateGroup(i, { purchasePrice: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>판매금액</label>
                    <input value={g.salePrice} onChange={(e) => updateGroup(i, { salePrice: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>위치(판매한 곳)</label>
                    <input value={g.destination} onChange={(e) => updateGroup(i, { destination: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>판매일</label>
                    <input type="date" value={g.saleDate} onChange={(e) => updateGroup(i, { saleDate: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>수량</label>
                    <input
                      type="number"
                      min={1}
                      value={g.quantity}
                      onChange={(e) => updateGroup(i, { quantity: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="form-field full">
                    <label>비고</label>
                    <textarea
                      value={g.notes}
                      onChange={(e) => updateGroup(i, { notes: e.target.value })}
                      rows={2}
                      style={{
                        width: '100%',
                        fontFamily: 'inherit',
                        fontSize: '13px',
                        padding: '8px',
                        border: '1px solid var(--ink-200)',
                        borderRadius: '8px',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <div className="empty-state">
                <div>🗑</div>
                <div>모든 항목을 지웠어요. 다시 붙여넣어 주세요.</div>
              </div>
            )}
          </div>
        )}

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={pending}
          >
            취소
          </button>
          {!groups ? (
            <button type="button" className="btn btn-primary" onClick={handlePreview} disabled={pending || !text.trim()}>
              미리보기
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setGroups(null)} disabled={pending}>
                다시 붙여넣기
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleImport}
                disabled={pending || groups.length === 0}
              >
                {pending ? '등록 중…' : `${totalRows}건 등록`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
