'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { markSalesConfirmPrinted } from '@/app/confirm-form/salesDetailActions';
import { getSalesPrintKeys } from '@/app/confirm-form/salesLicenseActions';
import { isOtherSalesType } from '@/lib/salesConfirms/types';
import type {
  ConfirmLicenseState,
  SalesConfirmDetailData,
  SalesFillPlan,
  SalesFormHtmlResult,
  SalesFormMarks,
  SalesImportRouteResult,
  SalesImportTrigger,
  SalesPrintBuild,
  SalesPrintMode,
  SalesPrintNote,
  SalesRenderer,
} from '@/lib/salesConfirms/types';
import { fmtDateTime } from './format';

/*
 * 출력 창(설계 docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-H·E1·E4~E8·E14~E22).
 *
 * 열 때: ⓐ 영업에서 이 확인서 한 건 다시 받기(최대 3초 기다림 — 안 되면 받아 둔 판으로) → 바뀌었으면 부모가 상세를 다시 읽음
 *        ⓑ 채우기 코드(printFill·itFill — 영업 양식 사본 14개를 끌어옴)는 여기서 처음 불러옴(await import — 상세 첫 화면 JS 가 안 커지게, E21)
 *        ⓒ 중계 라우트(POST /api/sales-confirms/form-html)로 그 순간 영업 양식 HTML 을 JSON 으로 받음
 * 그리기: buildFillPlan(어느 표시 칸에 무슨 값) → 영업 HTML(표시 data-it-spec="1"·종류·판이 맞을 때) 또는 받아 둔 사본(renderCopy, 표시 붙임)을
 *        DOMParser(스크립트가 안 도는 빈 문서)로 읽어 applyFillPlan(textContent 로만) → serializeFilled → iframe srcDoc.
 *        영업 HTML 을 우리 화면 DOM 에 직접 넣지 않음(dangerouslySetInnerHTML 금지) — 오직 sandbox iframe 안.
 * 옵션(2면·키·모드)을 바꿀 땐 받아 둔 HTML 로 다시 그림(영업을 다시 부르지 않음).
 *
 * 미리보기(iframe) 신호 — 이름은 itFill 의 SALES_PRINT_MSG_*(printFill 도 같은 값을 다시 내보냄, 우리 스크립트 FILL_JS 도 같은 값). iframe 은 같은 출처 권한이 없어 postMessage 로만:
 *   부모 → iframe : { source, type: PRINT }                    → window.print()
 *   iframe → 부모 : { source, type: OVERFLOW, pages: number[] } → 넘친 장(알림만 — 다시 그리지 않음)
 *   iframe → 부모 : { source, type: SIZE, height: number }      → 문서 전체 높이(px)
 */

/**
 * 미리보기 iframe 권한 — 스크립트(영업 양식 줄이기·우리 인쇄 신호)와 인쇄 창만.
 * "같은 출처 허용" 값은 절대 넣지 말 것: 넣으면 영업 HTML 안 스크립트가 앱의 쿠키·서버 액션에 손댈 수 있음.
 */
const FRAME_SANDBOX = 'allow-scripts allow-modals';
/** 2면(출고·설치) 포함 — 브라우저에 기억(기본 끔, E18) */
const BACK_KEY = 'firstoa-it.sales-print-with-back';
/** A4 = 210×297mm = 794×1123px(96dpi) */
const PAGE_W = 794;
const PAGE_H = 1123;
/** 출력 창을 열 때 한 건 받기를 기다리는 최대 시간(E1) */
const PRINT_SYNC_WAIT_MS = 3000;
/** 우리 쪽 한 건 받기 간격 막기(⑤ 'one' 3초) — 판이 달라 한 번 더 받을 때 이만큼 띄움 */
const ONE_GAP_MS = 3200;

type PrintFillMod = typeof import('@/lib/salesConfirms/printFill');
type ItFillMod = typeof import('@/lib/salesConfirms/salesForm/itFill');
interface Mods {
  pf: PrintFillMod;
  it: ItFillMod;
}

// ───────────────────────── 영업 한 건 받기(상세 화면도 같이 씀) ─────────────────────────

export type SalesOneSyncResult =
  /** 받음 — changed 는 ① 에 새로 쓰거나 바꾼 건수(0|1), notFound = 영업이 이 확인서를 못 찾음(아무것도 안 씀) */
  | { kind: 'ok'; changed: number; notFound: boolean }
  /** 방금(3초 안) 누가 받아서 이번엔 건너뜀 — 오류 아님 */
  | { kind: 'skipped' }
  | { kind: 'fail'; error: string; timedOut: boolean };

/**
 * POST /api/sales-confirms/import { id, trigger } — 이 확인서 한 건만 영업에서 다시 받음(원문은 응답에 없음).
 * 영업 export 는 직접 부르지 않음(키가 서버에만 있음). timeoutMs 가 지나면 기다림만 멈춤(서버는 마저 끝낼 수 있음).
 */
export async function syncSalesConfirmOne(
  id: string,
  trigger: Extract<SalesImportTrigger, 'detail' | 'print'>,
  timeoutMs: number,
): Promise<SalesOneSyncResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/sales-confirms/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, trigger }),
      cache: 'no-store',
      signal: ctl.signal,
    });
    let json: SalesImportRouteResult | null = null;
    try {
      json = (await res.json()) as SalesImportRouteResult;
    } catch {
      json = null;
    }
    if (!json || typeof json.ok !== 'boolean') return { kind: 'fail', error: `영업 웹앱에서 받지 못했어요(응답 ${res.status}).`, timedOut: false };
    if (json.skippedRecent) return { kind: 'skipped' };
    if (json.one?.notFound) return { kind: 'ok', changed: 0, notFound: true };
    if (!json.ok || (json.errorCode && json.errorCode !== 'bad_shape')) {
      return { kind: 'fail', error: json.error || '영업 웹앱에서 받지 못했어요.', timedOut: false };
    }
    return { kind: 'ok', changed: Number(json.changed) || 0, notFound: false };
  } catch {
    const timedOut = ctl.signal.aborted;
    return { kind: 'fail', error: timedOut ? '영업 웹앱이 늦게 답해요.' : '인터넷 연결을 확인해 주세요.', timedOut };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── 영업 양식 HTML 받기(중계 — JSON 으로만) ─────────────────────────

type FormHtmlFail = Extract<SalesFormHtmlResult, { ok: false }>;
type FormHtmlReason = FormHtmlFail['reason'];

const FORM_REASON_TEXT: Record<FormHtmlReason, string> = {
  copy_only: '지금은 받아 둔 양식으로만 뽑도록 해 뒀어요',
  busy: '방금 다른 화면이 영업 양식을 받아 가서 잠깐 쉬었어요',
  not_found: '영업 웹앱에서 이 확인서 양식을 못 찾았어요',
  too_big: '영업 양식이 너무 커서 받지 않았어요',
  no_key: '영업 웹앱 연결 키가 설정되지 않았어요',
  unauthorized: '영업 웹앱이 연결 키를 받아 주지 않았어요',
  unreachable: '영업 웹앱에 연결이 안 돼요',
  bad_request: '영업 양식을 받지 못했어요',
  db_error: '영업 양식을 받지 못했어요',
};
const FORM_REASONS = Object.keys(FORM_REASON_TEXT) as FormHtmlReason[];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchFormHtmlOnce(id: string): Promise<SalesFormHtmlResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch('/api/sales-confirms/form-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      cache: 'no-store',
      signal: ctl.signal,
    });
    let j: unknown = null;
    try {
      j = await res.json();
    } catch {
      j = null;
    }
    if (j && typeof j === 'object') {
      const o = j as Record<string, unknown>;
      if (o.ok === true && typeof o.html === 'string') return { ok: true, html: o.html };
      if (o.ok === false) {
        const reason = FORM_REASONS.includes(o.reason as FormHtmlReason) ? (o.reason as FormHtmlReason) : 'unreachable';
        return { ok: false, reason, message: typeof o.message === 'string' ? o.message : '' };
      }
    }
    return { ok: false, reason: 'unreachable', message: `영업 양식을 받지 못했어요(응답 ${res.status})` };
  } catch {
    return { ok: false, reason: 'unreachable', message: ctl.signal.aborted ? '영업 웹앱이 늦게 답해요' : '' };
  } finally {
    clearTimeout(timer);
  }
}

/** 'busy'(2초 간격)면 한 번만 잠깐 뒤 다시 */
async function fetchFormHtml(id: string): Promise<SalesFormHtmlResult> {
  const first = await fetchFormHtmlOnce(id);
  if (first.ok || first.reason !== 'busy') return first;
  await wait(2100);
  return fetchFormHtmlOnce(id);
}

function formFailText(r: FormHtmlFail): string {
  return (r.message || FORM_REASON_TEXT[r.reason] || '영업 양식을 받지 못했어요').replace(/[.。]\s*$/, '');
}

// ───────────────────────── 그리기(순수에 가깝게 — 화면 상태 없이) ─────────────────────────

interface Acquired {
  /** 중계로 받은 영업 양식 HTML(글자 그대로) — 못 받았으면 null */
  liveHtml: string | null;
  /** 그 HTML 의 <body> 표시(없으면 spec null) */
  marks: SalesFormMarks | null;
  /** liveHtml 이 없을 때 쉬운 말 이유 */
  liveFail: string;
  /** 열 때 한 건 받기 결과 알림 */
  syncNote: SalesPrintNote | null;
}

type LiveChoice = 'ask' | 'live' | 'copy';

const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

/**
 * 영업 실시간 양식에 IT 값을 넣어도 되는지 — 안 되면 쉬운 말 이유(E7). 표시 검사는 itFill.checkFormMarks 한 곳.
 * 2면(출고·설치)은 영업 html=1 에 없음(영업 기본 = 2면 안 냄) → 켰으면 받아 둔 양식으로.
 */
function liveProblem(it: ItFillMod, marks: SalesFormMarks | null, renderer: SalesRenderer, id: string, ver: number, withBack: boolean): string {
  if (!marks) return '영업 양식의 IT 칸 표시를 읽지 못했어요';
  const why = it.checkFormMarks(marks, { renderer, id, ver });
  if (why) return why.reason;
  if (withBack) return '2면(출고·설치)은 받아 둔 양식에만 있어요';
  return '';
}

interface BuildArgs {
  mods: Mods;
  acq: Acquired;
  detail: SalesConfirmDetailData;
  mode: SalesPrintMode;
  withBack: boolean;
  keys: 'shown' | 'blank';
  licenseKeys: Record<string, string>;
  nowIso: string;
  actor: string;
  origin: string;
  liveChoice: LiveChoice;
  choiceMissing: number;
}

function buildPrint(a: BuildArgs): SalesPrintBuild {
  const { pf, it } = a.mods;
  const c = a.detail.confirm;
  const formDoc = c.formDoc ?? null;
  const plan = pf.buildFillPlan({
    detail: a.detail,
    licenseKeys: a.keys === 'shown' ? a.licenseKeys : {},
    // 2면은 납품 'IT 기재 넣음'에서만(영업 원본엔 2면이 없음)
    options: { withBack: a.mode === 'fill' && a.withBack && c.renderer === 'confirm', keys: a.keys, mode: a.mode },
    nowIso: a.nowIso,
    actor: a.actor,
  });

  // ── 영업 원본 그대로(E22): IT 값 없이. 우리 스크립트(인쇄·높이 신호)만 붙이려고 빈 채움 목록으로 한 번 지나감 ──
  if (a.mode === 'original') {
    const empty: SalesFillPlan = { ...plan, cells: {}, back: null, stamp: '', svcSheet: null, regionFill: null, notes: [], blocked: null };
    const renderer = c.renderer ?? a.acq.marks?.form ?? null;
    if (a.acq.liveHtml) {
      const doc = parseHtml(a.acq.liveHtml);
      it.applyFillPlan(doc, empty, renderer ?? 'confirm');
      return { html: it.serializeFilled(doc), source: 'live', sourceReason: '', missing: [], notes: [], blocked: null };
    }
    if (!formDoc || !renderer) {
      return { html: '', source: 'copy', sourceReason: a.acq.liveFail, missing: [], notes: [], blocked: plan.blocked ?? pf.SALES_PRINT_BLOCKED_OLD };
    }
    const doc = parseHtml(pf.renderCopy(formDoc, renderer, a.origin, false, false, null));
    it.applyFillPlan(doc, empty, renderer);
    return { html: it.serializeFilled(doc), source: 'copy', sourceReason: a.acq.liveFail, missing: [], notes: [], blocked: null };
  }

  // ── IT 기재 넣음 ──
  if (plan.blocked) return { html: '', source: 'copy', sourceReason: '', missing: [], notes: plan.notes, blocked: plan.blocked };
  const renderer = c.renderer ?? null;
  if (!renderer || !formDoc) return { html: '', source: 'copy', sourceReason: '', missing: [], notes: plan.notes, blocked: pf.SALES_PRINT_BLOCKED_OLD };
  const withBack = a.withBack && renderer === 'confirm';

  let reason = a.acq.liveHtml ? liveProblem(it, a.acq.marks, renderer, c.id, c.ver, withBack) : a.acq.liveFail;
  if (a.acq.liveHtml && !reason) {
    if (a.liveChoice !== 'copy') {
      const doc = parseHtml(a.acq.liveHtml);
      const r = it.applyFillPlan(doc, plan, renderer);
      const notes = [...plan.notes];
      if (r.missing.length > 0 && a.liveChoice === 'live') {
        notes.push({ tone: 'warn', text: `영업 양식에서 못 찾은 IT 칸 ${r.missing.length}개는 종이에 안 나가요.` });
      }
      return { html: it.serializeFilled(doc), source: 'live', sourceReason: '', missing: r.missing, notes, blocked: null };
    }
    reason = `영업 양식에서 IT 칸 ${a.choiceMissing}개를 못 찾았어요`;
  }

  const doc = parseHtml(pf.renderCopy(formDoc, renderer, a.origin, withBack, true, plan.regionFill));
  const r = it.applyFillPlan(doc, plan, renderer);
  const notes = [...plan.notes];
  if (r.missing.length > 0) {
    notes.push({ tone: 'warn', text: `받아 둔 양식에 IT 칸 ${r.missing.length}개를 넣지 못했어요 — 종이에 안 나가요. 개발 담당에게 알려 주세요.` });
  }
  return { html: it.serializeFilled(doc), source: 'copy', sourceReason: reason, missing: r.missing, notes, blocked: null };
}

/** 따로 보는 종류(철수·이전·판매)가 영업 실시간 HTML 을 못 받았을 때 — 받아 둔 사본이 없어 대신 그릴 수 없음 */
const OTHER_NO_LIVE = '영업 웹앱에 연결이 안 돼 원본을 못 보여 줘요(이 종류는 받아 둔 양식이 없어요) — 잠시 뒤 다시 열어 주세요.';

/**
 * 따로 보는 종류 — 영업 원본(실시간 HTML)만. buildFillPlan·renderCopy 를 부르지 않음(renderer null, 우리 사본 없음).
 * applyFillPlan 은 빈 채움 목록으로 한 번 — 값은 안 넣고 우리 인쇄·높이 신호 스크립트만 붙임(빈 목록이면 renderer 는 안 씀).
 */
function buildOtherPrint(it: ItFillMod, acq: Acquired): SalesPrintBuild {
  if (!acq.liveHtml) {
    const why = acq.liveFail ? ` (${acq.liveFail})` : '';
    return { html: '', source: 'live', sourceReason: '', missing: [], notes: [], blocked: `${OTHER_NO_LIVE}${why}` };
  }
  const empty: SalesFillPlan = { cells: {}, back: null, stamp: '', svcSheet: null, regionFill: null, notes: [], blocked: null };
  const doc = parseHtml(acq.liveHtml);
  it.applyFillPlan(doc, empty, 'confirm');
  return { html: it.serializeFilled(doc), source: 'live', sourceReason: '', missing: [], notes: [], blocked: null };
}

function readWithBack(): boolean {
  try {
    return localStorage.getItem(BACK_KEY) === '1';
  } catch {
    return false;
  }
}

// ───────────────────────── 화면 ─────────────────────────

interface Props {
  detail: SalesConfirmDetailData;
  /** 처음 모드 — 'fill' = 🖨 확인서 출력, 'original' = 영업 원본 보기 */
  initialMode: SalesPrintMode;
  /** 라이선스 상태(없으면 못 읽음) — 키가 몇 개 있는지·잠금이 풀렸는지 */
  license: ConfirmLicenseState | null;
  hasSoftware: boolean;
  /** 비밀번호 창을 띄워 풀렸는지 돌려줌(풀리면 부모가 license 도 다시 읽음) */
  onUnlock: () => Promise<boolean>;
  actor: string;
  ensureActor: () => Promise<string | null>;
  onClose: () => void;
  /** 출력 기록을 남김 — 화면의 "출력함" 표시·workUpdatedAt 을 맞추는 데 씀 */
  onPrinted: (info: { workUpdatedAt: string; ver: number; by: string; at: string }) => void;
  onWarn: (msg: string) => void;
  /** 열 때 영업에서 한 건 받아 바뀌었으면 부름 — 부모가 상세를 다시 읽고 새 데이터를 돌려줌(못 읽으면 null) */
  onSalesChanged: () => Promise<SalesConfirmDetailData | null>;
}

type KeyChoice = null | 'shown' | 'blank';

type BuildState = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; b: SalesPrintBuild };

/**
 * 출력 창 — 영업 양식 그대로(가능하면 그 순간 영업 최신 양식) 미리보고 인쇄. 왼쪽: 보기 모드·키 고르기·설정·알림, 오른쪽: 종이.
 * 핸드폰(≤640px)은 인쇄·모드 칩을 숨김(영업 원본 축소 보기만 — 상세의 🖨 버튼은 PC 에서만 보임).
 */
export default function SalesPrintDialog({
  detail,
  initialMode,
  license,
  hasSoftware,
  onUnlock,
  actor,
  ensureActor,
  onClose,
  onPrinted,
  onWarn,
  onSalesChanged,
}: Props) {
  const confirmId = detail.confirm.id;
  /** 따로 보는 종류(철수·이전·판매) — 영업 원본 보기만(모드 칩·2면·키 고르기 없음, 출력 기록 없음) */
  const isOther = isOtherSalesType(detail.confirm.type) || !!detail.confirm.otherRenderer;
  /** 영업에서 지운 확인서 — IT 기재 모드 인쇄는 "알고 뽑아요" 체크 뒤에만(E27) */
  const salesDeleted = detail.confirm.salesDeleted === true;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const onSalesChangedRef = useRef(onSalesChanged);
  onSalesChangedRef.current = onSalesChanged;

  const [mode, setModeState] = useState<SalesPrintMode>(isOther ? 'original' : initialMode);
  const setMode = (m: SalesPrintMode) => setModeState(isOther ? 'original' : m);
  const [deletedAck, setDeletedAck] = useState(false);
  const [withBack, setWithBack] = useState(false);
  const [keyChoice, setKeyChoice] = useState<KeyChoice>(null);
  const [licenseKeys, setLicenseKeys] = useState<Record<string, string>>({});
  const [keysBusy, setKeysBusy] = useState(false);
  const [keysError, setKeysError] = useState('');
  const [mods, setMods] = useState<Mods | null>(null);
  const modsRef = useRef<Mods | null>(null);
  const [modsError, setModsError] = useState(false);
  const [acq, setAcq] = useState<Acquired | null>(null);
  const [liveChoice, setLiveChoice] = useState<LiveChoice>('ask');
  const [choiceMissing, setChoiceMissing] = useState(0);
  const [overflowPages, setOverflowPages] = useState<number[] | null>(null);
  const [docHeight, setDocHeight] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [hint, setHint] = useState('');
  const [scale, setScale] = useState(1);
  const nowIso = useRef(new Date().toISOString()).current;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const renderer = detail.confirm.renderer ?? null;
  const keyCount = license ? license.units.filter((u) => u.hasKey).length : 0;
  const keyUnknown = hasSoftware && license === null;
  const needKeyChoice = mode === 'fill' && hasSoftware && (keyUnknown || keyCount > 0);

  // 2면 기억(브라우저 저장소가 막혀도 이번엔 동작)
  useEffect(() => setWithBack(readWithBack()), []);
  function changeWithBack(v: boolean) {
    setWithBack(v);
    try {
      localStorage.setItem(BACK_KEY, v ? '1' : '0');
    } catch {
      // 기억 못 해도 이번엔 그대로
    }
  }

  // ───── 열 때: 한 건 받기 → 채우기 코드 불러오기 → 영업 양식 HTML ─────
  useEffect(() => {
    let alive = true;
    void (async () => {
      // 채우기 코드는 받기와 같이 불러 둠(못 불러오면 null — 아래에서 "불러오지 못했어요"로 보여 줌)
      const modsP: Promise<Mods | null> = Promise.all([
        import('@/lib/salesConfirms/printFill'),
        import('@/lib/salesConfirms/salesForm/itFill'),
      ]).then(
        ([pf, it]) => ({ pf, it }),
        () => null,
      );

      let syncNote: SalesPrintNote | null = null;
      let ver = detailRef.current.confirm.ver;
      const s1At = Date.now();
      const s1 = await syncSalesConfirmOne(confirmId, 'print', PRINT_SYNC_WAIT_MS);
      if (!alive) return;
      if (s1.kind === 'fail') {
        syncNote = { tone: 'warn', text: '영업 웹앱에 연결이 안 돼 마지막으로 받은 판으로 그렸어요.' };
      } else if (s1.kind === 'ok' && s1.notFound) {
        syncNote = { tone: 'warn', text: '영업 웹앱에서 이 확인서를 못 찾아(종류가 바뀌었을 수 있어요) 마지막으로 받은 판으로 그렸어요.' };
      } else if (s1.kind === 'ok' && s1.changed > 0) {
        const fresh = await onSalesChangedRef.current();
        if (!alive) return;
        if (fresh) {
          ver = fresh.confirm.ver;
          syncNote = { tone: 'info', text: `영업이 방금 고친 내용(v${ver})을 받아 그렸어요.` };
        } else {
          syncNote = { tone: 'warn', text: '영업이 고친 내용을 받았지만 화면을 다시 읽지 못해 이전 판으로 그렸어요 — 창을 닫고 다시 열어 주세요.' };
        }
      }

      const m = await modsP;
      if (!alive) return;
      if (!m) {
        setModsError(true);
        return;
      }
      modsRef.current = m;
      setMods(m);

      const fh = await fetchFormHtml(confirmId);
      if (!alive) return;
      if (!fh.ok) {
        setAcq({ liveHtml: null, marks: null, liveFail: formFailText(fh), syncNote });
        return;
      }
      let marks: SalesFormMarks | null = null;
      try {
        marks = m.it.readFormMarks(parseHtml(fh.html));
      } catch {
        marks = null;
      }
      // 영업 양식은 표시가 있는데 판이 우리와 다름 → 한 건 받기 한 번 더(그래도 다르면 그릴 때 받아 둔 양식으로)
      if (marks && marks.spec === m.it.IT_MARK_SPEC && marks.ver !== null && marks.ver !== ver) {
        const gap = ONE_GAP_MS - (Date.now() - s1At);
        if (gap > 0) await wait(gap);
        if (!alive) return;
        const s2 = await syncSalesConfirmOne(confirmId, 'print', PRINT_SYNC_WAIT_MS);
        if (!alive) return;
        if (s2.kind === 'ok' && s2.changed > 0) {
          const fresh = await onSalesChangedRef.current();
          if (!alive) return;
          if (fresh) syncNote = { tone: 'info', text: `영업이 방금 고친 내용(v${fresh.confirm.ver})을 받아 그렸어요.` };
        }
      }
      setAcq({ liveHtml: fh.html, marks, liveFail: '', syncNote });
    })();
    return () => {
      alive = false;
    };
    // 열 때 한 번만(옵션을 바꿔도 영업을 다시 부르지 않음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───── 라이선스 키(D30) — 잠금이 풀려 있어야 읽힘, 읽으면 계약관리 기록에 view_bulk(서버). 값은 이 창 메모리에만 ─────
  const loadKeys = useCallback(async (): Promise<boolean> => {
    setKeysBusy(true);
    setKeysError('');
    try {
      const res = await getSalesPrintKeys({ confirmId });
      if (res.ok) {
        setLicenseKeys(res.data);
        setKeyChoice('shown');
        return true;
      }
      if ('needUnlock' in res) setKeysError('잠금이 풀려 있지 않아요. 비밀번호를 넣어 주세요.');
      else setKeysError(res.error || '키를 읽지 못했어요.');
      return false;
    } catch {
      setKeysError('키를 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
      return false;
    } finally {
      setKeysBusy(false);
    }
  }, [confirmId]);

  // IT 기재 모드가 되면(열 때 또는 칩으로) 이미 풀려 있을 때 바로 키까지 — 한 번만
  const autoKeysRef = useRef(false);
  useEffect(() => {
    if (autoKeysRef.current || !needKeyChoice || keyChoice !== null || !license?.unlocked) return;
    autoKeysRef.current = true;
    void loadKeys();
  }, [needKeyChoice, keyChoice, license, loadKeys]);

  async function unlockAndLoad() {
    const ok = await onUnlock();
    if (ok) await loadKeys();
  }

  // ───── 그리기 ─────
  const built = useMemo((): BuildState => {
    if (modsError) return { state: 'error', error: '출력 화면을 불러오지 못했어요. 새로고침(F5) 뒤 다시 열어 주세요.' };
    if (!mods || !acq) return { state: 'loading' };
    try {
      if (isOther) return { state: 'ok', b: buildOtherPrint(mods.it, acq) };
      const b = buildPrint({
        mods,
        acq,
        detail,
        mode,
        withBack,
        keys: keyChoice === 'shown' ? 'shown' : 'blank',
        licenseKeys,
        nowIso,
        actor,
        origin: window.location.origin,
        liveChoice,
        choiceMissing,
      });
      return { state: 'ok', b };
    } catch (e) {
      return { state: 'error', error: `출력 화면을 만들지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}` };
    }
  }, [modsError, mods, acq, isOther, detail, mode, withBack, keyChoice, licenseKeys, nowIso, actor, liveChoice, choiceMissing]);

  const b = built.state === 'ok' ? built.b : null;
  const html = b?.html ?? '';

  // 종이가 바뀌면 넘침 알림은 새 종이의 신호를 기다림
  useEffect(() => {
    setOverflowPages(null);
  }, [html]);

  // 미리보기 안(우리 스크립트)이 보내는 신호
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const mm = modsRef.current;
      if (!mm || e.source !== frameRef.current?.contentWindow) return;
      const d: unknown = e.data;
      if (!d || typeof d !== 'object') return;
      const msg = d as Record<string, unknown>;
      if (msg.source !== mm.it.SALES_PRINT_MSG_SOURCE) return;
      const type = String(msg.type ?? '');
      if (type === mm.it.SALES_PRINT_MSG_OVERFLOW) {
        const pages = Array.isArray(msg.pages)
          ? msg.pages.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 1000)
          : [];
        setOverflowPages([...new Set(pages)].sort((x, y) => x - y));
      } else if (type === mm.it.SALES_PRINT_MSG_SIZE) {
        const h = Number(msg.height);
        if (Number.isFinite(h) && h > 200 && h < 40000) setDocHeight(Math.ceil(h));
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 창 폭에 맞춰 종이를 줄임
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.3, Math.min(1, (el.clientWidth - 24) / PAGE_W)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !printing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, printing]);

  const keyGate = needKeyChoice && keyChoice === null;
  const needLiveChoice = mode === 'fill' && !!b && b.source === 'live' && b.missing.length > 0 && liveChoice === 'ask';
  // 지운 확인서 — IT 기재 넣음(출력 기록이 남는 쪽)은 체크해야 인쇄. 원본 모드는 지금처럼
  const deletedGate = mode === 'fill' && salesDeleted && !deletedAck;
  const canPrint = !!b && !b.blocked && !!html && !keyGate && !needLiveChoice && !deletedGate && !keysBusy && !printing;
  const deletedMeta = salesDeleted
    ? [detail.confirm.deletedAt ? fmtDateTime(detail.confirm.deletedAt) : '', (detail.confirm.deletedBy ?? '').trim()]
        .filter((v) => v && v !== '-')
        .join(' · ')
    : '';

  async function print() {
    if (!canPrint || !mods) return;
    if (mode === 'fill' && !actor.trim()) {
      // 꼬리 "IT 기재 … 이름" 에 이름이 들어가게 먼저 묻고 다시 그린 뒤 한 번 더 누르게 함(그리는 중인 종이를 인쇄하지 않게)
      const got = await ensureActor();
      if (got) setHint('이름을 적었어요. 종이 꼬리에 이름이 들어가게 다시 그렸으니 [인쇄]를 한 번 더 눌러 주세요.');
      return;
    }
    setHint('');
    setPrinting(true);
    // 인쇄 창은 미리보기 안 우리 스크립트가 띄움(부모는 신호만)
    frameRef.current?.contentWindow?.postMessage({ source: mods.it.SALES_PRINT_MSG_SOURCE, type: mods.it.SALES_PRINT_MSG_PRINT }, '*');
    if (mode !== 'fill') {
      // 영업 원본 그대로는 출력 기록을 남기지 않음(E22)
      setPrinting(false);
      return;
    }
    const who = actor.trim();
    const ver = detail.confirm.ver;
    try {
      const res = await markSalesConfirmPrinted({ confirmId, ver, actor: who });
      if (res.ok) onPrinted({ workUpdatedAt: res.workUpdatedAt, ver, by: who, at: new Date().toISOString() });
      else onWarn(`인쇄 창은 띄웠지만 "출력함" 기록을 남기지 못했어요 — ${res.error}`);
    } catch (e) {
      onWarn(`인쇄 창은 띄웠지만 "출력함" 기록을 남기지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setPrinting(false);
    }
  }

  // 넘침 알림 문구는 printFill.overflowNote 한 곳(알림만 — 다시 그리지 않음)
  const overflowMsg = mods && overflowPages ? mods.pf.overflowNote(overflowPages) : null;
  const notes: SalesPrintNote[] = [
    ...(acq?.syncNote ? [acq.syncNote] : []),
    ...(b?.notes ?? []),
    ...(overflowMsg ? [overflowMsg] : []),
  ];
  const frameH = docHeight ?? PAGE_H * 3;
  const copyLabel = mods?.pf.SALES_FORM_COPY_LABEL ?? '';

  // 위 한 줄 — 어느 양식으로 그렸는지
  const sourceLine = (() => {
    if (built.state === 'loading') return { cls: 'muted', text: '영업 웹앱에서 최신 내용·양식을 받는 중…' };
    if (!b || b.blocked || !html) return null;
    if (b.source === 'live') {
      return { cls: 'good', text: mode === 'original' ? '영업 최신 양식 그대로예요(IT 값 없음).' : '영업 최신 양식으로 그렸어요.' };
    }
    const label = copyLabel ? `받아 둔 양식(${copyLabel})` : '받아 둔 양식';
    return { cls: 'muted', text: `${label}으로 그렸어요${b.sourceReason ? ` — ${b.sourceReason}` : ''}.` };
  })();

  return (
    <div className="modal-overlay open sc-print-overlay">
      <div className="sc-print" role="dialog" aria-modal="true" aria-label={mode === 'original' ? '영업 원본 보기' : '확인서 출력'}>
        <div className="sc-print-head">
          <h2>{mode === 'original' ? '📄 영업 원본 보기' : '🖨 확인서 출력'}</h2>
          <span className="sc-muted">
            {isOther
              ? '철수·이전·판매 확인서는 영업 웹앱 원본만 보여 줘요(IT 기재 없음, 출력 기록도 안 남아요).'
              : mode === 'original'
                ? '영업 웹앱이 뽑는 종이 그대로예요. IT 값은 안 들어가고 출력 기록도 안 남아요.'
                : '영업 웹앱 확인서 그대로, IT 칸(출고시 기재)에 우리가 적은 값을 넣어요.'}
          </span>
          <span className="sc-print-head-btns">
            <span className="sc-phone-only sc-muted sc-print-phone-note">인쇄는 PC에서 해 주세요.</span>
            <button type="button" className="btn btn-ghost" disabled={printing} onClick={onClose}>
              닫기
            </button>
            <button type="button" className="btn btn-primary sc-pc-only" disabled={!canPrint} onClick={() => void print()}>
              {printing ? '인쇄 창 여는 중…' : '인쇄'}
            </button>
          </span>
        </div>
        {sourceLine && (
          <div className={`ct-band ${sourceLine.cls} sc-print-source`} role="status">
            <span>{sourceLine.text}</span>
          </div>
        )}

        <div className="sc-print-body">
          <div className="sc-print-side">
            {salesDeleted && (
              <div className="ct-band bad sc-key-box" role="alert">
                <div>
                  <b>영업에서 이 확인서를 지웠어요</b>
                  {deletedMeta ? `(${deletedMeta})` : ''}
                  <div className="sc-key-box-sub">출고를 멈출지 영업에 먼저 확인하세요.</div>
                  {mode === 'fill' && (
                    <>
                      <label className="toggle sc-del-ack">
                        <input type="checkbox" checked={deletedAck} onChange={(e) => setDeletedAck(e.target.checked)} />
                        영업에서 지운 걸 알고 뽑아요
                      </label>
                      {!deletedAck && <div className="sc-key-box-sub">체크해야 [인쇄]가 켜져요.</div>}
                    </>
                  )}
                </div>
              </div>
            )}
            {!isOther && (
              <div className="sc-print-modes sc-pc-only">
                <div className="sc-sec-title">보기</div>
                <div className="chip-group" role="group" aria-label="보기 모드">
                  <button type="button" className={`chip${mode === 'fill' ? ' active' : ''}`} aria-pressed={mode === 'fill'} onClick={() => setMode('fill')}>
                    IT 기재 넣음
                  </button>
                  <button
                    type="button"
                    className={`chip${mode === 'original' ? ' active' : ''}`}
                    aria-pressed={mode === 'original'}
                    onClick={() => setMode('original')}
                  >
                    영업 원본 그대로
                  </button>
                </div>
              </div>
            )}

            {needLiveChoice && b && (
              <div className="ct-band warn sc-key-box" role="alert">
                <div>
                  <b>영업 최신 양식에서 IT 칸 {b.missing.length}개를 못 찾았어요</b>
                  <div className="sc-key-box-sub">그대로 뽑으면 그 값이 종이에 안 나가요. 받아 둔 양식으로 뽑는 걸 권해요.</div>
                </div>
                <div className="sc-key-box-btns">
                  <button
                    type="button"
                    className="btn btn-primary sc-btn"
                    onClick={() => {
                      setChoiceMissing(b.missing.length);
                      setLiveChoice('copy');
                    }}
                  >
                    받아 둔 양식으로 뽑기 (추천)
                  </button>
                  <button type="button" className="btn btn-ghost sc-btn" onClick={() => setLiveChoice('live')}>
                    그래도 영업 양식으로
                  </button>
                </div>
              </div>
            )}

            {keyGate && (
              <div className="ct-band warn sc-key-box" role="alert">
                <div>
                  <b>{keyUnknown ? '라이선스 키가 있는지 읽지 못했어요' : `라이선스 키 ${keyCount}개가 잠겨 있어요`}</b>
                  <div className="sc-key-box-sub">종이에 키까지 찍을지 골라야 [인쇄]가 켜져요.</div>
                  {keysError && <div className="sc-key-box-err">{keysError}</div>}
                </div>
                <div className="sc-key-box-btns">
                  <button type="button" className="btn btn-primary sc-btn" disabled={keysBusy} onClick={() => void unlockAndLoad()}>
                    {keysBusy ? '읽는 중…' : '🔓 비밀번호 넣고 키까지 찍기'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost sc-btn"
                    disabled={keysBusy}
                    onClick={() => {
                      setKeysError('');
                      setKeyChoice('blank');
                    }}
                  >
                    키 없이 찍기
                  </button>
                </div>
              </div>
            )}
            {needKeyChoice && keyChoice === 'shown' && (
              <div className="ct-band good sc-key-box">
                <span>🔓 라이선스 키까지 찍어요. 키는 이 창을 닫으면 사라지고 어디에도 저장되지 않아요.</span>
                <button type="button" className="btn btn-ghost sc-btn" onClick={() => setKeyChoice('blank')}>
                  키 없이 찍기로 바꾸기
                </button>
              </div>
            )}
            {needKeyChoice && keyChoice === 'blank' && (
              <div className="ct-band muted sc-key-box">
                <span>키 없이 찍어요 — 키 자리는 빈칸으로 나가요.</span>
                {!keysBusy && (
                  <button type="button" className="btn btn-ghost sc-btn" onClick={() => void unlockAndLoad()}>
                    키까지 찍기로 바꾸기
                  </button>
                )}
              </div>
            )}

            {!isOther && renderer === 'confirm' && (
              <div className="sc-print-opts sc-pc-only">
                <div className="sc-sec-title">인쇄 설정</div>
                <label className="toggle">
                  <input type="checkbox" checked={withBack && mode === 'fill'} disabled={mode !== 'fill'} onChange={(e) => changeWithBack(e.target.checked)} />
                  2면(출고·설치) 포함
                </label>
                <span className="sc-muted">
                  {mode === 'fill' ? '영업 종이는 기본으로 2면이 없어요. 필요할 때만 켜 주세요.' : '영업 원본엔 2면이 없어요.'}
                </span>
              </div>
            )}

            {hint && (
              <div className="ct-band muted sc-key-box" role="status">
                <span>{hint}</span>
              </div>
            )}

            {notes.length > 0 && (
              <div className="sc-print-notes">
                <div className="sc-sec-title">출력 전에 볼 것</div>
                <ul>
                  {notes.map((n, i) => (
                    <li key={i} className={n.tone === 'warn' ? 'warn' : 'info'}>
                      {n.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="sc-print-area" ref={areaRef}>
            {built.state === 'loading' ? (
              <div className="empty-state">
                <div>⏳</div>
                <div>영업 웹앱에서 최신 내용·양식을 받는 중…</div>
              </div>
            ) : built.state === 'error' ? (
              <div className="ct-band bad" role="alert">
                <span>{built.error}</span>
              </div>
            ) : b?.blocked ? (
              <div className="ct-band warn" role="status">
                <span>{b.blocked}</span>
              </div>
            ) : !html ? (
              <div className="empty-state">
                <div>📄</div>
                <div>그릴 내용이 없어요.</div>
              </div>
            ) : (
              <div className="sc-print-paper" style={{ width: PAGE_W * scale, height: frameH * scale }}>
                <iframe
                  ref={frameRef}
                  title={mode === 'original' ? '영업 원본 미리보기' : '확인서 미리보기'}
                  className="sc-print-frame"
                  sandbox={FRAME_SANDBOX}
                  srcDoc={html}
                  style={{ width: PAGE_W, height: frameH, transform: `scale(${scale})` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
