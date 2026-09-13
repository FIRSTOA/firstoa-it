'use client';

import type { Asset } from '@/lib/types';

const SPEC_TAG_CLASS: Record<string, string> = {
  사무용: 'tag-spec-office',
  설계용: 'tag-spec-desc',
  저사양: 'tag-spec-low',
  확인필요: 'tag-spec-check',
};

function SpecCell({ item }: { item: Asset }) {
  const detail = [item.cpu, item.ram, item.storage].filter(Boolean).join('/');
  return (
    <>
      <div className="spec-tags">
        {item.spec && (
          <span className={`tag ${SPEC_TAG_CLASS[item.spec] ?? 'tag-spec-office'}`}>{item.spec}</span>
        )}
        {item.screen && item.screen !== '-' && <span className="tag tag-screen">{item.screen}</span>}
        {item.isNew && <span className="tag tag-new">새기기</span>}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>{detail}</div>
    </>
  );
}

type Props = {
  items: Asset[];
  disabled: boolean;
  onEdit: (item: Asset) => void;
  onDelete: (assetId: string, category: string) => void;
};

export default function InventoryTable({ items, disabled, onEdit, onDelete }: Props) {
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
            <th style={{ width: '70px' }} />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.assetId}>
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
              <td>{item.history || '-'}</td>
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
