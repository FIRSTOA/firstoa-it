'use client';

import { useMemo, useState } from 'react';
import type { AssetMovement } from '@/lib/assetMovements';

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type Props = { movements: AssetMovement[] };

export default function AssetHistoryTable({ movements }: Props) {
  const [searchTerm, setSearchTerm] = useState('');

  const visible = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return movements;
    return movements.filter((m) => m.assetNumber.toLowerCase().includes(term));
  }, [movements, searchTerm]);

  return (
    <div className="app">
      <div className="panel">
        <div className="search-row">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="자산번호로 검색"
          />
        </div>
      </div>

      <div className="panel" style={{ paddingTop: '6px' }}>
        <table>
          <thead>
            <tr>
              <th>품목</th>
              <th>자산번호</th>
              <th>이동일시</th>
              <th>위치 변경</th>
              <th>상태 변화</th>
              <th>담당자</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.id}>
                <td>{m.category}</td>
                <td>
                  <span className="asset-id">{m.assetNumber}</span>
                </td>
                <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{formatDateTime(m.movedAt)}</td>
                <td>
                  {m.fromLocation || '(신규)'} → {m.toLocation || '(없음)'}
                </td>
                <td>
                  {m.fromStatus || '-'} → {m.toStatus || '-'}
                </td>
                <td>{m.actor || '-'}</td>
                <td>{m.memo || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="empty-state">
            <div>🕘</div>
            <div>이력이 없어요. 자산을 등록·수정·삭제하면 여기에 자동으로 기록됩니다.</div>
          </div>
        )}
      </div>
    </div>
  );
}
