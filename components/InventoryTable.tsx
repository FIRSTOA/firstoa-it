'use client';

import { useState } from 'react';
import type { Asset } from '@/lib/types';

const SPEC_TAG_CLASS: Record<string, string> = {
  사무용: 'tag-spec-office',
  설계용: 'tag-spec-desc',
  저사양: 'tag-spec-low',
  확인필요: 'tag-spec-check',
};

function SpecCell({ item }: { item: Asset }) {
  // 시트 B열("사양(PC라벨)"/"사양") 원문을 그대로 보여줍니다 — cpu/ram/storage를 길게 이어붙인
  // 문구보다 간략해서 읽기 쉽습니다. 새로 등록해서 아직 그 칸이 비어있는 자산만 예전 방식으로
  // 대체 표시합니다.
  const detail = item.specLabel || [item.cpu, item.ram, item.storage].filter(Boolean).join('/');
  return (
    <div className="spec-cell">
      {detail && <span className="spec-code">{detail}</span>}
      {item.spec && (
        <span className={`tag ${SPEC_TAG_CLASS[item.spec] ?? 'tag-spec-office'}`}>{item.spec}</span>
      )}
      {item.screen && item.screen !== '-' && <span className="tag tag-screen">{item.screen}</span>}
      {item.isNew && <span className="tag tag-new">새기기</span>}
    </div>
  );
}

/**
 * 이력(비고)을 긴 원문 그대로 보여주지 않고 "이력 N건"으로 접어둡니다 — 여러 건이 이어붙어
 * 있으면 표 가독성이 떨어져서, 클릭했을 때만 원문 전체(건별로 한 줄씩)를 펼쳐 보여줍니다.
 * deriveIsNew/deriveMalicious(lib/inventory/status.ts)와 동일하게 "/"를 건 구분자로 씁니다.
 */
function HistoryCell({ history }: { history: string }) {
  const [expanded, setExpanded] = useState(false);
  const entries = history
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  if (entries.length === 0) return <span>-</span>;

  if (!expanded) {
    return (
      <button type="button" className="chip" onClick={() => setExpanded(true)}>
        이력 {entries.length}건
      </button>
    );
  }

  return (
    <div className="history-expanded" onClick={() => setExpanded(false)} title="클릭하면 접어요">
      {entries.map((entry, i) => (
        <div key={i}>{entry}</div>
      ))}
    </div>
  );
}

type Props = {
  items: Asset[];
  disabled: boolean;
  onEdit: (item: Asset) => void;
  onDelete: (assetId: string, category: string) => void;
  onReserve: (item: Asset) => void;
  onCancelReservation: (item: Asset) => void;
};

export default function InventoryTable({
  items,
  disabled,
  onEdit,
  onDelete,
  onReserve,
  onCancelReservation,
}: Props) {
  return (
    <div className="panel" style={{ paddingTop: '6px' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: '30%' }}>사양</th>
            <th>자산번호</th>
            <th>브랜드</th>
            <th>모델명</th>
            <th>위치</th>
            <th>상태</th>
            <th>이력</th>
            <th>예약</th>
            <th style={{ width: '70px' }} />
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            // 자산번호가 시트에 중복 입력돼 있거나("P1024"가 두 카테고리에 걸쳐 있는 등) 비어있는
            // 경우("없음" 같은 오입력 포함)가 실제로 있어서, index까지 합쳐 항상 고유한 key로 만듭니다.
            <tr key={`${item.category}-${item.assetId}-${index}`}>
              <td>
                <SpecCell item={item} />
              </td>
              <td>
                <span className="asset-id">{item.assetId}</span>
              </td>
              <td>{item.brand}</td>
              <td>{item.model}</td>
              <td>{item.location || '-'}</td>
              <td>
                <span className={`badge badge-${item.status}`}>{item.status}</span>
                {item.malicious && <span className="badge badge-악성">악성</span>}
              </td>
              <td>
                <HistoryCell history={item.history} />
              </td>
              <td style={{ fontSize: '12px' }}>
                {item.reservedBy ? (
                  <div>
                    <div>
                      {item.reservedBy}
                      {item.reservedAt ? ` (${item.reservedAt})` : ''}
                    </div>
                    <button
                      type="button"
                      className="chip"
                      title="예약 취소"
                      disabled={disabled}
                      onClick={() => onCancelReservation(item)}
                      style={{ marginTop: '4px' }}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button type="button" className="chip" disabled={disabled} onClick={() => onReserve(item)}>
                    예약
                  </button>
                )}
              </td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="수정"
                    disabled={disabled}
                    onClick={() => onEdit(item)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="삭제"
                    disabled={disabled}
                    onClick={() => onDelete(item.assetId, item.category)}
                  >
                    🗑
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <div className="empty-state">
          <div>🗄️</div>
          <div>조건에 맞는 자산이 없어요. 필터를 조정하거나 새 자산을 등록해 보세요.</div>
        </div>
      )}
    </div>
  );
}
