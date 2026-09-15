'use client';

import { countExcluding, type Filters } from '@/lib/filters';
import { CATEGORIES, type Asset } from '@/lib/types';

type Props = {
  items: Asset[];
  filters: Filters;
  searchTerm: string;
  onToggle: (category: string) => void;
};

/**
 * 품목(데스크탑/노트북/...)별 카드. 누르면 품목 필터에 토글되고, 카드 상태와 필터 상태는
 * 항상 같습니다. 숫자는 "이 품목을 추가로 선택하면 몇 건인지"(=다른 필터+검색어는 그대로 두고
 * 품목만 이 값으로 좁혔을 때의 건수) 기준이라, 카드에서 해당 품목을 눌렀을 때 실제로 표에
 * 나오는 행 수와 항상 일치합니다.
 */
export default function CategoryCards({ items, filters, searchTerm, onToggle }: Props) {
  return (
    <div className="category-cards">
      {CATEGORIES.map((category) => {
        const count = countExcluding(items, filters, searchTerm, 'category', category);
        const isActive = filters.category.includes(category);
        return (
          <button
            key={category}
            type="button"
            className={`category-card${isActive ? ' active' : ''}`}
            aria-pressed={isActive}
            onClick={() => onToggle(category)}
          >
            {isActive && (
              <span className="category-card-check" aria-hidden="true">
                ✓
              </span>
            )}
            <div className="category-card-num">{count}</div>
            <div className="category-card-label">{category}</div>
          </button>
        );
      })}
    </div>
  );
}
