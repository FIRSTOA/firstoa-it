'use client';

import type { DispatchEntry } from '@/lib/dispatch';

const STATUS_BADGE_CLASS: Record<string, string> = {
  준비완료: 'badge-상품화완료',
  접수: 'badge-상품화준비중',
  준비중: 'badge-임대중',
  보류: 'badge-기타',
  취소: 'badge-악성',
};

type Props = {
  entries: DispatchEntry[];
  disabled: boolean;
  onEdit: (entry: DispatchEntry) => void;
  onDelete: (id: string) => void;
};

export default function DispatchTable({ entries, disabled, onEdit, onDelete }: Props) {
  return (
    <div className="panel" style={{ paddingTop: '6px' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: '50px' }}>순번</th>
            <th>구분</th>
            <th>상태</th>
            <th>상호</th>
            <th style={{ width: '26%' }}>품목</th>
            <th>자산번호</th>
            <th>담당</th>
            <th>일정</th>
            <th style={{ width: '70px' }} />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.seq}</td>
              <td>{entry.type}</td>
              <td>
                <span className={`badge ${STATUS_BADGE_CLASS[entry.status] ?? 'badge-기타'}`}>
                  {entry.status}
                </span>
              </td>
              <td>{entry.company || '-'}</td>
              <td style={{ whiteSpace: 'pre-line' }}>{entry.item || '-'}</td>
              <td>{entry.assetId || '-'}</td>
              <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>
                {[entry.receiver, entry.processor].filter(Boolean).join(' / ') || '-'}
              </td>
              <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>
                {entry.deliveryDate || entry.receivedDate || '-'}
              </td>
              <td>
                <div className="row-actions">
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
          <div>📦</div>
          <div>조건에 맞는 접수 건이 없어요. 필터를 조정하거나 새로 등록해 보세요.</div>
        </div>
      )}
    </div>
  );
}
