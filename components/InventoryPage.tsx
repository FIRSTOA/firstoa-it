'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { cancelReservation, createAsset, deleteAsset, reserveAsset, resetToSeed, updateAsset } from '@/app/actions';
import type { DataSource } from '@/lib/dataSource';
import { filterAssets, toggleMultiValue } from '@/lib/filters';
import { useFilterState } from '@/lib/useFilterState';
import type { Asset } from '@/lib/types';
import ActiveFilters from './ActiveFilters';
import AssetModal from './AssetModal';
import CategoryCards from './CategoryCards';
import ExcelActions from './ExcelActions';
import FilterPanel from './FilterPanel';
import InventoryTable from './InventoryTable';
import SpecBreakdownPanels from './SpecBreakdownPanels';
import SpreadsheetLinkButton from './SpreadsheetLinkButton';
import StatsRow from './StatsRow';

const CPU_COUNT_ORDER = ['I7', 'I5', 'U7', 'U5', '미상'];

const CATEGORY_DASHBOARD_TITLES: Record<string, string> = {
  데스크탑: '데스크탑 현황',
  노트북: '노트북 현황',
  모니터: '모니터 현황',
  빔프로젝트: '빔프로젝터 현황',
  기타주변기기: '기타주변기기 현황',
};

type Props = { items: Asset[]; dataSource: DataSource; spreadsheetUrl: string | null };

/**
 * `items` 는 서버 컴포넌트가 Supabase 에서 읽어 넘겨줍니다.
 * 쓰기 작업은 Server Action → revalidatePath('/') 로 이 prop 이 갱신되므로
 * 목록을 별도 state 로 복제하지 않습니다.
 */
export default function InventoryPage({ items, dataSource, spreadsheetUrl }: Props) {
  const { filters, searchTerm, setSearchTerm, setFilter, resetAll } = useFilterState();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [toast, setToast] = useState({ msg: '', show: false });
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 1800);
  }

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // 서버/클라이언트 시각이 달라 하이드레이션이 깨지지 않도록 마운트 후에만 채웁니다.
  useEffect(() => {
    const format = () =>
      new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date());
    setLastUpdated(format());
    const id = setInterval(() => setLastUpdated(format()), 30000);
    return () => clearInterval(id);
  }, []);

  const visibleItems = useMemo(
    () => filterAssets(items, filters, searchTerm),
    [items, filters, searchTerm],
  );

  const dashboardTitle = useMemo(() => {
    if (filters.category.length === 0) return '전체 자산';
    if (filters.category.length === 1) {
      return CATEGORY_DASHBOARD_TITLES[filters.category[0]] ?? `${filters.category[0]} 현황`;
    }
    return '선택 품목 현황';
  }, [filters.category]);

  // CPU 집계는 필터와 무관하게 전체 노트북 기준으로 보여줍니다.
  const cpuCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (item.category === '노트북') counts[item.cpu] = (counts[item.cpu] ?? 0) + 1;
    }
    return CPU_COUNT_ORDER.filter((cpu) => counts[cpu]).map((cpu) => ({ cpu, count: counts[cpu] }));
  }, [items]);

  function handleSave(asset: Asset) {
    const target = editing;
    startTransition(async () => {
      const result = target ? await updateAsset(target.assetId, asset) : await createAsset(asset);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setModalOpen(false);
      setEditing(null);
      showToast(target ? '수정했어요.' : '등록했어요.');
    });
  }

  function handleDelete(assetId: string, category: string) {
    if (!confirm(`자산번호 ${assetId}를 삭제할까요?`)) return;
    startTransition(async () => {
      const result = await deleteAsset(assetId, category);
      showToast(result.ok ? '삭제했어요.' : result.error);
    });
  }

  function handleReserve(item: Asset) {
    const name = prompt('예약자 이름을 입력해주세요.');
    if (name === null) return; // 취소
    if (!name.trim()) {
      showToast('예약자 이름을 입력해주세요.');
      return;
    }
    startTransition(async () => {
      const result = await reserveAsset(item.assetId, item.category, name.trim());
      showToast(result.ok ? '예약했어요.' : result.error);
    });
  }

  function handleCancelReservation(item: Asset) {
    if (!confirm(`${item.assetId}의 예약을 취소할까요?`)) return;
    startTransition(async () => {
      const result = await cancelReservation(item.assetId, item.category);
      showToast(result.ok ? '예약을 취소했어요.' : result.error);
    });
  }

  function handleReset() {
    if (!confirm('샘플 데이터로 초기화할까요? 현재 입력한 내용은 사라져요.')) return;
    startTransition(async () => {
      const result = await resetToSeed();
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      resetAll();
      showToast('초기화했어요.');
    });
  }

  return (
    <div className="app">
      <div className="dashboard-title-block">
        <h2>{dashboardTitle}</h2>
        {filters.category.length > 0 && (
          <div className="dashboard-subtitle">{filters.category.join(' · ')}</div>
        )}
      </div>

      <div className="topbar" style={{ marginBottom: '14px' }}>
        <div className="meta" style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>
          마지막 업데이트: {lastUpdated ?? '불러오는 중…'} · 표시 {visibleItems.length}건 / 전체{' '}
          {items.length}건
        </div>
        <div className="actions">
          <SpreadsheetLinkButton url={spreadsheetUrl} />
          <ExcelActions items={items} disabled={pending} onToast={showToast} />
          {dataSource === 'supabase' && (
            <button type="button" className="btn btn-ghost" onClick={handleReset} disabled={pending}>
              샘플 데이터로 초기화
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            ＋ 재고입력
          </button>
        </div>
      </div>

      <StatsRow
        items={items}
        filters={filters}
        searchTerm={searchTerm}
        onToggleStatus={(status) => setFilter('status', toggleMultiValue(filters.status, status))}
        onClearStatus={() => setFilter('status', [])}
        onToggleMalicious={() => setFilter('malicious', !filters.malicious)}
        onSelectConsumable={() => showToast('소모품가격표는 별도 화면에서 관리돼요.')}
      />

      <CategoryCards
        items={items}
        filters={filters}
        searchTerm={searchTerm}
        onToggle={(category) => setFilter('category', toggleMultiValue(filters.category, category))}
      />

      <SpecBreakdownPanels
        items={items}
        filters={filters}
        searchTerm={searchTerm}
        onToggle={(dimension, value) => setFilter(dimension, toggleMultiValue(filters[dimension], value))}
      />

      <FilterPanel
        items={items}
        filters={filters}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onSetFilter={setFilter}
      />

      <ActiveFilters
        filters={filters}
        searchTerm={searchTerm}
        onSetFilter={setFilter}
        onSetSearchTerm={setSearchTerm}
        onResetAll={resetAll}
      />

      <div className="count-row">
        <span>노트북</span>
        {cpuCounts.map(({ cpu, count }) => (
          <span key={cpu}>
            {cpu} <b>{count}대</b>
          </span>
        ))}
      </div>

      <InventoryTable
        items={visibleItems}
        disabled={pending}
        onEdit={(item) => {
          setEditing(item);
          setModalOpen(true);
        }}
        onDelete={handleDelete}
        onReserve={handleReserve}
        onCancelReservation={handleCancelReservation}
      />

      <AssetModal
        open={modalOpen}
        editing={editing}
        pending={pending}
        dataSource={dataSource}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <div className={`toast${toast.show ? ' show' : ''}`}>{toast.msg}</div>
    </div>
  );
}
