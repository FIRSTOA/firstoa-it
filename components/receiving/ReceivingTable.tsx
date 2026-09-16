'use client';

import type { ReceivingEntry } from '@/lib/receiving';

const STATUS_BADGE_CLASS: Record<string, string> = {
  입고완료: 'badge-상품화완료',
  입고대기: 'badge-상품화준비중',
  취소: 'badge-악성',
};

type Props = {
  entries: ReceivingEntry[];
  disabled: boolean;
  onEdit: (entry: ReceivingEntry) => void;
  onDelete: (id: string) => void;
  onComplete: (entry: ReceivingEntry) => void;
};

export default function ReceivingTable({ entries, disabled, onEdit, onDelete, onComplete }: Props) {
  return (
    <div className="panel" style={{ paddingTop: '6px' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: '50px' }}>순번</th>
            <th>유형</th>
            <th>상태</th>
            <th>품목</th>
            <th style={{ width: '22%' }}>브랜드/모델명</th>
            <th>자산번호</th>
            <th>예상입고일</th>
            <th>담당자</th>
            <th style={{ width: '150px' }} />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.seq}</td>
              <td>{entry.kind}</td>
              <td>
                <span className={`badge ${STATUS_BADGE_CLASS[entry.status] ?? 'badge-기타'}`}>
                  {entry.status}
                </span>
              </td>
              <td>{entry.category || '-'}</td>
              <td>{[entry.brand, entry.model].filter(Boolean).join(' / ') || '-'}</td>
              <td>{entry.assetId || '-'}</td>
              <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{entry.expectedDate || '-'}</td>
              <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{entry.manager || '-'}</td>
              <td>
                <div className="row-actions">
                  {entry.status === '입고대기' && (
                    <button
                      type="button"
                      className="chip"
                      disabled={disabled}
                      onClick={() => onComplete(entry)}
                    >
                      입고완료 처리
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    title="수정"
                    disabled={disabled}
                    onClick={() => onEdit(entry)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="삭제"
                    disabled={disabled}
                    onClick={() => onDelete(entry.id)}
                  >
                    🗑
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && (
        <div className="empty-state">
          <div>📥</div>
          <div>조건에 맞는 입고 건이 없어요. 필터를 조정하거나 새로 등록해 보세요.</div>
        </div>
      )}
    </div>
  );
}
