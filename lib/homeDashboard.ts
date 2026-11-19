import 'server-only';

/**
 * 홈 대시보드(/home) 데이터 — 각 메뉴의 원본(Supabase·구글시트·네이버 동기화·카톡 큐)에서 숫자만 모아 옴.
 * 구글시트(IT 재고·확인서)는 느려서 따로(Suspense로 나중에 채움), 나머지는 한꺼번에 동시에 읽음.
 * 어느 하나가 실패해도 그 카드만 "못 읽음"으로 표시하고 화면은 뜨게 — 모든 함수가 예외를 안 던짐.
 */
import { listPrepEvents, type PrepEventRow } from '@/app/shipment-prep/actions';
import { listConfirmDocs } from '@/app/confirmForm/sheetActions';
import { getSheetsClient } from '@/lib/googleAuth';
import { isInventorySheetConfigured, listAllAssets } from '@/lib/inventory/sheets';
import { isPrepDone, isPrepInProgress, shortDateLabel } from '@/lib/shipmentPrep';
import {
  BILLING_LINES_TABLE,
  CALENDAR_TABLE,
  RECEIVING_TABLE,
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

/** 다음 영업일(주말 건너뜀) — 출고 준비 화면과 같은 규칙: 오늘 준비하는 건 다음 영업일 출고분 */
export function nextBusinessDay(ymd: string): string {
  const d = parseYmd(ymd);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return fmtYmd(d);
}

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
        alert: remaining
          ? `${shortDateLabel(target)} 출고분 중 준비 안 된 일정 ${remaining}건`
          : unreported
            ? `오늘 출고분 중 완료 보고(카톡) 안 보낸 일정 ${unreported}건`
            : null,
        tone: remaining ? 'bad' : unreported ? 'warn' : 'good',
      },
    };
  } catch (err) {
    return { ...base, card: errorCard('prep', '출고 준비', '✨', '/shipment-prep', errMsg(err)) };
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
    const { data, error } = await supabase
      .from(STOCKTAKE_TABLE)
      .select('location,status,started_at,completed_at')
      .order('started_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    const rows = (data ?? []) as { location: string; status: string; started_at: string; completed_at: string | null }[];
    const open = rows.filter((r) => r.status === '진행중');
    const stale = open.filter((r) => Date.now() - new Date(r.started_at).getTime() > 24 * 3600_000).length;
    const monthDone = rows.filter((r) => r.status === '완료' && (r.completed_at ?? '').slice(0, 7) === today.slice(0, 7)).length;
    const last = rows[0];
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
    const [reviewRes, monthRes] = await Promise.all([
      supabase.from(BILLING_LINES_TABLE).select('id', { count: 'exact', head: true }).eq('allocation_status', 'needs_review'),
      supabase.from(BILLING_LINES_TABLE).select('amount,status').gte('billing_date', monthStart).lte('billing_date', today).limit(5000),
    ]);
    if (monthRes.error) throw monthRes.error;
    const lines = ((monthRes.data ?? []) as { amount: number | string; status: string }[]).filter((l) => l.status !== '취소');
    const sum = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const review = reviewRes.count ?? 0;
    return {
      key: 'billing',
      title: '청구',
      icon: '🧾',
      href,
      metrics: [
        { label: '배분 확인 필요', value: review, tone: review ? 'warn' : 'good' },
        { label: '이번 달 건수', value: lines.length },
        { label: '이번 달 금액', value: `${shortWon(sum)}원` },
      ],
      alert: review ? `자산번호 배분 확인이 필요한 청구 ${review}건` : null,
      tone: review ? 'warn' : 'good',
    };
  } catch (err) {
    return errorCard('billing', '청구', '🧾', href, errMsg(err));
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
  const href = '/confirm-form';
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

  const [db, sheet, naver, outbox, report] = await Promise.all([
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
  ]);

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
