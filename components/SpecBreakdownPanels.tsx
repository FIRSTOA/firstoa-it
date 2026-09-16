'use client';

import { countExcluding, type Filters, type MultiFilterKey } from '@/lib/filters';
import type { Asset } from '@/lib/types';

const SPEC_GROUP_ORDER = ['설계용', '사무용', '저사양', '확인필요'];
const CPU_TYPE_ORDER = ['I9', 'I7', 'I5', 'I3', 'U9', 'U7', 'U5', 'A9', 'A5', 'A3', 'MacMini', '미상'];

type Chip = { label: string; count: number; active: boolean; onClick: () => void };

function BreakdownPanel({ title, chips }: { title: string; chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="panel">
      <div className="filter-label" style={{ marginBottom: '10px' }}>
        {title}
      </div>
      <div className="chip-group">
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            className={`chip${c.active ? ' active' : ''}`}
            aria-pressed={c.active}
            onClick={c.onClick}
          >
            {c.label} {c.count}대
          </button>
        ))}
      </div>
    </div>
  );
}

type Props = {
  items: Asset[];
  filters: Filters;
  searchTerm: string;
  onToggle: (dimension: MultiFilterKey, value: string) => void;
};

/**
 * "사양그룹별/CPU종류별/세부 구분코드" 집계 패널 (원본 대시보드 참고). 품목이 노트북 또는
 * 데스크탑 하나로만 좁혀졌을 때만 보여줍니다 — 이 두 카테고리만 구분코드 분류가 있고,
 * 원본 대시보드도 "전체 자산" 화면에서는 이 패널들을 보여주지 않습니다.
 */
export default function SpecBreakdownPanels({ items, filters, searchTerm, onToggle }: Props) {
  const singleCategory = filters.category.length === 1 ? filters.category[0] : null;
  if (singleCategory !== '노트북' && singleCategory !== '데스크탑') return null;

  const categoryItems = items.filter((i) => i.category === singleCategory);

  const buildChips = (dimension: MultiFilterKey, values: string[]): Chip[] =>
    values
      .map((value) => ({
        label: value,
        count: countExcluding(items, filters, searchTerm, dimension, value),
        active: filters[dimension].includes(value),
        onClick: () => onToggle(dimension, value),
      }))
      .filter((c) => c.count > 0);

  const specValues = SPEC_GROUP_ORDER.filter((v) => categoryItems.some((i) => i.spec === v));
  const specChips = buildChips('spec', specValues);

  const cpuTypeValues = CPU_TYPE_ORDER.filter((v) => categoryItems.some((i) => i.cpuType === v));
  const cpuTypeChips = buildChips('cpuType', cpuTypeValues);

  const gubunCodeValues = [...new Set(categoryItems.map((i) => i.gubunCode).filter(Boolean))];
  const gubunCodeChips = buildChips('gubunCode', gubunCodeValues).sort((a, b) => b.count - a.count);

  return (
    <>
      <BreakdownPanel title="사양그룹별 대수" chips={specChips} />
      <BreakdownPanel title="CPU종류별 대수" chips={cpuTypeChips} />
      <BreakdownPanel title="세부 구분코드" chips={gubunCodeChips} />
    </>
  );
}
