import 'server-only';

/**
 * 홈 대시보드(/home) 데이터 — 각 메뉴의 원본(Supabase·구글시트·네이버 동기화·카톡 큐)에서 숫자만 모아 옴.
 * 구글시트(IT 재고·확인서)는 느려서 따로(Suspense로 나중에 채움), 나머지는 한꺼번에 동시에 읽음.
 * 어느 하나가 실패해도 그 카드만 "못 읽음"으로 표시하고 화면은 뜨게 — 모든 함수가 예외를 안 던짐.
 */
import { listPrepEvents, type PrepEventRow } from '@/app/shipment-prep/actions';
import { listConfirmDocs } from '@/app/confirmForm/sheetActions';
import { summarizeReview } from '@/lib/billingAllocation';
import { buildContractsOverview } from '@/lib/contracts/clients';
import { nextBusinessDay } from '@/lib/businessDay';
import { readDeliveryModes } from '@/lib/salesConfirms/listQuery';
import { getSheetsClient } from '@/lib/googleAuth';
import { isInventorySheetConfigured, listAllAssets } from '@/lib/inventory/sheets';
import {
  SALES_STATE_DELETED,
  importStateFromRow,
  isOtherSalesType,
  salesChangedSince,
  type SalesImportState,
  type SalesImportStateRow,
} from '@/lib/salesConfirms/types';
import { isPrepDone, isPrepInProgress, shortDateLabel } from '@/lib/shipmentPrep';
import {
  BILLING_LINES_TABLE,
  CALENDAR_TABLE,
  RECEIVING_TABLE,
  SALES_CONFIRMS_TABLE,
  SALES_CONFIRM_WORK_TABLE,
  SALES_IMPORT_STATE_TABLE,
  STOCKTAKE_TABLE,
  createAdminClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- 날짜(한국 시간) ----------

/** 한국 시간 오늘 'YYYY-MM-DD' */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 다음 영업일은 lib/businessDay.ts(순수 — 확인서 목록 화면도 같이 씀)

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 맨 위 날짜 줄: "11월 18일 수요일" + "2026 · 4분기 · 11월 3주차" */
export function todayHeading(ymd: string): { title: string; sub: string } {
  const d = parseYmd(ymd);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getUTCDay();
  const weekOfMonth = Math.ceil((day + first) / 7);
  return {
    title: `${month}월 ${day}일 ${WEEKDAYS[d.getUTCDay()]}요일`,
    sub: `${d.getUTCFullYear()} · ${Math.ceil(month / 3)}분기 · ${month}월 ${weekOfMonth}주차`,
  };
}

/** "방금" / "12분 전" / "3시간 전" / "어제" / "11/12" */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '-';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const days = Math.floor(h / 24);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  const k = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
}

// ---------- 업무 현황 카드 ----------

export type Tone = 'good' | 'warn' | 'bad' | 'muted';
export type Metric = { label: string; value: string | number; tone?: Tone };
export type WorkCard = {
  key: string;
  title: string;
  icon: string;
  href: string;
  metrics: Metric[];
  /** 지금 손봐야 할 것 한 줄(없으면 "이상 없음") */
  alert: string | null;
  /** 카드 위 띠 색 */
  tone: Tone;
  error?: string;
};

function errorCard(key: string, title: string, icon: string, href: string, error: string): WorkCard {
  return { key, title, icon, href, metrics: [], alert: null, tone: 'muted', error };
}

const isPrepared = (e: PrepEventRow) => Object.values(e.prepChecks).some(isPrepDone);

export type PrepStatus = 'done' | 'doing' | 'waiting';
export function prepStatusOf(e: PrepEventRow): PrepStatus {
  const entries = Object.values(e.prepChecks);
  if (entries.some(isPrepDone)) return 'done';
  if (entries.some((x) => isPrepInProgress(x) || !!x?.overhaul_at)) return 'doing';
  return 'waiting';
}

export type PrepOverview = {
  card: WorkCard;
  today: string;
  target: string;
  todayEvents: PrepEventRow[];
  targetEvents: PrepEventRow[];
};

/** 출고 준비 — 오늘 준비할 것 = 다음 영업일 출고분, 오늘 출고분은 완료 보고(카톡) 발송 여부 */
export async function loadPrepOverview(today: string): Promise<PrepOverview> {
  const target = nextBusinessDay(today);
  const base = { today, target, todayEvents: [] as PrepEventRow[], targetEvents: [] as PrepEventRow[] };
  try {
    const res = await listPrepEvents();
    if (!res.ok) return { ...base, card: errorCard('prep', '출고 준비', '✨', '/shipment-prep', res.error) };
    const todayEvents = res.events.filter((e) => e.date === today);
    const targetEvents = res.events.filter((e) => e.date === target);
    const remaining = targetEvents.filter((e) => !isPrepared(e)).length;
    const unreported = todayEvents.filter((e) => !e.reportSent).length;
    // 보낸 완료 보고 중 IT재고 위치를 못 바꾼 것(목록 범위 -14~+60일 전체)
    const stockProblemEvents = res.events.filter((e) => e.stockProblem > 0);
    const stockProblemUnits = stockProblemEvents.reduce((n, e) => n + e.stockProblem, 0);
    const stockAlert = stockProblemEvents.length
      ? `IT재고 반영 안 된 완료 보고 ${stockProblemEvents.length}건(${stockProblemUnits}대) — 출고 준비에서 완료 보고를 열어 [재고 다시 반영]`
      : null;
    const mainAlert = remaining
      ? `${shortDateLabel(target)} 출고분 중 준비 안 된 일정 ${remaining}건`
      : unreported
        ? `오늘 출고분 중 완료 보고(카톡) 안 보낸 일정 ${unreported}건`
        : null;
    return {
      ...base,
      todayEvents,
      targetEvents,
      card: {
        key: 'prep',
        title: '출고 준비',
        icon: '✨',
        href: '/shipment-prep',
        metrics: [
          { label: `${shortDateLabel(target)} 출고`, value: targetEvents.length },
          { label: '준비 잔여', value: remaining, tone: remaining ? 'bad' : 'good' },
          { label: '오늘 출고', value: todayEvents.length },
          { label: '보고 미발송', value: unreported, tone: unreported ? 'warn' : undefined },
        ],
        alert: [mainAlert, stockAlert].filter(Boolean).join(' · ') || null,
        tone: remaining ? 'bad' : unreported || stockAlert ? 'warn' : 'good',
      },
    };
  } catch (err) {
    return { ...base, card: errorCard('prep', '출고 준비', '✨', '/shipment-prep', errMsg(err)) };
  }
}

/**
 * Supabase 는 한 번에 최대 1000줄만 돌려줌(.limit 을 더 크게 줘도) — 끝까지 페이지로 읽음.
 * 건수만 필요하면 이것 말고 count: 'exact', head: true 로.
 */
async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** 입고 — 대기·지연(예상입고일 지남)·오늘 예정·이번 달 완료 */
export async function loadReceivingCard(today: string): Promise<WorkCard> {
  const href = '/receiving';
  if (!isSupabaseConfigured()) return errorCard('receiving', '입고', '📥', href, 'Supabase 설정이 필요해요.');
  try {
    const supabase = createAdminClient();
    const monthStart = `${today.slice(0, 8)}01T00:00:00+09:00`;
    const [waitingRes, doneRes] = await Promise.all([
      supabase.from(RECEIVING_TABLE).select('expected_date').eq('status', '입고대기').limit(2000),
      supabase.from(RECEIVING_TABLE).select('id', { count: 'exact', head: true }).eq('status', '입고완료').gte('completed_at', monthStart),
    ]);
    if (waitingRes.error) throw waitingRes.error;
    const waiting = (waitingRes.data ?? []) as { expected_date: string | null }[];
    const late = waiting.filter((r) => r.expected_date && r.expected_date < today).length;
    const dueToday = waiting.filter((r) => r.expected_date === today).length;
    return {
      key: 'receiving',
      title: '입고',
      icon: '📥',
      href,
      metrics: [
        { label: '입고 대기', value: waiting.length },
        { label: '지연', value: late, tone: late ? 'bad' : 'good' },
        { label: '오늘 예정', value: dueToday },
        { label: '이번 달 완료', value: doneRes.count ?? '-' },
      ],
      alert: late ? `예상입고일 지난 입고 대기 ${late}건` : null,
      tone: late ? 'bad' : 'good',
    };
  } catch (err) {
    return errorCard('receiving', '입고', '📥', href, errMsg(err));
  }
}

/** 실재고 조사 — 진행중·이번 달 완료·마지막 조사 */
export async function loadStocktakeCard(today: string): Promise<WorkCard> {
  const href = '/stocktake';
  if (!isSupabaseConfigured()) return errorCard('stocktake', '실재고 조사', '📋', href, 'Supabase 설정이 필요해요.');
  try {
    const supabase = createAdminClient();
    const monthStart = `${today.slice(0, 8)}01T00:00:00+09:00`;
    // 완료 건수는 DB에서 셈 — 최근 몇백 줄만 읽어 세면 그 수에서 잘림(배포 직후 "297"이 그랬음)
    const [openRes, doneRes, lastRes] = await Promise.all([
      supabase.from(STOCKTAKE_TABLE).select('started_at').eq('status', '진행중'),
      supabase.from(STOCKTAKE_TABLE).select('id', { count: 'exact', head: true }).eq('status', '완료').gte('completed_at', monthStart),
      supabase.from(STOCKTAKE_TABLE).select('location,started_at').order('started_at', { ascending: false }).limit(1),
    ]);
    if (openRes.error) throw openRes.error;
    if (doneRes.error) throw doneRes.error;
    if (lastRes.error) throw lastRes.error;
    const open = (openRes.data ?? []) as { started_at: string }[];
    const stale = open.filter((r) => Date.now() - new Date(r.started_at).getTime() > 24 * 3600_000).length;
    const monthDone = doneRes.count ?? 0;
    const last = (lastRes.data?.[0] ?? null) as { location: string; started_at: string } | null;
    return {
      key: 'stocktake',
      title: '실재고 조사',
      icon: '📋',
      href,
      metrics: [
        { label: '진행중', value: open.length, tone: stale ? 'warn' : undefined },
        { label: '이번 달 완료', value: monthDone },
        { label: '마지막 조사', value: last ? relativeTime(last.started_at) : '-' },
      ],
      alert: stale ? `하루 넘게 진행중인 조사 ${stale}건 — 마무리(조사 종료)가 필요해요` : last ? `마지막: ${last.location}` : null,
      tone: stale ? 'warn' : 'good',
    };
  } catch (err) {
    return errorCard('stocktake', '실재고 조사', '📋', href, errMsg(err));
  }
}

function shortWon(n: number): string {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`;
  return n.toLocaleString('ko-KR');
}

/** 청구 — 배분 확인 필요·이번 달 청구 건수·금액 */
export async function loadBillingCard(today: string): Promise<WorkCard> {
  const href = '/billing';
  if (!isSupabaseConfigured()) return errorCard('billing', '청구', '🧾', href, 'Supabase 설정이 필요해요.');
  try {
    const supabase = createAdminClient();
    const monthStart = `${today.slice(0, 8)}01`;
    // 이번 달 청구는 1000줄을 넘음 — 건수는 DB에서 세고, 금액은 페이지로 끝까지 읽어 더함
    const thisMonth = () =>
      supabase.from(BILLING_LINES_TABLE).select('amount').gte('billing_date', monthStart).lte('billing_date', today).neq('status', '취소');
    const [summary, countRes, amounts] = await Promise.all([
      summarizeReview(),
      supabase
        .from(BILLING_LINES_TABLE)
        .select('id', { count: 'exact', head: true })
        .gte('billing_date', monthStart)
        .lte('billing_date', today)
        .neq('status', '취소'),
      readAllPages<{ amount: number | string }>((from, to) => thisMonth().order('id').range(from, to)),
    ]);
    if (countRes.error) throw countRes.error;
    const monthCount = countRes.count ?? amounts.length;
    const sum = amounts.reduce((s, l) => s + Number(l.amount || 0), 0);
    const review = summary.rentals;
    return {
      key: 'billing',
      title: '청구',
      icon: '🧾',
      href: review ? '/billing?view=review' : href,
      metrics: [
        { label: '자산번호 없는 임대 건', value: review, tone: review ? 'warn' : 'good' },
        ...(summary.orphanLines > 0 ? [{ label: '임대 건 모르는 줄', value: summary.orphanLines }] : []),
        { label: '이번 달 건수', value: monthCount },
        { label: '이번 달 금액', value: `${shortWon(sum)}원` },
      ],
      alert: review ? `자산번호 없는 임대 건 ${review}개` : null,
      tone: review ? 'warn' : 'good',
    };
  } catch (err) {
    return errorCard('billing', '청구', '🧾', href, errMsg(err));
  }
}

/**
 * 계약 — 소프트웨어 계약의 30일 안 갱신·만료 / 날짜 지남 / 상세 미입력. firstoa-works 를 읽으므로 홈에선 Suspense 로.
 * works 를 못 읽어 임대리스트 사본으로 대신하면 제목에 "(사본 기준)". bad(빨강)는 안 씀 — warn 까지만.
 */
export async function loadContractsCard(): Promise<WorkCard> {
  const href = '/contracts';
  if (!isSupabaseConfigured()) return errorCard('contracts', '계약', '📑', href, 'Supabase 설정이 필요해요.');
  try {
    const o = await buildContractsOverview('sw');
    if (o.tablesMissing) {
      return errorCard('contracts', '계약', '📑', href, '계약 표를 아직 안 만들었어요 — supabase/contracts_schema.sql 먼저 실행');
    }
    if (o.source === 'none') return errorCard('contracts', '계약', '📑', href, o.sourceError ?? '거래처 목록을 못 읽었어요');
    const live = o.clients.filter((c) => c.state !== 'ended');
    const due = live.filter((c) => c.renewal === 'due30').length;
    const expired = live.filter((c) => c.renewal === 'expired').length;
    const needsDetail = live.filter((c) => c.needsDetail).length;
    return {
      key: 'contracts',
      title: o.source === 'rental_copy' ? '계약 (사본 기준)' : '계약',
      icon: '📑',
      href,
      metrics: [
        { label: '30일 안 갱신·만료', value: due, tone: due ? 'warn' : 'good' },
        { label: '날짜 지남', value: expired, tone: expired ? 'warn' : 'good' },
        { label: '상세 미입력', value: needsDetail },
      ],
      alert: expired ? `날짜 지난 계약 ${expired}곳` : due ? `30일 안 갱신·만료 ${due}곳` : null,
      tone: expired || due ? 'warn' : 'good',
    };
  } catch (err) {
    return errorCard('contracts', '계약', '📑', href, errMsg(err));
  }
}

/** IT 재고(구글시트 — 느림) — 바로 출고 가능한 상품화완료가 핵심 */
export async function loadInventoryCard(): Promise<WorkCard> {
  const href = '/';
  if (!isInventorySheetConfigured()) return errorCard('inventory', 'IT 재고', '🖥️', href, '재고 시트 설정이 필요해요.');
  try {
    const items = await listAllAssets();
    const count = (s: string) => items.filter((a) => a.status === s).length;
    const ready = count('상품화완료');
    const prepping = count('상품화준비중');
    const repair = count('수리중');
    const malicious = items.filter((a) => a.malicious).length;
    return {
      key: 'inventory',
      title: 'IT 재고',
      icon: '🖥️',
      href,
      metrics: [
        { label: '상품화완료', value: ready, tone: 'good' },
        { label: '상품화준비중', value: prepping },
        { label: '수리중', value: repair, tone: repair ? 'warn' : undefined },
        { label: '임대중', value: count('임대중') },
      ],
      alert: repair ? `수리중 ${repair}대` : malicious ? `악성 표시 ${malicious}대` : null,
      tone: repair ? 'warn' : 'good',
    };
  } catch (err) {
    return errorCard('inventory', 'IT 재고', '🖥️', href, errMsg(err));
  }
}

/** 확인서(구글시트 — 느림) — 다가오는 IT 확인서 중 출고 기재(자산번호·S/N) 안 끝난 것 */
export async function loadConfirmCard(today: string): Promise<WorkCard> {
  const href = '/confirm-form?view=legacy';
  try {
    const res = await listConfirmDocs();
    if (!res.ok) return errorCard('confirm', '확인서 출고 기재', '📄', href, res.error);
    const target = nextBusinessDay(today);
    const upcoming = res.items.filter((i) => i.isIt && i.deliveryDate && i.deliveryDate >= today);
    const unfilled = upcoming.filter((i) => i.total > 0 && i.filled < i.total);
    const urgent = unfilled.filter((i) => i.deliveryDate <= target);
    return {
      key: 'confirm',
      title: '확인서 출고 기재',
      icon: '📄',
      href,
      metrics: [
        { label: '다가오는 IT 확인서', value: upcoming.length },
        { label: '미기재', value: unfilled.length, tone: unfilled.length ? 'warn' : 'good' },
        { label: `${shortDateLabel(target)}까지`, value: urgent.length, tone: urgent.length ? 'bad' : undefined },
      ],
      alert: urgent.length
        ? `${shortDateLabel(target)}까지 납품인데 출고 기재 안 된 확인서 ${urgent.length}건`
        : unfilled.length
          ? `출고 기재 남은 확인서 ${unfilled.length}건`
          : null,
      tone: urgent.length ? 'bad' : unfilled.length ? 'warn' : 'good',
    };
  } catch (err) {
    return errorCard('confirm', '확인서 출고 기재', '📄', href, errMsg(err));
  }
}

/** 영업 확인서 가져오기 상태(⑤) — 표가 없거나 못 읽으면 null. 홈이 "10분 넘었나" 판단에도 씀 */
export async function loadSalesImportState(): Promise<SalesImportState | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await createAdminClient().from(SALES_IMPORT_STATE_TABLE).select('*').eq('id', 'main').maybeSingle();
    if (error) return null;
    return importStateFromRow(data as SalesImportStateRow | null);
  } catch {
    return null;
  }
}

/**
 * 영업 확인서 — 새로 들어온 것 · 오늘·다음 영업일 납품인데 준비 안 끝난 것 · 영업에서 수정된 것(개인정보 없이 건수만).
 * 범위: 최근 30일에 받았거나 납품일이 일주일 전 이후인 건 중 끝나지 않은(출고·취소 아님) 건.
 */
export async function loadSalesConfirmCard(today: string): Promise<WorkCard> {
  const href = '/confirm-form';
  const title = '영업 확인서';
  const icon = '📋';
  if (!isSupabaseConfigured()) return errorCard('salesConfirm', title, icon, href, 'Supabase 설정이 필요해요.');
  try {
    const supabase = createAdminClient();
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const weekAgo = fmtYmd(new Date(parseYmd(today).getTime() - 7 * 24 * 3600_000));
    const confirmsAll = await readAllPages<{
      id: string;
      ver: number | null;
      payload_hash: string | null;
      delivery_date: string | null;
      sales_state: string | null;
      type: string | null;
    }>((from, to) =>
      supabase
        .from(SALES_CONFIRMS_TABLE)
        .select('id,ver,payload_hash,delivery_date,sales_state,type')
        .or(`first_seen_at.gte.${since},delivery_date.gte.${weekAgo}`)
        .order('id')
        .range(from, to),
    );
    // 숫자에서 뺌: 따로 보는 종류(판매·철수·이전)와 영업에서 지운 건
    const confirms = confirmsAll.filter((c) => !isOtherSalesType(c.type) && c.sales_state !== SALES_STATE_DELETED);
    // 영업에서 지웠는데 IT가 손댄 건 — 범위(최근 30일)와 상관없이 전부(옛 건도 놓치지 않게)
    const deletedRows = await readAllPages<{ id: string; type: string | null }>((from, to) =>
      supabase.from(SALES_CONFIRMS_TABLE).select('id,type').eq('sales_state', SALES_STATE_DELETED).order('id').range(from, to),
    );
    const deletedIds = deletedRows.filter((c) => !isOtherSalesType(c.type)).map((c) => c.id);
    let deletedBusy = 0;
    for (let i = 0; i < deletedIds.length; i += 200) {
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .select('confirm_id,status')
        .in('confirm_id', deletedIds.slice(i, i + 200));
      if (error) throw error;
      for (const w of (data ?? []) as { confirm_id: string; status: string | null }[]) {
        if (w.status === '준비중' || w.status === '준비완료' || w.status === '보류') deletedBusy++;
      }
    }
    type W = { confirm_id: string; status: string | null; first_opened_at: string | null; seen_ver: number | null; seen_hash: string | null };
    const work = new Map<string, W>();
    for (let i = 0; i < confirms.length; i += 200) {
      const ids = confirms.slice(i, i + 200).map((c) => c.id);
      const { data, error } = await supabase
        .from(SALES_CONFIRM_WORK_TABLE)
        .select('confirm_id,status,first_opened_at,seen_ver,seen_hash')
        .in('confirm_id', ids);
      if (error) throw error;
      for (const w of (data ?? []) as W[]) work.set(w.confirm_id, w);
    }
    const target = nextBusinessDay(today);
    let isNew = 0;
    let urgent = 0;
    let changed = 0;
    const urgentIds: string[] = [];
    for (const c of confirms) {
      const w = work.get(c.id);
      const status = w?.status || '접수';
      if (status === '출고' || status === '취소') continue;
      if (!w || !w.first_opened_at) isNew++;
      if (c.delivery_date && c.delivery_date >= today && c.delivery_date <= target && (status === '접수' || status === '준비중')) urgentIds.push(c.id);
      const ver = c.ver ?? 0;
      if (w && salesChangedSince(w.seen_ver, ver)) changed++;
    }
    // 직송(매입처 → 고객사, 우리가 준비 안 함)은 "준비 안 끝남"에서 뺌(4-0 F29). 칸을 못 읽으면 빼지 않고 센다(로그에 code).
    if (urgentIds.length) {
      const modes = await readDeliveryModes(supabase, urgentIds);
      urgent = urgentIds.filter((id) => !modes.map.get(id)?.directShip).length;
    }
    return {
      key: 'salesConfirm',
      title,
      icon,
      href,
      metrics: [
        ...(deletedBusy ? [{ label: '영업에서 지웠는데 준비 중', value: deletedBusy, tone: 'bad' as const }] : []),
        { label: '새로 들어옴', value: isNew, tone: isNew ? 'warn' : 'good' },
        { label: `${shortDateLabel(target)}까지 준비 안 끝남`, value: urgent, tone: urgent ? 'bad' : 'good' },
        { label: '영업에서 수정됨', value: changed, tone: changed ? 'warn' : 'good' },
      ],
      alert: deletedBusy
        ? `영업에서 지웠는데 IT가 준비 중인 확인서 ${deletedBusy}건 — 확인 필요`
        : urgent
        ? `${shortDateLabel(target)}까지 납품인데 준비 안 끝난 영업 확인서 ${urgent}건`
        : changed
          ? `영업에서 수정된 확인서 ${changed}건 — 바뀐 내용 확인`
          : isNew
            ? `새로 들어온 영업 확인서 ${isNew}건`
            : null,
      tone: deletedBusy || urgent ? 'bad' : isNew || changed ? 'warn' : 'good',
    };
  } catch (err) {
    const e = err as { code?: string; message?: string } | null;
    if (e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|could not find the table/i.test(e?.message ?? '')) {
      return errorCard('salesConfirm', title, icon, href, '영업 확인서 표를 아직 안 만들었어요 — supabase/sales_confirms_schema.sql 먼저 실행');
    }
    return errorCard('salesConfirm', title, icon, href, '영업 확인서를 읽지 못했어요');
  }
}

// ---------- 운영·시스템 상태 ----------

export type StatusTile = { key: string; label: string; value: string; detail?: string; tone: Tone };

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T | null; error: string | null }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value, error: null };
  } catch (err) {
    return { ms: Date.now() - t0, value: null, error: errMsg(err) };
  }
}

const speedTone = (ms: number, slow: number): Tone => (ms <= slow ? 'good' : ms <= slow * 3 ? 'warn' : 'bad');

/** 응답 시간은 지금 이 화면을 만들면서 실제로 한 번 재 본 값 */
export async function loadSystemStatus(): Promise<StatusTile[]> {
  const supabase = isSupabaseConfigured() ? createAdminClient() : null;
  const messengerUrl = process.env.MESSENGER_SUPABASE_URL || 'https://kkdiihazgzesbqxjytqv.supabase.co';
  const messengerKey = process.env.MESSENGER_SUPABASE_ANON_KEY || '';

  const [db, sheet, naver, outbox, report, salesImport] = await Promise.all([
    timed(async () => {
      if (!supabase) throw new Error('설정 없음');
      const { error } = await supabase.from('it_prep_people').select('name').limit(1);
      if (error) throw error;
    }),
    timed(async () => {
      const id = process.env.GOOGLE_INVENTORY_SHEET_ID;
      if (!id) throw new Error('설정 없음');
      await getSheetsClient().spreadsheets.get({ spreadsheetId: id, fields: 'properties.title' });
    }),
    timed(async () => {
      if (!supabase) throw new Error('설정 없음');
      const { data, error } = await supabase
        .from(CALENDAR_TABLE)
        .select('naver_synced_at')
        .not('naver_synced_at', 'is', null)
        .order('naver_synced_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as { naver_synced_at: string } | undefined)?.naver_synced_at ?? null;
    }),
    timed(async () => {
      // 카톡봇은 보내고 나서 줄을 지우므로 남아 있는 줄 = 아직 안 나간 메시지
      if (!messengerKey) throw new Error('설정 없음');
      const res = await fetch(`${messengerUrl}/rest/v1/outbox?select=id`, {
        headers: { apikey: messengerKey, Authorization: `Bearer ${messengerKey}`, Prefer: 'count=exact', Range: '0-0' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = res.headers.get('content-range')?.split('/')[1];
      return total && total !== '*' ? Number(total) : null;
    }),
    timed(async () => {
      if (!supabase) throw new Error('설정 없음');
      const { data, error } = await supabase
        .from('it_prep_reports')
        .select('sent_at')
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as { sent_at: string } | undefined)?.sent_at ?? null;
    }),
    loadSalesImportState(),
  ]);
  const si: SalesImportState | null = salesImport;
  const siOk = si?.lastSuccessAt ? new Date(si.lastSuccessAt).getTime() : null;
  const siStale = siOk === null || Date.now() - siOk > 30 * 60_000;
  const siTile: StatusTile = !process.env.SALES_EXPORT_KEY
    ? { key: 'salesImport', label: '영업 확인서 가져오기', value: '키 없음', detail: '영업 웹앱 연결 키가 아직 없어요', tone: 'muted' }
    : !si
      ? { key: 'salesImport', label: '영업 확인서 가져오기', value: '확인 불가', detail: '상태 표를 못 읽었어요(SQL 실행 전일 수 있어요)', tone: 'muted' }
      : {
          key: 'salesImport',
          label: '영업 확인서 가져오기',
          value: si.lastSuccessAt ? relativeTime(si.lastSuccessAt) : '기록 없음',
          detail: si.lastErrorCode ? si.lastError || '마지막 시도에 오류가 있었어요' : '홈·확인서 화면을 열 때 자동으로 가져와요',
          tone: si.lastErrorCode && siStale ? 'warn' : si.lastErrorCode || !si.lastSuccessAt ? 'muted' : 'good',
        };

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const commitMsg = process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0];
  const region = process.env.VERCEL_REGION;
  const naverAt = naver.value as string | null;
  const naverAgeH = naverAt ? (Date.now() - new Date(naverAt).getTime()) / 3600_000 : Infinity;
  const pending = outbox.value as number | null;

  return [
    {
      key: 'db',
      label: '데이터베이스(Supabase)',
      value: db.error ? '응답 없음' : `응답 ${db.ms}ms`,
      detail: db.error ?? '서울 리전',
      tone: db.error ? 'bad' : speedTone(db.ms, 300),
    },
    {
      key: 'sheet',
      label: '구글시트',
      value: sheet.error ? '응답 없음' : `응답 ${sheet.ms}ms`,
      detail: sheet.error ?? 'IT재고·확인서·소모품 시트',
      tone: sheet.error ? 'bad' : speedTone(sheet.ms, 700),
    },
    {
      key: 'naver',
      label: '네이버 캘린더 반영',
      value: naver.error ? '확인 불가' : naverAt ? relativeTime(naverAt) : '기록 없음',
      detail: naver.error ?? '캘린더·출고 준비 화면을 열 때 + 매일 06:00 자동 점검',
      tone: naver.error ? 'bad' : naverAgeH <= 26 ? 'good' : 'warn',
    },
    {
      key: 'kakao',
      label: '카톡 발송 대기',
      value: outbox.error ? '확인 불가' : pending === null ? '-' : `${pending}건`,
      detail: outbox.error ? `메신저 큐를 못 읽었어요 (${outbox.error})` : pending ? '카톡봇이 아직 안 가져감 — 몇 분 넘게 그대로면 봇 확인' : '밀린 메시지 없음',
      tone: outbox.error ? 'muted' : pending ? 'warn' : 'good',
    },
    siTile,
    {
      key: 'report',
      label: '마지막 완료 보고',
      value: report.error ? '확인 불가' : relativeTime(report.value as string | null),
      detail: report.error ?? '출고 준비 → 완료 카톡 발송 기준',
      tone: report.error ? 'muted' : 'good',
    },
    {
      key: 'deploy',
      label: '배포 버전',
      value: sha ?? '로컬',
      detail: sha ? `${commitMsg ? `${commitMsg.slice(0, 40)}${commitMsg.length > 40 ? '…' : ''} · ` : ''}서버 ${region ?? 'icn1'}` : '개발 PC에서 실행 중',
      tone: 'muted',
    },
  ];
}
