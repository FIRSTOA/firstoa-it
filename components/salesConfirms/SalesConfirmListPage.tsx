'use client';

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
  SALES_CONFIRM_DONE_STATUSES,
  SALES_CONFIRM_STATUSES,
  type SalesConfirmListData,
  type SalesConfirmListResult,
  type SalesConfirmListRow,
  type SalesConfirmStatus,
  type SalesImportRouteResult,
  type SalesImportTrigger,
  type SalesWorkSaveResult,
  type SheetOnlyRow,
} from '@/lib/salesConfirms/types';
import { addDays, digitsOnly, fmtDate, kstToday, weekRange } from './format';
import ImportStatusBar from './ImportStatusBar';
import SalesConfirmPreview from './SalesConfirmPreview';
import SalesConfirmTable, { type SheetColumnState } from './SalesConfirmTable';

const INTERVAL_MS = 3 * 60 * 1000;
const COMPARE_KEY = 'firstoa-it.sales-confirm-sheet-compare';

type StatusFilter = 'default' | 'all' | SalesConfirmStatus;
type DateFilter = 'all' | 'today' | 'tomorrow' | 'week' | 'past';

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

function matchStatus(row: SalesConfirmListRow, f: StatusFilter, today: string): boolean {
  if (f === 'all') return true;
  if (f !== 'default') return row.status === f;
  // 기본: 안 끝난 건 + 끝난 건 중 납품일이 지난 7일 안(앞으로 올 것 포함)
  if (!SALES_CONFIRM_DONE_STATUSES.includes(row.status)) return true;
  return !!row.deliveryDate && row.deliveryDate >= addDays(today, -7);
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
 * 이 화면이 열려 있는 동안 영업 웹앱에서 가져오기(열 때 1번 · 화면이 보이면 3분마다 · 🔄 · ⋯)를 API 라우트로 부름.
 * 영업 웹앱이 안 돼도 저장된 목록은 그대로 보임(띠에만 이유).
 */
export default function SalesConfirmListPage({ initial }: { initial: SalesConfirmListResult }) {
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

  // 필터
  const [statusF, setStatusF] = useState<StatusFilter>('default');
  const [typeF, setTypeF] = useState('all');
  const [dateF, setDateF] = useState<DateFilter>('all');
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

  // 줄 저장·미리보기·이름·알림
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
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

  const typeOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) if (r.type) count.set(r.type, (count.get(r.type) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [rows]);

  const procOptions = useMemo(() => {
    const set = new Set<string>(meta.people);
    for (const r of rows) for (const p of r.processors) set.add(p);
    return [...set];
  }, [rows, meta.people]);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (!matchStatus(r, statusF, today)) return false;
      if (typeF !== 'all' && r.type !== typeF) return false;
      if (!matchDate(r, dateF, today)) return false;
      if (procF === 'none' && r.processors.length > 0) return false;
      if (procF !== 'all' && procF !== 'none' && !r.processors.includes(procF)) return false;
      return matchSearch(r, q);
    });
  }, [rows, statusF, typeF, dateF, procF, q, today]);

  // 화면을 그릴 때마다 맞춰 둠 — 열 때 비교(effect)가 첫 줄 목록을 바로 쓰게
  visibleIdsRef.current = visible.map((r) => r.id);

  const filtersChanged = statusF !== 'default' || typeF !== 'all' || dateF !== 'all' || procF !== 'all' || q.trim() !== '';
  function clearFilters() {
    setStatusF('default');
    setTypeF('all');
    setDateF('all');
    setProcF('all');
    setQ('');
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

  // ───────── 미리보기 ─────────
  const closePreview = useCallback((id: string) => {
    setPreviewId(null);
    patchRow(id, { isNew: false });
  }, [patchRow]);

  const onPreviewLoaded = useCallback(
    (id: string, info: { workUpdatedAt: string | null; status: SalesConfirmStatus; processors: string[]; note: string }) => {
      patchRow(id, { workUpdatedAt: info.workUpdatedAt, status: info.status, processors: info.processors, note: info.note });
    },
    [patchRow],
  );

  const onPreviewAcknowledged = useCallback(
    (id: string, workUpdatedAt: string) => {
      patchRow(id, { salesChanged: null, workUpdatedAt });
    },
    [patchRow],
  );

  // ───────── 띠에 보여 줄 오류(방금 결과가 있으면 그것, 없으면 저장돼 있던 상태) ─────────
  let barCode = liveRun ? liveRun.errorCode : (meta.importState?.lastErrorCode ?? null);
  let barError = liveRun ? liveRun.error : (meta.importState?.lastError ?? '');
  if (netError) {
    barCode = 'unreachable';
    barError = netError;
  }

  const showSheet = compare && !isPhone;

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
                    기본 (안 끝난 건)
                  </button>
                  <button type="button" className={`chip${statusF === 'all' ? ' active' : ''}`} onClick={() => setStatusF('all')}>
                    전체
                  </button>
                  {SALES_CONFIRM_STATUSES.map((s) => (
                    <button key={s} type="button" className={`chip${statusF === s ? ' active' : ''}`} onClick={() => setStatusF(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
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
              <b>{visible.length}</b>건 보임{rows.length !== visible.length ? ` (가져온 ${rows.length}건 중)` : ''}
              {meta.rangeLabel ? <span className="sc-range"> · {meta.rangeLabel}</span> : null}
              {reloading ? <span className="sc-range"> · 새로 읽는 중…</span> : null}
            </span>
            {filtersChanged && (
              <button type="button" className="sc-link" onClick={clearFilters}>
                필터 지우기
              </button>
            )}
            <span className="sc-toolbar-right">
              <button
                type="button"
                className={`chip sc-pc-only${compare ? ' active' : ''}`}
                aria-pressed={compare}
                onClick={toggleCompare}
                title="예전 확인서리스트 시트와 같은지 나란히 봐요(읽기만 해요)"
              >
                📄 시트와 비교
              </button>
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
                showSheet={showSheet}
                sheet={sheet}
                busyIds={busyIds}
                onOpen={(r) => setPreviewId(r.id)}
                onStatus={(r, s) => void onStatus(r, s)}
                onProcessors={(r, list) => void onProcessors(r, list)}
              />
            )}
            {rows.length === 0 && (
              <div className="empty-state">
                <div>📭</div>
                <div>{meta.hasKey ? '아직 가져온 영업 확인서가 없어요.' : '영업 웹앱과 아직 연결되지 않아 가져온 확인서가 없어요.'}</div>
                {meta.hasKey && <div className="sc-empty-sub">영업 웹앱에서 IT 확인서를 저장하면 여기에 나와요. 위의 [🔄 새로고침]을 눌러 보세요.</div>}
              </div>
            )}
            {rows.length > 0 && visible.length === 0 && (
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

      {previewId && (
        <SalesConfirmPreview
          key={previewId}
          id={previewId}
          actor={actor}
          ensureActor={ensureActor}
          onClose={closePreview}
          onLoaded={onPreviewLoaded}
          onAcknowledged={onPreviewAcknowledged}
        />
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
