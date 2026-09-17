'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getRentalFilterOptions, searchRentals, type RentalRow } from '@/app/rentals/actions';
import RentalSyncModal from './RentalSyncModal';

const PAGE_SIZE = 50;

type FilterKey = 'region' | 'province' | 'item' | 'manufacturer' | 'contractType' | 'grade';

const FILTER_LABELS: Record<FilterKey, string> = {
  region: '지역(담당)',
  province: '시/도',
  item: '품목',
  manufacturer: '제조사',
  contractType: '계약형태',
  grade: '거래처등급',
};

type Filters = Record<FilterKey, string | null>;
const EMPTY_FILTERS: Filters = {
  region: null,
  province: null,
  item: null,
  manufacturer: null,
  contractType: null,
  grade: null,
};

type FilterOptions = Record<FilterKey, string[]>;
const EMPTY_OPTIONS: FilterOptions = { region: [], province: [], item: [], manufacturer: [], contractType: [], grade: [] };

export default function RentalListPage({ sheetUrl }: { sheetUrl: string | null }) {
  const [tab, setTab] = useState<'active' | 'ended'>('active');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<RentalRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getRentalFilterOptions().then((res) => {
      if (res.ok) {
        setFilterOptions({
          region: res.regions,
          province: res.provinces,
          item: res.items,
          manufacturer: res.manufacturers,
          contractType: res.contractTypes,
          grade: res.grades,
        });
      }
    });
  }, []);

  // 검색어는 300ms 디바운스, 나머지(탭/필터/페이지)는 바로 반영
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchTerm(searchInput), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [tab, searchTerm, filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    searchRentals({
      tab,
      searchTerm,
      ...filters,
      page,
      pageSize: PAGE_SIZE,
    }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }
      setError(null);
      setRows(res.rows);
      setTotalCount(res.totalCount);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, searchTerm, filters, page]);

  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const pageNumbers = useMemo(() => {
    const start = Math.max(0, Math.min(page - 2, totalPages - 5));
    return Array.from({ length: Math.min(5, totalPages) }, (_, i) => start + i);
  }, [page, totalPages]);

  function setFilter(key: FilterKey, value: string | null) {
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));
  }

  return (
    <div className="app">
      <div className="topbar" style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
          <button
            type="button"
            className={`chip${tab === 'active' ? ' active' : ''}`}
            onClick={() => setTab('active')}
          >
            임대리스트
          </button>
          <button type="button" className={`chip${tab === 'ended' ? ' active' : ''}`} onClick={() => setTab('ended')}>
            종료거래처
          </button>
          <span style={{ fontSize: '12.5px', color: 'var(--ink-500)' }}>전체 {totalCount.toLocaleString()}건</span>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={() => setSyncOpen(true)}>
            🔄 시트 대조
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="search-row">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="거래처명 · 담당자 · 순번 · 모델명 · S/N 검색"
          />
        </div>
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
          <div className="filter-row" key={key}>
            <div className="filter-label">{FILTER_LABELS[key]}</div>
            <div className="chip-group">
              <button
                type="button"
                className={`chip${!filters[key] ? ' active' : ''}`}
                onClick={() => setFilter(key, null)}
              >
                전체
              </button>
              {filterOptions[key].map((option) => (
                <button
                  type="button"
                  key={option}
                  className={`chip${filters[key] === option ? ' active' : ''}`}
                  onClick={() => setFilter(key, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ paddingTop: '6px', marginTop: '12px', overflowX: 'auto' }}>
        {error && <div className="setup-alert">{error}</div>}
        <table>
          <thead>
            <tr>
              <th style={{ width: '50px' }}>순번</th>
              <th>거래처명</th>
              <th>현장/지점명</th>
              <th>담당자</th>
              <th>연락처</th>
              <th>자산코드</th>
              <th>모델명</th>
              <th>기기 S/N</th>
              <th>계약일</th>
              <th>종료일</th>
              <th>상태</th>
              <th>품목</th>
              <th>제조사</th>
              <th>옵션1</th>
              <th>옵션2</th>
              <th>옵션3</th>
              <th>옵션4</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.seq || '-'}</td>
                <td>{r.vendorName || '-'}</td>
                <td>{r.siteName || '-'}</td>
                <td style={{ fontSize: '12.5px' }}>{r.manager || '-'}</td>
                <td style={{ fontSize: '12.5px' }}>{r.phone || '-'}</td>
                <td>
                  <span className="asset-id">{r.assetCode || '-'}</span>
                </td>
                <td>{r.modelName || '-'}</td>
                <td style={{ fontSize: '12.5px' }}>{r.serialNumber || '-'}</td>
                <td style={{ fontSize: '12.5px' }}>{r.contractDate || '-'}</td>
                <td style={{ fontSize: '12.5px' }}>{r.endDate || '-'}</td>
                <td>
                  <span className={`badge ${r.status === '임대종료' ? 'badge-악성' : 'badge-상품화완료'}`}>
                    {r.status || '-'}
                  </span>
                </td>
                <td>{r.item || '-'}</td>
                <td>{r.manufacturer || '-'}</td>
                <td style={{ fontSize: '12px' }}>{r.option1 || '-'}</td>
                <td style={{ fontSize: '12px' }}>{r.option2 || '-'}</td>
                <td style={{ fontSize: '12px' }}>{r.option3 || '-'}</td>
                <td style={{ fontSize: '12px' }}>{r.option4 || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="empty-state">
            <div>📋</div>
            <div>
              {totalCount === 0
                ? '아직 동기화된 데이터가 없어요. "시트 대조"로 먼저 반영해주세요.'
                : '조건에 맞는 거래처가 없어요.'}
            </div>
          </div>
        )}
        {loading && <div style={{ padding: '16px', color: 'var(--ink-400)', fontSize: '13px' }}>불러오는 중…</div>}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '12px' }}>
          <button type="button" className="chip" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            이전
          </button>
          {pageNumbers.map((p) => (
            <button
              type="button"
              key={p}
              className={`chip${p === page ? ' active' : ''}`}
              onClick={() => setPage(p)}
            >
              {p + 1}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </button>
        </div>
      )}

      <RentalSyncModal
        open={syncOpen}
        sheetUrl={sheetUrl}
        onClose={() => setSyncOpen(false)}
        onApplied={() => {
          setPage(0);
          searchRentals({ tab, searchTerm, ...filters, page: 0, pageSize: PAGE_SIZE }).then((res) => {
            if (res.ok) {
              setRows(res.rows);
              setTotalCount(res.totalCount);
            }
          });
        }}
      />
    </div>
  );
}
