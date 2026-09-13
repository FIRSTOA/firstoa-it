'use client';

import { MALICIOUS } from '@/lib/filters';
import type { Asset } from '@/lib/types';

/** 소모품가격표는 별도 화면에서 관리하는 정적 수치입니다. */
const CONSUMABLE_COUNT = 18;
const NOT_FILTERABLE = '__none__';

type Props = {
  items: Asset[];
  statusFilter: string | null;
  onSelectStatus: (value: string | null) => void;
  onSelectConsumable: () => void;
};

export default function StatsRow({ items, statusFilter, onSelectStatus, onSelectConsumable }: Props) {
  const countByStatus = (status: string) => items.filter((i) => i.status === status).length;

  const cards = [
    { key: 'all', label: '전체', num: items.length, filterVal: null as string | null },
    { key: '임대중', label: '임대중', num: countByStatus('임대중'), filterVal: '임대중' },
    { key: '상품화완료', label: '상품화완료', num: countByStatus('상품화완료'), filterVal: '상품화완료' },
    { key: '상품화준비중', label: '상품화준비중', num: countByStatus('상품화준비중'), filterVal: '상품화준비중' },
    { key: '수리중', label: '수리중', num: countByStatus('수리중'), filterVal: '수리중' },
    { key: '미정', label: '미정', num: countByStatus('미정'), filterVal: '미정' },
    { key: '기타', label: '기타', num: countByStatus('기타'), filterVal: '기타' },
    { key: 'malicious', label: '악성', num: items.filter((i) => i.malicious).length, filterVal: MALICIOUS },
    { key: 'consumable', label: '소모품가격표', num: CONSUMABLE_COUNT, filterVal: NOT_FILTERABLE },
  ];

  return (
    <div className="stats">
      {cards.map((card) => {
        const isActive = card.filterVal !== NOT_FILTERABLE && statusFilter === card.filterVal;
        return (
          <button
            type="button"
            key={card.key}
            className={`stat-card${isActive ? ' active' : ''}`}
            data-key={card.key}
            onClick={() => {
              if (card.filterVal === NOT_FILTERABLE) {
                onSelectConsumable();
                return;
              }
              // 같은 카드를 다시 누르면 필터 해제
              onSelectStatus(statusFilter === card.filterVal ? null : card.filterVal);
            }}
          >
            <div className="stat-num">{card.num}</div>
            <div className="stat-label">{card.label}</div>
          </button>
        );
      })}
    </div>
  );
}
