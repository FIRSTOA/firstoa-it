'use client';

import { useState } from 'react';
import { lookupKnownAsset } from '@/app/actions';
import { RECEIVING_KINDS } from '@/lib/receiving';
import { parseReceivingPaste, type ParsedReceivingGroup } from '@/lib/receivingParser';
import { CATEGORIES, SPECS } from '@/lib/types';

type Props = {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onImport: (groups: ParsedReceivingGroup[]) => void;
};

/**
 * 카톡으로 오는 입고 안내 문구를 붙여넣으면 lib/receivingParser.ts가 품목/수량/매입가/담당자/
 * 자산번호 등을 미리 뽑아 편집 가능한 목록으로 보여줍니다. 문구 형식이 매번 완전히 같지 않을 수
 * 있어서, 등록 전에 반드시 이 미리보기에서 확인·수정할 수 있게 합니다.
 */
export default function PasteImportModal({ open, pending, onClose, onImport }: Props) {
  const [kind, setKind] = useState<string>(RECEIVING_KINDS[0]);
  const [text, setText] = useState('');
  const [groups, setGroups] = useState<ParsedReceivingGroup[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  function reset() {
    setText('');
    setGroups(null);
    setKind(RECEIVING_KINDS[0]);
  }

  // 자산번호가 이미 정해진 그룹(형식 C — 귀환자산일 수 있음)은 그 번호로 기존 데이터를 조회해서
  // 비어있는 품목/브랜드/사양 칸을 채워줍니다. 첫 번째 자산번호만 대표로 조회합니다(같은 묶음은
  // 보통 같은 모델이라고 가정 — 다르면 미리보기에서 직접 고치면 됨).
  async function enrichFromKnownAssets(parsed: ParsedReceivingGroup[]): Promise<ParsedReceivingGroup[]> {
    return Promise.all(
      parsed.map(async (g) => {
        if (g.assetIds.length === 0) return g;
        const result = await lookupKnownAsset(g.assetIds[0]);
        if (!result.found) return g;
        return {
          ...g,
          category: g.category || result.category,
          brand: g.brand || result.brand,
          model: g.model || result.model,
          cpu: g.cpu || result.cpu,
          spec: g.spec || result.spec,
          ram: g.ram || result.ram,
          storage: g.storage || result.storage,
          screen: g.screen || result.screen,
          serialNumber: g.serialNumber || result.serialNo,
        };
      }),
    );
  }

  async function handlePreview() {
    if (!text.trim()) return;
    const parsed = parseReceivingPaste(text, kind);
    setLoadingPreview(true);
    try {
      setGroups(await enrichFromKnownAssets(parsed));
    } finally {
      setLoadingPreview(false);
    }
  }

  function updateGroup(index: number, patch: Partial<ParsedReceivingGroup>) {
    setGroups((prev) => (prev ? prev.map((g, i) => (i === index ? { ...g, ...patch } : g)) : prev));
  }

  function removeGroup(index: number) {
    setGroups((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleImport() {
    if (!groups || groups.length === 0) return;
    onImport(groups);
  }

  if (!open) return null;

  const totalRows = groups?.reduce((sum, g) => sum + (g.assetIds.length > 0 ? g.assetIds.length : Math.max(g.quantity, 1)), 0) ?? 0;

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
      <div className="modal" style={{ width: '760px', maxWidth: '95vw' }}>
        <h2>붙여넣기로 입고 등록</h2>
        <div className="sub">카톡으로 온 입고 안내 문구를 그대로 붙여넣으면 자동으로 목록이 만들어져요.</div>

        {!groups && (
          <>
            <div className="form-grid">
              <div className="form-field">
                <label>유형(파싱 힌트)</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {RECEIVING_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>
                  문구에 "렌탈"이 있으면 자동으로 렌탈입고예정으로 바뀌어요.
                </div>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="카톡 문구를 여기에 붙여넣으세요"
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
          </>
        )}

        {groups && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '12.5px', color: 'var(--ink-500)', marginBottom: '8px' }}>
              {groups.length}개 품목군 · 총 {totalRows}건으로 등록돼요. 확인하고 필요하면 고쳐주세요.
            </div>
            {groups.map((g, i) => (
              <div
                key={i}
                className="panel"
                style={{ marginBottom: '10px', padding: '12px', display: 'grid', gap: '8px' }}
              >
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button type="button" className="icon-btn danger" title="이 항목 제거" onClick={() => removeGroup(i)}>
                    🗑
                  </button>
                </div>
                <div className="form-grid">
                  <div className="form-field">
                    <label>유형</label>
                    <select value={g.kind} onChange={(e) => updateGroup(i, { kind: e.target.value })}>
                      {RECEIVING_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>품목</label>
                    <select value={g.category} onChange={(e) => updateGroup(i, { category: e.target.value })}>
                      <option value="">(선택 안 함)</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>브랜드</label>
                    <input value={g.brand} onChange={(e) => updateGroup(i, { brand: e.target.value })} />
                  </div>
                  <div className="form-field full">
                    <label>모델명/설명</label>
                    <input value={g.model} onChange={(e) => updateGroup(i, { model: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>CPU종류</label>
                    <input value={g.cpu} onChange={(e) => updateGroup(i, { cpu: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>사양분류</label>
                    <select value={g.spec} onChange={(e) => updateGroup(i, { spec: e.target.value })}>
                      <option value="">(미정)</option>
                      {SPECS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>RAM(GB)</label>
                    <input value={g.ram} onChange={(e) => updateGroup(i, { ram: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>저장용량(GB)</label>
                    <input value={g.storage} onChange={(e) => updateGroup(i, { storage: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>화면크기</label>
                    <input value={g.screen} onChange={(e) => updateGroup(i, { screen: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>시리얼번호</label>
                    <input
                      value={g.serialNumber}
                      onChange={(e) => updateGroup(i, { serialNumber: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label>발주처</label>
                    <input value={g.vendor} onChange={(e) => updateGroup(i, { vendor: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>매입가</label>
                    <input
                      value={g.purchasePrice}
                      onChange={(e) => updateGroup(i, { purchasePrice: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label>예상입고일</label>
                    <input
                      type="date"
                      value={g.expectedDate}
                      onChange={(e) => updateGroup(i, { expectedDate: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label>담당자</label>
                    <input value={g.manager} onChange={(e) => updateGroup(i, { manager: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>수량</label>
                    <input
                      type="number"
                      min={1}
                      value={g.quantity}
                      disabled={g.assetIds.length > 0}
                      onChange={(e) => updateGroup(i, { quantity: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="form-field full">
                    <label>자산번호 목록 (알고 있으면, 콤마로 구분 — 채우면 수량 대신 이 개수만큼 등록돼요)</label>
                    <input
                      value={g.assetIds.join(', ')}
                      onChange={(e) =>
                        updateGroup(i, {
                          assetIds: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="예: X8783, X0024, X9138"
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
            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePreview}
              disabled={pending || loadingPreview || !text.trim()}
            >
              {loadingPreview ? '기존 자산 조회 중…' : '미리보기'}
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
