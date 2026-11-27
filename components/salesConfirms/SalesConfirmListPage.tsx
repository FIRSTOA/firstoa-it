'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MobileFilterRows from '@/components/MobileFilterRows';
import {
  compareSalesConfirmsWithSheet,
  listSalesConfirms,
  setSalesConfirmProcessors,
  setSalesConfirmStatus,
} from '@/app/confirm-form/salesActions';
import {
  SALES_CONFIRM_ACTOR_KEY,
  SALES_CONFIRM_STATUSES,
  SALES_STATE_DELETED,
  isHiddenByDefault,
  isOtherSalesType,
  salesConfirmHref,
  type SalesConfirmListData,
  type SalesConfirmListResult,
  type SalesConfirmListRow,
  type SalesConfirmStatus,
  type SalesListGroup,
  type SalesImportRouteResult,
  type SalesImportTrigger,
  type SalesWorkSaveResult,
  type SheetOnlyRow,
} from '@/lib/salesConfirms/types';
import { nextBusinessDay } from '@/lib/businessDay';
import { addDays, digitsOnly, fmtDate, kstToday, weekRange } from './format';
import ImportStatusBar from './ImportStatusBar';
import SalesConfirmTable, { type SheetColumnState } from './SalesConfirmTable';

/** 자동 가져오기 간격(화면이 보일 때만) — 설계 E2(2026-11-27): 3분 → 1분. 겹침 막기 60초는 서버(importer)가 그대로 */
const INTERVAL_MS = 60 * 1000;
const COMPARE_KEY = 'firstoa-it.sales-confirm-sheet-compare';

/** 'deleted' = 영업에서 지운 건만(칩 "영업에서 지움 n") */
type StatusFilter = 'default' | 'all' | 'deleted' | SalesConfirmStatus;
type DateFilter = 'all' | 'today' | 'tomorrow' | 'week' | 'past';
/**
 * 목록 위 세 항목(2026-11-27 사용자: 판매·철수·이전은 출고 준비가 아니니 "별도의 항목으로만", 직송도 따로).
 * 'ship' = 출고 준비 확인서(납품·교체·유지보수·소프트웨어, 기본) · 'direct' = 직송(매입처 → 고객사, 우리를 안 거침) · 'other' = 철수·이전·판매
 */
type ListGroup = SalesListGroup;
/** 날짜 밖 소식 거르기(F27) — 새로 · 영업에서 수정됨 · 영업에서 지웠는데 준비 중 */
type NewsFilter = 'new' | 'changed' | 'deleted';
/** 숫자 카드를 눌러 거르기 — 준비 남음 / 준비 완료 / 전체 */
type CardFilter = 'all' | 'left' | 'done';

const LEFT_STATUSES: readonly string[] = ['접수', '준비중', '보류'];
const DONE_STATUSES: readonly string[] = ['준비완료', '출고'];
/** 영업에서 지웠는데 IT가 손댄(준비 중) 처리여부 */
const TOUCHED_STATUSES: readonly string[] = ['준비중', '준비완료', '보류'];

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'today', label: '오늘' },
  { key: 'tomorrow', label: '내일' },
  { key: 'week', label: '이번 주' },
  { key: 'past', label: '지난 것' },
];

interface Meta {
  importState: SalesConfirmListData['importState'];
  people: string[];
  rangeLabel: string;
  hasKey: boolean;
}

interface Toast {
  msg: string;
  show: boolean;
  warn: boolean;
}

function matchDate(row: SalesConfirmListRow, f: DateFilter, today: string): boolean {
  const d = row.deliveryDate;
  if (f === 'all') return true;
  if (f === 'today') return d === today;
  if (f === 'tomorrow') return d === addDays(today, 1);
  if (f === 'week') {
    const w = weekRange(today);
    return !!d && d >= w.from && d <= w.to;
  }
  return !!d && d < today; // past
}

/** 영업에서 지운 확인서(① sales_state) */
function isSalesDeletedRow(row: SalesConfirmListRow): boolean {
  return row.salesState === SALES_STATE_DELETED;
}

/** 따로 보는 종류(판매·철수·이전) — 서버 값이 없으면 종류 이름으로 */
function isOtherRow(row: SalesConfirmListRow): boolean {
  return row.other ?? isOtherSalesType(row.type);
}

function groupOf(row: SalesConfirmListRow): ListGroup {
  if (isOtherRow(row)) return 'other';
  return row.directShip ? 'direct' : 'ship';
}

/** 지역 순 — 수도권A→E(일정 시간 9·12·15·18·21시 순), 그 밖 지역, 지역 없음은 맨 뒤 */
function regionRank(region: string): number {
  const m = /^수도권\s*([A-Ea-e])/.exec(region.trim());
  if (m) return m[1].toUpperCase().charCodeAt(0) - 65;
  return region.trim() ? 10 : 11;
}

function comparePrep(a: SalesConfirmListRow, b: SalesConfirmListRow): number {
  const ra = regionRank(a.region || '');
  const rb = regionRank(b.region || '');
  if (ra !== rb) return ra - rb;
  if ((a.region || '') !== (b.region || '')) return (a.region || '').localeCompare(b.region || '', 'ko');
  const c = (a.company || '').localeCompare(b.company || '', 'ko');
  return c !== 0 ? c : (a.docNo || '').localeCompare(b.docNo || '', 'ko', { numeric: true });
}

/** 준비하는 날 보기의 처리여부 — 기본은 영업에서 지운 건·취소를 뺌(고르면 그것만/전체) */
function matchPrepStatus(row: SalesConfirmListRow, f: StatusFilter): boolean {
  if (f === 'all') return true;
  if (f === 'deleted') return isSalesDeletedRow(row);
  if (f !== 'default') return row.status === f;
  return !isSalesDeletedRow(row) && row.status !== '취소';
}

/** 날짜 밖 소식 셈 — exceptDate 납품분은 뺌('' 이면 전부). 기본 보기에서 숨는 건은 안 셈 */
function countNews(rows: SalesConfirmListRow[], exceptDate: string, today: string) {
  let fresh = 0;
  let changed = 0;
  let deleted = 0;
  for (const r of rows) {
    if (exceptDate && r.deliveryDate === exceptDate) continue;
    if (isSalesDeletedRow(r)) {
      if (TOUCHED_STATUSES.includes(r.status)) deleted += 1;
      continue;
    }
    if (isHiddenByDefault(r, today)) continue;
    if (r.isNew) fresh += 1;
    if (r.salesChanged) changed += 1;
  }
  return { fresh, changed, deleted };
}

function matchNews(row: SalesConfirmListRow, f: NewsFilter): boolean {
  if (f === 'deleted') return isSalesDeletedRow(row) && TOUCHED_STATUSES.includes(row.status);
  if (isSalesDeletedRow(row)) return false;
  return f === 'new' ? row.isNew : !!row.salesChanged;
}

function matchStatus(row: SalesConfirmListRow, f: StatusFilter, today: string): boolean {
  if (f === 'all') return true;
  if (f === 'deleted') return isSalesDeletedRow(row);
  if (f !== 'default') return row.status === f;
  // 기본 보기 숨김 규칙은 types.ts isHiddenByDefault 한 곳(지운 건·끝난 건 — 설계 E27·E28, 끝난 건도 납품일 7일 안은 보임)
  return !isHiddenByDefault(row, today);
}

function matchSearch(row: SalesConfirmListRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [row.company, row.docNo, ...row.assetIds, ...row.serials, row.phone].join('\n').toLowerCase();
  if (hay.includes(s)) return true;
  const qd = digitsOnly(s);
  return qd.length >= 3 && digitsOnly(row.phone).includes(qd);
}

/**
 * 영업 확인서 목록 화면(1단계). page.tsx 가 initial 로 저장된 목록을 건네고,
 * 이 화면이 열려 있는 동안 영업 웹앱에서 가져오기(열 때 1번 · 화면이 보이면 1분마다 · 🔄 · ⋯)를 API 라우트로 부름.
 * 영업 웹앱이 안 돼도 저장된 목록은 그대로 보임(띠에만 이유).
 */
export default function SalesConfirmListPage({ initial }: { initial: SalesConfirmListResult }) {
  const router = useRouter();
  const initialError = initial.ok ? '' : 'error' in initial ? initial.error : '영업 확인서 표가 아직 없어요.';
  const [rows, setRows] = useState<SalesConfirmListRow[]>(initial.ok ? initial.data.rows : []);
  const [meta, setMeta] = useState<Meta>({
    importState: initial.ok ? initial.data.importState : null,
    people: initial.ok ? initial.data.people : [],
    rangeLabel: initial.ok ? initial.data.rangeLabel : '',
    hasKey: initial.ok ? initial.data.hasKey : true,
  });
  const [loadError, setLoadError] = useState(initialError);
  const [reloading, setReloading] = useState(false);

  // 목록 위 두 항목(출고 준비 / 철수·이전·판매)
  const [group, setGroup] = useState<ListGroup>('ship');
  // 필터
  const [statusF, setStatusF] = useState<StatusFilter>('default');
  const [typeF, setTypeF] = useState('all');
  // 지역(영업 웹앱 수도권A~E — 배송 동선) 거르기
  const [regionF, setRegionF] = useState('all');
  const [dateF, setDateF] = useState<DateFilter>('all');
  // 준비하는 날(출고 준비 리스트와 같음) — 'YYYY-MM-DD', '' = 전체. 브라우저에 안 남기고 늘 오늘로 시작
  const [prepDate, setPrepDate] = useState<string>(() => kstToday());
  const [cardF, setCardF] = useState<CardFilter>('all');
  const [newsF, setNewsF] = useState<NewsFilter | null>(null);
  const [procF, setProcF] = useState('all'); // 'all' | 'none' | 이름
  const [q, setQ] = useState('');

  // 가져오기
  const [importing, setImporting] = useState(false);
  const [liveRun, setLiveRun] = useState<SalesImportRouteResult | null>(null);
  const [netError, setNetError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 시트 비교(PC 만)
  const [compare, setCompare] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [sheet, setSheet] = useState<SheetColumnState>({ state: 'idle' });
  const [sheetOnly, setSheetOnly] = useState<SheetOnlyRow[]>([]);

  // 줄 저장·이름·알림
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [actor, setActor] = useState('');
  const [nameAsk, setNameAsk] = useState<{ initial: string; resolve: (v: string | null) => void } | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [toast, setToast] = useState<Toast>({ msg: '', show: false, warn: false });

  const actorRef = useRef('');
  const importingRef = useRef(false);
  const reloadingRef = useRef(false);
  const loadErrorRef = useRef(initialError);
  const lastRunRef = useRef(0);
  const compareBusyRef = useRef(false);
  const visibleIdsRef = useRef<string[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  loadErrorRef.current = loadError;

  // ───────── 알림 ─────────
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true, warn: false });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2200);
  }, []);
  // 실패는 저절로 안 닫힘(× 로 닫음)
  const showWarn = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, show: true, warn: true });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, show: false })), []);

  // ───────── 목록 다시 읽기(겹쳐 부르지 않음) ─────────
  const reload = useCallback(async (): Promise<boolean> => {
    if (reloadingRef.current) return false;
    reloadingRef.current = true;
    setReloading(true);
    try {
      const res = await listSalesConfirms();
      if (res.ok) {
        setRows(res.data.rows);
        setMeta({ importState: res.data.importState, people: res.data.people, rangeLabel: res.data.rangeLabel, hasKey: res.data.hasKey });
        setLoadError('');
        return true;
      }
      const msg = 'error' in res ? res.error : '영업 확인서 표가 아직 없어요.';
      if (loadErrorRef.current) setLoadError(msg);
      else showWarn(`목록을 다시 읽지 못했어요 — ${msg}`);
      return false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '목록을 읽지 못했어요.';
      if (loadErrorRef.current) setLoadError(msg);
      else showWarn(`목록을 다시 읽지 못했어요 — ${msg}`);
      return false;
    } finally {
      reloadingRef.current = false;
      setReloading(false);
    }
  }, [showWarn]);

  // ───────── 영업 웹앱에서 가져오기(진행 중이면 건너뜀) ─────────
  const runImport = useCallback(
    async (body: { trigger: SalesImportTrigger; force?: boolean; since?: string }) => {
      if (importingRef.current) return;
      importingRef.current = true;
      setImporting(true);
      lastRunRef.current = Date.now();
      try {
        const res = await fetch('/api/sales-confirms/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        let json: SalesImportRouteResult | null = null;
        try {
          json = (await res.json()) as SalesImportRouteResult;
        } catch {
          json = null;
        }
        if (!json || typeof json.ok !== 'boolean') {
          setNetError(`영업 웹앱에서 가져오지 못했어요(응답 ${res.status}). 잠시 뒤 다시 해 보세요.`);
          return;
        }
        setNetError('');
        if (json.skippedRecent) {
          if (body.trigger === 'manual' || body.trigger === 'pick-date') showToast('방금 가져와서 잠깐 쉬었어요. 조금 뒤에 다시 눌러 주세요.');
        } else {
          setLiveRun(json);
        }
        const st = json.state;
        if (st) setMeta((m) => ({ ...m, importState: st }));
        if (json.changed > 0 || loadErrorRef.current) await reload();
        if ((body.trigger === 'manual' || body.trigger === 'pick-date') && json.ok && !json.errorCode && !json.skippedRecent) {
          showToast(json.changed > 0 ? `새로 가져왔어요 (${json.changed}건 새로·바뀜)` : '새로 가져왔어요. 바뀐 건 없어요.');
        }
      } catch {
        setNetError('영업 웹앱에서 가져오지 못했어요 — 인터넷 연결을 확인해 주세요.');
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [reload, showToast],
  );

  // ───────── 시트와 비교(켰을 때만, 화면 열 때·켤 때 1번) ─────────
  const doCompare = useCallback(async () => {
    if (compareBusyRef.current) return;
    compareBusyRef.current = true;
    setSheet({ state: 'loading' });
    try {
      const res = await compareSalesConfirmsWithSheet(visibleIdsRef.current);
      if (res.ok) {
        setSheet({ state: 'ok', byConfirm: res.byConfirm });
        setSheetOnly(res.sheetOnly);
      } else {
        setSheet({ state: 'fail', error: res.error || '시트를 못 읽었어요(1분 뒤 다시).' });
        setSheetOnly([]);
      }
    } catch (e) {
      setSheet({ state: 'fail', error: e instanceof Error ? e.message : '시트를 못 읽었어요(1분 뒤 다시).' });
      setSheetOnly([]);
    } finally {
      compareBusyRef.current = false;
    }
  }, []);

  // ───────── 이름(처리한 사람) ─────────
  const askName = useCallback((initialName: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setNameDraft(initialName);
      setNameAsk({ initial: initialName, resolve });
    });
  }, []);

  const ensureActor = useCallback(async (): Promise<string | null> => {
    const have = actorRef.current.trim();
    if (have) return have;
    const got = await askName('');
    return got;
  }, [askName]);

  function submitName() {
    const v = nameDraft.trim();
    if (!v || !nameAsk) return;
    try {
      localStorage.setItem(SALES_CONFIRM_ACTOR_KEY, v);
    } catch {
      // 저장 못 해도(사생활 보호 모드 등) 이번엔 그대로 진행
    }
    actorRef.current = v;
    setActor(v);
    nameAsk.resolve(v);
    setNameAsk(null);
  }

  function cancelName() {
    nameAsk?.resolve(null);
    setNameAsk(null);
  }

  // ───────── 열 때 / 열려 있는 동안 ─────────
  useEffect(() => {
    try {
      const saved = (localStorage.getItem(SALES_CONFIRM_ACTOR_KEY) ?? '').trim();
      if (saved) {
        actorRef.current = saved;
        setActor(saved);
      }
    } catch {
      // 브라우저 저장소를 못 읽으면 이름은 필요할 때 묻기
    }
    const phone = window.matchMedia('(max-width: 640px)').matches;
    setIsPhone(phone);
    let wantCompare = false;
    try {
      wantCompare = localStorage.getItem(COMPARE_KEY) === '1';
    } catch {
      wantCompare = false;
    }
    setCompare(wantCompare);
    if (wantCompare && !phone) void doCompare();

    void runImport({ trigger: 'page' });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runImport({ trigger: 'interval' });
    }, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRunRef.current > INTERVAL_MS) void runImport({ trigger: 'interval' });
    };
    document.addEventListener('visibilitychange', onVisible);
    const tick = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // 열 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCompare() {
    const next = !compare;
    setCompare(next);
    try {
      localStorage.setItem(COMPARE_KEY, next ? '1' : '0');
    } catch {
      // 기억 못 해도 이번엔 동작
    }
    if (next && !isPhone) void doCompare();
  }

  // ───────── 보이는 줄 계산 ─────────
  const today = useMemo(() => kstToday(nowMs), [nowMs]);

  // 세 항목 나누기 — 아래 칩·숫자·필터는 고른 항목 안에서만
  const groupCounts = useMemo(() => {
    const c = { ship: 0, direct: 0, other: 0 };
    for (const r of rows) c[groupOf(r)] += 1;
    return c;
  }, [rows]);
  const groupRows = useMemo(() => rows.filter((r) => groupOf(r) === group), [rows, group]);

  // 준비하는 날 보기(출고 준비 확인서 항목에서 날짜를 골랐을 때) — 그날 납품분 = 고른 날의 다음 영업일
  const prepMode = group === 'ship' && prepDate !== '';
  const target = prepMode ? nextBusinessDay(prepDate) : '';
  // 숫자 카드 범위: 그날 납품분에서 영업에서 지운 건·취소를 뺀 것(직송·철수·이전·판매는 항목이 달라 이미 빠짐)
  const prepScope = useMemo(
    () => (prepMode ? groupRows.filter((r) => r.deliveryDate === target && !isSalesDeletedRow(r) && r.status !== '취소') : []),
    [prepMode, groupRows, target],
  );
  const prepLeft = useMemo(() => prepScope.filter((r) => LEFT_STATUSES.includes(r.status)).length, [prepScope]);
  const prepDone = useMemo(() => prepScope.filter((r) => DONE_STATUSES.includes(r.status)).length, [prepScope]);
  // 그날 납품이지만 직송이라 여기서 빠진 건수(안내용)
  const directOnTarget = useMemo(
    () =>
      prepMode
        ? rows.filter((r) => groupOf(r) === 'direct' && r.deliveryDate === target && !isSalesDeletedRow(r) && r.status !== '취소').length
        : 0,
    [prepMode, rows, target],
  );
  // 날짜 밖 소식(F27): 준비하는 날 보기엔 그날 납품이 아닌 것만, 전체 보기 칩엔 전부
  const newsOutside = useMemo(() => countNews(groupRows, target, today), [groupRows, target, today]);
  const newsAll = useMemo(() => countNews(groupRows, '', today), [groupRows, today]);
  const deletedCount = useMemo(() => groupRows.filter(isSalesDeletedRow).length, [groupRows]);

  const typeOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of groupRows) if (r.type) count.set(r.type, (count.get(r.type) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [groupRows]);

  // 지역 칩 — 이름순(수도권A → E), 빈 지역은 '지역 없음'
  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of groupRows) set.add(r.region || '');
    return [...set].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko')));
  }, [groupRows]);

  const procOptions = useMemo(() => {
    const set = new Set<string>(meta.people);
    for (const r of groupRows) for (const p of r.processors) set.add(p);
    return [...set];
  }, [groupRows, meta.people]);

  const visible = useMemo(() => {
    const list = groupRows.filter((r) => {
      if (prepMode) {
        if (r.deliveryDate !== target) return false;
        if (!matchPrepStatus(r, statusF)) return false;
        if (cardF === 'left' && !LEFT_STATUSES.includes(r.status)) return false;
        if (cardF === 'done' && !DONE_STATUSES.includes(r.status)) return false;
      } else {
        if (!matchStatus(r, statusF, today)) return false;
        if (!matchDate(r, dateF, today)) return false;
        if (newsF && !matchNews(r, newsF)) return false;
      }
      if (typeF !== 'all' && r.type !== typeF) return false;
      if (regionF !== 'all' && (r.region || '') !== regionF) return false;
      if (procF === 'none' && r.processors.length > 0) return false;
      if (procF !== 'all' && procF !== 'none' && !r.processors.includes(procF)) return false;
      return matchSearch(r, q);
    });
    // 준비하는 날 보기는 지역 순(수도권A→E, 그 밖·없음은 뒤) → 상호
    return prepMode ? [...list].sort(comparePrep) : list;
  }, [groupRows, prepMode, target, statusF, cardF, newsF, typeF, regionF, dateF, procF, q, today]);

  // 화면을 그릴 때마다 맞춰 둠 — 열 때 비교(effect)가 첫 줄 목록을 바로 쓰게
  visibleIdsRef.current = visible.map((r) => r.id);

  const filtersChanged =
    statusF !== 'default' ||
    typeF !== 'all' ||
    regionF !== 'all' ||
    (!prepMode && dateF !== 'all') ||
    (prepMode && cardF !== 'all') ||
    (!prepMode && newsF !== null) ||
    procF !== 'all' ||
    q.trim() !== '';

  /** 항목을 바꾸면 그 항목에 없을 수 있는 구분·지역 칩은 풂(다른 필터는 그대로) */
  function changeGroup(next: ListGroup) {
    if (next === group) return;
    setGroup(next);
    setTypeF('all');
    setRegionF('all');
    setCardF('all');
    setNewsF(null);
  }

  function clearFilters() {
    setStatusF('default');
    setTypeF('all');
    setRegionF('all');
    setDateF('all');
    setCardF('all');
    setNewsF(null);
    setProcF('all');
    setQ('');
  }

  /** 준비하는 날 바꾸기 — 숫자 카드·소식 거르기는 풂(그날 기준이 바뀌므로) */
  function pickPrepDate(v: string) {
    setPrepDate(v);
    setCardF('all');
    setNewsF(null);
  }

  /** 날짜 밖 소식 [보기] — 전체 보기로 + 그 거르기(처리여부·날짜 칩은 기본으로) */
  function showNews(f: NewsFilter) {
    setPrepDate('');
    setCardF('all');
    setStatusF('default');
    setDateF('all');
    setNewsF(f);
  }

  // ───────── 줄 바꾸기 ─────────
  const patchRow = useCallback((id: string, patch: Partial<SalesConfirmListRow>) => {
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const setBusy = useCallback((id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  async function finishSave(res: SalesWorkSaveResult, row: SalesConfirmListRow, revert: Partial<SalesConfirmListRow>) {
    if (res.ok) {
      patchRow(row.id, { workUpdatedAt: res.workUpdatedAt });
      showToast('저장했어요.');
      return;
    }
    patchRow(row.id, revert);
    if (res.conflict) {
      showWarn('다른 사람이 방금 고쳤어요 — 새로 불러왔어요.');
      await reload();
    } else {
      showWarn(`저장하지 못했어요 — ${res.error}`);
    }
  }

  async function onStatus(row: SalesConfirmListRow, status: SalesConfirmStatus) {
    const who = await ensureActor();
    if (who === null) return;
    setBusy(row.id, true);
    patchRow(row.id, { status });
    try {
      const res = await setSalesConfirmStatus({ id: row.id, status, actor: who, expectedUpdatedAt: row.workUpdatedAt });
      await finishSave(res, row, { status: row.status });
    } catch (e) {
      patchRow(row.id, { status: row.status });
      showWarn(`저장하지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setBusy(row.id, false);
    }
  }

  async function onProcessors(row: SalesConfirmListRow, processors: string[]) {
    const who = await ensureActor();
    if (who === null) return;
    setBusy(row.id, true);
    patchRow(row.id, { processors });
    try {
      const res = await setSalesConfirmProcessors({ id: row.id, processors, actor: who, expectedUpdatedAt: row.workUpdatedAt });
      await finishSave(res, row, { processors: row.processors });
    } catch (e) {
      patchRow(row.id, { processors: row.processors });
      showWarn(`저장하지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setBusy(row.id, false);
    }
  }

  // ───────── 띠에 보여 줄 오류(방금 결과가 있으면 그것, 없으면 저장돼 있던 상태) ─────────
  let barCode = liveRun ? liveRun.errorCode : (meta.importState?.lastErrorCode ?? null);
  let barError = liveRun ? liveRun.error : (meta.importState?.lastError ?? '');
  if (netError) {
    barCode = 'unreachable';
    barError = netError;
  }

  // 시트 비교는 출고 준비 확인서에서만(철수·이전·판매는 예전 시트와 맞출 게 없음)
  const isOtherGroup = group === 'other';
  const isDirectGroup = group === 'direct';
  const isShipGroup = group === 'ship';
  const showSheet = compare && !isPhone && isShipGroup;
  const groupLabel = isOtherGroup ? '철수·이전·판매' : isDirectGroup ? '직송' : '출고 준비 확인서';
  const targetLabel = fmtDate(target);
  const newsParts: { key: NewsFilter; label: string; n: number }[] = [
    { key: 'new', label: '새 확인서', n: newsOutside.fresh },
    { key: 'changed', label: '영업에서 수정됨', n: newsOutside.changed },
    { key: 'deleted', label: '영업에서 지웠는데 준비 중', n: newsOutside.deleted },
  ];
  const newsShown = newsParts.filter((p) => p.n > 0);

  // ───────── 그리기 ─────────
  return (
    <div className="app sc-page">
      <ImportStatusBar
        hasKey={meta.hasKey}
        state={meta.importState}
        errorCode={barCode}
        error={barError}
        importing={importing}
        nowMs={nowMs}
        onRefresh={() => void runImport({ force: true, trigger: 'manual' })}
        onPickDate={(since) => void runImport({ force: true, since, trigger: 'pick-date' })}
      />

      {loadError ? (
        <div className="panel sc-error" role="alert">
          <div className="empty-state">
            <div>⚠️</div>
            <div>목록을 읽지 못했어요.</div>
            <div className="sc-error-why">{loadError}</div>
            <button type="button" className="btn btn-primary sc-retry" disabled={reloading} onClick={() => void reload()}>
              {reloading ? '다시 읽는 중…' : '다시 시도'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sc-groupbar" role="group" aria-label="확인서 종류 나누기">
            <button
              type="button"
              className={`sc-group-btn${group === 'ship' ? ' on' : ''}`}
              aria-pressed={group === 'ship'}
              onClick={() => changeGroup('ship')}
            >
              <span>출고 준비 확인서</span>
              <b className="sc-group-n">{groupCounts.ship}</b>
            </button>
            <button
              type="button"
              className={`sc-group-btn direct${group === 'direct' ? ' on' : ''}`}
              aria-pressed={group === 'direct'}
              onClick={() => changeGroup('direct')}
              title="우리를 안 거치고 매입처에서 고객사로 바로 가는 건 — 출고 준비 숫자에서 빠져요"
            >
              <span>직송</span>
              <b className="sc-group-n">{groupCounts.direct}</b>
            </button>
            <button
              type="button"
              className={`sc-group-btn other${group === 'other' ? ' on' : ''}`}
              aria-pressed={group === 'other'}
              onClick={() => changeGroup('other')}
              title="철수·이전·판매 확인서 — 출고 준비 대상이 아니라 따로 모아 보기만 해요"
            >
              <span>철수·이전·판매</span>
              <b className="sc-group-n">{groupCounts.other}</b>
            </button>
          </div>
          {isOtherGroup && (
            <div className="ct-band muted sc-other-note" role="note">
              <span>
                철수·이전·판매 확인서는 출고 준비 대상이 아니라 여기에 따로 모아 보여 줘요(자산번호·시리얼·출력 칸 없음). 처리여부·처리자는 바꿀 수 있어요.
              </span>
            </div>
          )}
          {isDirectGroup && (
            <div className="ct-band muted sc-other-note" role="note">
              <span>우리를 안 거치고 매입처에서 바로 가는 건 — 출고 준비 숫자에서 빠져요. 눌러서 열면 받은 시리얼·자산번호를 적어 둘 수 있어요.</span>
            </div>
          )}

          {isShipGroup && (
            <>
              {prepMode && (
                <div className="sc-kpis">
                  <button
                    type="button"
                    className={`sc-kpi bad${cardF === 'left' ? ' on' : ''}`}
                    aria-pressed={cardF === 'left'}
                    onClick={() => {
                      setStatusF('default');
                      setCardF(cardF === 'left' ? 'all' : 'left');
                    }}
                  >
                    <div className="sc-kpi-label">🚨 준비 남음</div>
                    <div className="sc-kpi-v">
                      {prepLeft}
                      <small>건</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`sc-kpi good${cardF === 'done' ? ' on' : ''}`}
                    aria-pressed={cardF === 'done'}
                    onClick={() => {
                      setStatusF('default');
                      setCardF(cardF === 'done' ? 'all' : 'done');
                    }}
                  >
                    <div className="sc-kpi-label">✅ 준비 완료</div>
                    <div className="sc-kpi-v">
                      {prepDone}
                      <small>건</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`sc-kpi${cardF === 'all' ? ' on' : ''}`}
                    aria-pressed={cardF === 'all'}
                    onClick={() => {
                      setStatusF('default');
                      setCardF('all');
                    }}
                  >
                    <div className="sc-kpi-label">전체</div>
                    <div className="sc-kpi-v">
                      {prepScope.length}
                      <small>건</small>
                    </div>
                  </button>
                </div>
              )}

              <div className="panel sc-prepday">
                <span className="sc-prepday-label">준비하는 날</span>
                <input type="date" value={prepDate} aria-label="준비하는 날" onChange={(e) => pickPrepDate(e.target.value)} />
                <button type="button" className={`chip${prepDate === today ? ' active' : ''}`} onClick={() => pickPrepDate(today)}>
                  오늘
                </button>
                <button type="button" className={`chip${!prepDate ? ' active' : ''}`} onClick={() => pickPrepDate('')}>
                  전체
                </button>
                {prepMode && <span className="sc-prepday-to">→ {targetLabel} 납품분</span>}
                {!prepMode && <span className="sc-prepday-to">지금 목록 그대로 보고 있어요(날짜를 고르면 그날 준비할 것만)</span>}
              </div>

              {prepMode && newsShown.length > 0 && (
                <div className="ct-band warn sc-news" role="status">
                  <span className="sc-news-label">다른 날짜 —</span>
                  <div className="sc-news-parts">
                    {newsShown.map((p) => (
                      <span key={p.key} className="sc-news-part">
                        {p.label} <b>{p.n}</b>
                        <button type="button" className="btn btn-ghost sc-news-btn" onClick={() => showNews(p.key)}>
                          보기
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="panel sc-filters">
            <div className="search-row">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="상호·순번·자산번호·시리얼·연락처로 찾기"
                aria-label="확인서 찾기"
              />
            </div>
            <MobileFilterRows>
              <div className="filter-row">
                <span className="filter-label">처리여부</span>
                <div className="chip-group">
                  <button type="button" className={`chip${statusF === 'default' ? ' sc-chip-base' : ''}`} onClick={() => setStatusF('default')}>
                    {prepMode ? '기본 (취소 빼고)' : '기본 (안 끝난 건)'}
                  </button>
                  <button
                    type="button"
                    className={`chip${statusF === 'all' ? ' active' : ''}`}
                    onClick={() => {
                      setStatusF('all');
                      setCardF('all');
                    }}
                  >
                    전체
                  </button>
                  {SALES_CONFIRM_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`chip${statusF === s ? ' active' : ''}`}
                      onClick={() => {
                        setStatusF(s);
                        setCardF('all');
                      }}
                    >
                      {s}
                    </button>
                  ))}
                  {(deletedCount > 0 || statusF === 'deleted') && (
                    <button
                      type="button"
                      className={`chip sc-chip-deleted${statusF === 'deleted' ? ' active' : ''}`}
                      aria-pressed={statusF === 'deleted'}
                      onClick={() => setStatusF('deleted')}
                      title="영업 웹앱에서 지운 확인서만 보기(기본 보기에선 IT가 준비 중인 것만 빨갛게 남아요)"
                    >
                      영업에서 지움 {deletedCount}
                    </button>
                  )}
                  {!prepMode &&
                    isShipGroup &&
                    (
                      [
                        { key: 'new', label: '새로', n: newsAll.fresh },
                        { key: 'changed', label: '영업에서 수정됨', n: newsAll.changed },
                        { key: 'deleted', label: '지웠는데 준비 중', n: newsAll.deleted },
                      ] as { key: NewsFilter; label: string; n: number }[]
                    )
                      .filter((p) => p.n > 0 || newsF === p.key)
                      .map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className={`chip${newsF === p.key ? ' active' : ''}`}
                          aria-pressed={newsF === p.key}
                          onClick={() => setNewsF(newsF === p.key ? null : p.key)}
                        >
                          {p.label} {p.n}
                        </button>
                      ))}
                </div>
              </div>
              {!prepMode && (
                <div className="filter-row">
                  <span className="filter-label">납품일</span>
                  <div className="chip-group">
                    {DATE_FILTERS.map((d) => (
                      <button key={d.key} type="button" className={`chip${dateF === d.key ? ' active' : ''}`} onClick={() => setDateF(d.key)}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {typeOptions.length > 0 && (
                <div className="filter-row">
                  <span className="filter-label">구분</span>
                  <div className="chip-group">
                    <button type="button" className={`chip${typeF === 'all' ? ' active' : ''}`} onClick={() => setTypeF('all')}>
                      전체
                    </button>
                    {typeOptions.map((t) => (
                      <button key={t} type="button" className={`chip${typeF === t ? ' active' : ''}`} onClick={() => setTypeF(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {regionOptions.length > 0 && (
                <div className="filter-row">
                  <span className="filter-label">지역</span>
                  <div className="chip-group">
                    <button type="button" className={`chip${regionF === 'all' ? ' active' : ''}`} onClick={() => setRegionF('all')}>
                      전체
                    </button>
                    {regionOptions.map((g) => (
                      <button key={g || '(none)'} type="button" className={`chip${regionF === g ? ' active' : ''}`} onClick={() => setRegionF(g)}>
                        {g || '지역 없음'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="filter-row">
                <span className="filter-label">처리자</span>
                <div className="chip-group">
                  <button type="button" className={`chip${procF === 'all' ? ' active' : ''}`} onClick={() => setProcF('all')}>
                    전체
                  </button>
                  <button type="button" className={`chip${procF === 'none' ? ' active' : ''}`} onClick={() => setProcF('none')}>
                    미지정
                  </button>
                  {procOptions.map((p) => (
                    <button key={p} type="button" className={`chip${procF === p ? ' active' : ''}`} onClick={() => setProcF(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </MobileFilterRows>
          </div>

          <div className="count-row sc-toolbar">
            <span>
              <b>{visible.length}</b>건 보임
              {prepMode
                ? visible.length !== prepScope.length
                  ? ` (${targetLabel} 납품분 ${prepScope.length}건 중)`
                  : ''
                : groupRows.length !== visible.length
                  ? ` (${groupLabel} ${groupRows.length}건 중)`
                  : ''}
              {meta.rangeLabel ? <span className="sc-range"> · {meta.rangeLabel}</span> : null}
              {reloading ? <span className="sc-range"> · 새로 읽는 중…</span> : null}
            </span>
            {filtersChanged && (
              <button type="button" className="sc-link" onClick={clearFilters}>
                필터 지우기
              </button>
            )}
            <span className="sc-toolbar-right">
              {isShipGroup && (
                <button
                  type="button"
                  className={`chip sc-pc-only${compare ? ' active' : ''}`}
                  aria-pressed={compare}
                  onClick={toggleCompare}
                  title="예전 확인서리스트 시트와 같은지 나란히 봐요(읽기만 해요)"
                >
                  📄 시트와 비교
                </button>
              )}
              {showSheet && (
                <button type="button" className="chip sc-pc-only" disabled={sheet.state === 'loading'} onClick={() => void doCompare()}>
                  🔁 다시 비교
                </button>
              )}
              <span className="sc-who">
                이름: <b>{actor || '아직 없어요'}</b>{' '}
                <button type="button" className="sc-link" onClick={() => void askName(actor)}>
                  {actor ? '바꾸기' : '적기'}
                </button>
              </span>
            </span>
          </div>

          {showSheet && sheet.state === 'fail' && (
            <div className="ct-band warn sc-pc-only" role="alert">
              <span>시트를 못 읽었어요 — {sheet.error} (잠시 뒤 [다시 비교]를 눌러 보세요. 시트에는 아무것도 쓰지 않았어요.)</span>
            </div>
          )}

          <div className={`panel sc-listpanel${reloading ? ' ct-refreshing' : ''}`}>
            {visible.length > 0 && (
              <SalesConfirmTable
                rows={visible}
                people={meta.people}
                today={today}
                other={isOtherGroup}
                direct={isDirectGroup}
                showSheet={showSheet}
                sheet={sheet}
                busyIds={busyIds}
                onOpen={(r) => router.push(salesConfirmHref(r.id))}
                onStatus={(r, s) => void onStatus(r, s)}
                onProcessors={(r, list) => void onProcessors(r, list)}
              />
            )}
            {groupRows.length === 0 && isOtherGroup && (
              <div className="empty-state">
                <div>📭</div>
                <div>철수·이전·판매 확인서는 영업 웹앱에서 아직 보내지 않아요.</div>
                <div className="sc-empty-sub">영업 웹앱이 보내기 시작하면 여기에 따로 모여요(출고 준비 확인서 목록에는 안 섞여요).</div>
              </div>
            )}
            {groupRows.length === 0 && isDirectGroup && (
              <div className="empty-state">
                <div>📭</div>
                <div>직송 확인서가 없어요.</div>
                <div className="sc-empty-sub">영업 확인서에서 위탁사가 있고 위탁·직송이 &lsquo;직송&rsquo;인 건이 여기에 따로 모여요.</div>
              </div>
            )}
            {groupRows.length === 0 && isShipGroup && (
              <div className="empty-state">
                <div>📭</div>
                <div>{meta.hasKey ? '아직 가져온 영업 확인서가 없어요.' : '영업 웹앱과 아직 연결되지 않아 가져온 확인서가 없어요.'}</div>
                {meta.hasKey && <div className="sc-empty-sub">영업 웹앱에서 IT 확인서를 저장하면 여기에 나와요. 위의 [🔄 새로고침]을 눌러 보세요.</div>}
              </div>
            )}
            {prepMode && groupRows.length > 0 && visible.length === 0 && prepScope.length === 0 && !filtersChanged && (
              <div className="empty-state">
                <div>🗓️</div>
                <div>{targetLabel} 납품할 출고 준비 확인서가 없어요.</div>
                {directOnTarget > 0 && (
                  <div className="sc-empty-sub">
                    직송 {directOnTarget}건은 우리가 준비하지 않아 여기서 빠졌어요.{' '}
                    <button type="button" className="sc-link" onClick={() => changeGroup('direct')}>
                      직송 보기
                    </button>
                  </div>
                )}
                <button type="button" className="btn btn-ghost sc-retry" onClick={() => pickPrepDate('')}>
                  전체 보기
                </button>
              </div>
            )}
            {groupRows.length > 0 && visible.length === 0 && !(prepMode && prepScope.length === 0 && !filtersChanged) && (
              <div className="empty-state">
                <div>🔍</div>
                <div>조건에 맞는 확인서가 없어요. 필터를 바꿔 보세요.</div>
                {filtersChanged && (
                  <button type="button" className="btn btn-ghost sc-retry" onClick={clearFilters}>
                    필터 지우기
                  </button>
                )}
              </div>
            )}
          </div>

          {showSheet && sheet.state === 'ok' && (
            <details className="panel sc-sheet-only sc-pc-only">
              <summary>시트에만 있는 건 {sheetOnly.length}</summary>
              {sheetOnly.length === 0 ? (
                <div className="detail-empty">시트에만 있는 줄이 없어요.</div>
              ) : (
                <div className="sc-scroll">
                  <table className="sc-mini">
                    <thead>
                      <tr>
                        <th>시트 줄</th>
                        <th>납품/교체일</th>
                        <th>접수</th>
                        <th>처리여부</th>
                        <th>구분</th>
                        <th>상호</th>
                        <th>품목</th>
                        <th>자산번호</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetOnly.map((s) => (
                        <tr key={s.sheetRow}>
                          <td>{s.sheetRow}</td>
                          <td>{s.deliveryDateText || '-'}</td>
                          <td>{s.receivedText || '-'}</td>
                          <td>{s.status || '-'}</td>
                          <td>{s.type || '-'}</td>
                          <td>{s.company || '-'}</td>
                          <td>{s.items || '-'}</td>
                          <td>{s.assetIds.length ? s.assetIds.join(', ') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="sc-muted" style={{ padding: '8px 0 10px' }}>
                영업 웹앱을 거치지 않고 시트에만 적힌 건이에요(확인용). 오늘({fmtDate(today)}) 기준으로 맞춰 봤어요.
              </div>
            </details>
          )}
        </>
      )}

      {nameAsk && (
        <div className="modal-overlay open sc-name-overlay" onClick={cancelName}>
          <div className="modal sc-name-modal" role="dialog" aria-modal="true" aria-label="이름 적기" onClick={(e) => e.stopPropagation()}>
            <h2>누가 바꾸나요?</h2>
            <div className="sub">처리여부·처리자를 바꾼 사람 이름을 남겨요. 이 브라우저에 기억해 두니 한 번만 적으면 돼요.</div>
            <div className="form-field">
              <label htmlFor="sc-name">이름</label>
              <input
                id="sc-name"
                value={nameDraft}
                maxLength={30}
                autoFocus
                placeholder="예: 홍길동"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitName();
                }}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={cancelName}>
                취소
              </button>
              <button type="button" className="btn btn-primary" disabled={!nameDraft.trim()} onClick={submitName}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast${toast.show ? ' show' : ''}${toast.warn ? ' toast-warn' : ''}`} role={toast.warn ? 'alert' : undefined}>
        <span>{toast.msg}</span>
        <button type="button" className="toast-close" onClick={closeToast} aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
