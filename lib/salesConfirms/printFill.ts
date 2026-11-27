/**
 * 영업 확인서 출력 — "어느 IT 칸 표시에 무슨 값"(채움 목록) + 영업 양식 사본 그리기 (순수 — 브라우저·Node 어디서나, DOM·서버 안 부름).
 * 설계 docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-E(E10·E13~E20·E23) — 옛 설계(2026-11-26 D 결정)보다 우선.
 * 옛 buildSalesPrintHtml·P1(회색 줄)·P2(₩0 막기)·P3(납품 출고 명세)·출고 명세 옵션·D22 한도·toConfDoc 은 없앰.
 *
 * buildFillPlan(input) → SalesFillPlan  (값은 전부 그냥 글자 — 넣는 쪽 salesForm/itFill.applyFillPlan 이 textContent 로)
 *   납품(confirm) — 대마다 줄 빈칸 5개(E13): 열쇠 fillKey(표시, 품목 번호 n = 영업 doc.items 순서 + 1, 대 u = 1..)
 *     장비(hasSpec): 제조사·모델명·자산번호·시리얼·출고 사양 / 모니터·기타: 사양 빈칸 / 유지보수: 자산번호·시리얼만 /
 *     소프트웨어: 제조사·제품명·설치 PC(자산번호 칸)·"키 …"(시리얼 칸 — keys 'shown' 일 때만, E16)
 *     요청과 다른 칸만 강조(같음 판정 = specCompare — D27 확인 창과 같은 기준), 출고 사양은 다른 토막만(E14)
 *     E15: 자산번호나 시리얼(소프트웨어는 설치 PC나 키)을 적은 기기의 빈 제조사·모델명 = 영업 요청 값, 빈 출고 사양 = '요청과 같음'
 *   교체(swap) — 교체 후 열(E19): after-sn·after-asset·after-maker·after-model 은 비었으면 IT 값, 다르면 칸 아래 "출고 ○○",
 *     after-hw = 영업 값 + IT가 고친 사양이 있으면 아래 "출고: I5/16GB/512GB". 우리 칸 1개 = 교체 후 1대.
 *   유지보수·소프트웨어(svc) — 영업 종이엔 기기별 칸이 없음 → 'IT 기재 명세' 장(svcSheet, E20). 꼬리 stamp 만 영업 장에.
 *   2면(withBack — 납품만): 출고 준비자 = 처리자, 출고일 = 출고 날짜. 꼬리 stamp = " · IT 기재 MM-DD HH:mm 이름"(세 양식 모두, E18).
 *   원본 모드(options.mode 'original'): cells {} · stamp '' · back·svcSheet·regionFill null(영업 종이 그대로, E22).
 *   formDoc·renderer 가 없으면(b33a4c3 전에 받은 옛 원문) blocked.
 *
 * renderCopy(doc, renderer, origin, withBack, marks, regionFill?) — 받아 둔 사본(영업 b33a4c3)으로 그리기(대신 그리기, E7).
 *   marks=false 면 영업 원본과 글자까지 같음(regionFill 도 안 줄 때) · marks=true 면 영업이 붙일 표시와 같은 표시(§3-H)가 붙음.
 *
 * 라이선스 키(D30): input.licenseKeys 는 출력 창 메모리에만 — 이 파일은 어디에도 저장·기록하지 않음.
 */
import { emptyConf, emptyItem, hasSpec, regionOf, type ConfDoc } from './salesForm/confirm';
import { renderConfirm } from './salesForm/confirmDoc';
import { emptySwap, type SwapDoc } from './salesForm/swap';
import { renderSwap } from './salesForm/swapDoc';
import { emptySvc, type SvcDoc } from './salesForm/svc';
import { renderSvc } from './salesForm/svcDoc';
import { IT_MARK, fillKey, type ItMark } from './salesForm/itFill';
import { sameSpecValue } from './specCompare';
import type {
  DiffField,
  SalesFillCell,
  SalesFillPart,
  SalesFillPlan,
  SalesPrintInput,
  SalesPrintNote,
  SalesRenderer,
  SalesSlot,
  SalesSlotLine,
  SalesSpec,
  SalesSvcSheet,
} from './types';

/** 미리보기 신호 이름(우리 스크립트 — salesForm/itFill.ts 한 곳) */
export {
  SALES_PRINT_MSG_OVERFLOW,
  SALES_PRINT_MSG_PRINT,
  SALES_PRINT_MSG_SIZE,
  SALES_PRINT_MSG_SOURCE,
} from './salesForm/itFill';

/** 출력 창 "받아 둔 양식(○○판)" 글자 — 사본(salesForm/*)을 영업 새 커밋으로 바꾸면 같이 */
export const SALES_FORM_COPY_LABEL = '11-27판';
/** 사본의 영업 커밋(짧게) — 3차 점검 기록(ours)용 */
export const SALES_FORM_COPY_COMMIT = 'b33a4c3';

/**
 * E15 규칙 한 곳 — IT가 출고 칸을 비워 둔 기기 중 자산번호나 시리얼(소프트웨어는 설치 PC나 키)을 적은 기기:
 *   제조사·모델명 = 영업 요청 값, 출고 사양 = 이 글자. 아무것도 안 적은 기기는 빈칸(손으로). 끄려면 FILL_FROM_REQUEST = false.
 */
export const E15_FILL_FROM_REQUEST = true;
export const E15_SAME_SPEC = '요청과 같음';

/** 옛 원문(b33a4c3 전에 받음 — formDoc·renderer 없음)이면 막는 문구 */
export const SALES_PRINT_BLOCKED_OLD = '예전 모양으로 받아 출력 자료가 없어요 — ⋯ → 날짜 골라 다시 가져오기';

/** 출고 사양 한 줄 순서 — 영업 양식 왼쪽 '요청 사양' 줄(confirmDoc itemRows req)과 같은 순서 */
const SPEC_LINE_ORDER = ['인치', 'OS', 'CPU', 'RAM', 'SSD', 'HDD', '그래픽'] as const;

const RENDERER_LABEL: Record<SalesRenderer, string> = { confirm: '납품', swap: '교체', svc: '유지보수·소프트웨어' };

// ───────── 작은 도우미 ─────────

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const tr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** 한국 시각 조각 */
function kst(iso: string | null | undefined): { ymd: string; md: string; hm: string } | null {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return null;
  const s = new Date(ms + 9 * 3600_000).toISOString();
  return { ymd: s.slice(0, 10), md: s.slice(5, 10), hm: s.slice(11, 16) };
}

/** 확인서 종류(type) → 영업 출력 함수 */
function rendererForType(type: string): SalesRenderer | null {
  if (type === '납품') return 'confirm';
  if (type === '교체') return 'swap';
  if (type === '유지보수' || type === '소프트웨어') return 'svc';
  return null;
}

/** 같은 값인지(specCompare 기준 — 둘 다 있을 때만 의미) */
const same = (field: DiffField, a: string, b: string) => sameSpecValue(field, a, b);

const plainCell = (text: string): SalesFillCell | null => (text ? { parts: [{ text, emph: false }], sub: '' } : null);
const subCell = (sub: string): SalesFillCell | null => (sub ? { parts: [], sub } : null);

/** 붙은 보통 글자 토막은 하나로 */
function mergeParts(parts: SalesFillPart[]): SalesFillPart[] {
  const out: SalesFillPart[] = [];
  for (const p of parts) {
    if (!p.text) continue;
    const last = out[out.length - 1];
    if (last && !last.emph && !p.emph) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

const specOf = (s: SalesSpec | null | undefined, k: string): string => tr((s as Json | null | undefined)?.[k]);

/** 품목구분(비면 '기타') — 상세 품목(normalize)과 영업 doc 품목이 같은 줄인지 볼 때 */
const catOf = (v: unknown): string => tr(v) || '기타';

// ───────── 납품: 대마다 줄 5칸 ─────────

interface Ctx {
  keysShown: boolean;
  keys: Record<string, string>;
  /** E15 로 영업 요청 값을 채운 기기 수 */
  e15: number;
}

/** 제조사·모델명 칸 — IT 값(요청과 다르면 강조), 없으면 E15 일 때 요청 값 */
function nameCell(field: 'maker' | 'model', req: string, act: string, e15: boolean, used: { e15: boolean }): SalesFillCell | null {
  if (act) return { parts: [{ text: act, emph: !!req && !same(field, req, act) }], sub: '' };
  if (e15 && E15_FILL_FROM_REQUEST && req) {
    used.e15 = true;
    return plainCell(req);
  }
  return null;
}

/**
 * 출고 사양 칸(장비 + hasSpec) — IT가 고친 토막(요청과 다르거나 요청에 없던 것)이 있으면 요청 순서로 한 줄("윈11/I5/16GB/512GB"),
 * 요청과 다른 토막만 강조. 고친 게 없으면 E15('요청과 같음' — 요청 사양이 있을 때만).
 */
function specCell(item: { spec: SalesSpec }, override: SalesSpec, e15: boolean, used: { e15: boolean }): SalesFillCell | null {
  const tokens: SalesFillPart[] = [];
  let changed = false;
  let anyReq = false;
  for (const k of SPEC_LINE_ORDER) {
    const r = specOf(item.spec, k);
    const o = specOf(override, k);
    if (r) anyReq = true;
    const v = o || r;
    if (!v) continue;
    const differs = !!o && !!r && !same(`spec:${k}` as DiffField, r, o);
    if (o && (!r || differs)) changed = true;
    if (tokens.length) tokens.push({ text: '/', emph: false });
    tokens.push({ text: v, emph: differs });
  }
  if (changed) return { parts: mergeParts(tokens), sub: '' };
  if (e15 && E15_FILL_FROM_REQUEST && anyReq) {
    used.e15 = true;
    return plainCell(E15_SAME_SPEC);
  }
  return null;
}

/** 납품 한 대의 칸들(값 있는 것만) */
function confirmUnitCells(line: SalesSlotLine, slot: SalesSlot, ctx: Ctx): Partial<Record<ItMark, SalesFillCell>> {
  const u = slot.unit;
  if (!u) return {};
  const item = line.item;
  const out: Partial<Record<ItMark, SalesFillCell>> = {};
  const put = (mark: ItMark, cell: SalesFillCell | null) => {
    if (cell) out[mark] = cell;
  };
  const used = { e15: false };
  const asset = tr(u.assetId);
  const serial = tr(u.serial);

  if (line.kind === 'maintenance') {
    put(IT_MARK.asset, plainCell(asset));
    put(IT_MARK.sn, plainCell(serial));
    return out;
  }
  if (line.kind === 'software') {
    const pc = tr(u.extra?.pc);
    const key = ctx.keysShown ? tr(ctx.keys[u.id]) : '';
    const has = !!(pc || key);
    put(IT_MARK.maker, nameCell('maker', tr(item.maker), tr(u.actualMaker), has, used));
    put(IT_MARK.model, nameCell('model', tr(item.model), tr(u.actualModel), has, used));
    put(IT_MARK.asset, plainCell(pc));
    put(IT_MARK.sn, key ? plainCell(`키 ${key}`) : null);
    if (used.e15) ctx.e15 += 1;
    return out;
  }
  // 장비·모니터·기타
  const has = !!(asset || serial);
  put(IT_MARK.maker, nameCell('maker', tr(item.maker), tr(u.actualMaker), has, used));
  put(IT_MARK.model, nameCell('model', tr(item.model), tr(u.actualModel), has, used));
  put(IT_MARK.asset, plainCell(asset));
  put(IT_MARK.sn, plainCell(serial));
  if (line.kind === 'device' && hasSpec(item.cat)) put(IT_MARK.spec, specCell(item, u.specOverride ?? {}, has, used));
  if (used.e15) ctx.e15 += 1;
  return out;
}

// ───────── 교체: 교체 후 열 ─────────

function swapCells(after: Json, slot: SalesSlot | null): Partial<Record<ItMark, SalesFillCell>> {
  const u = slot?.unit ?? null;
  const out: Partial<Record<ItMark, SalesFillCell>> = {};
  if (!u) return out;
  const put = (mark: ItMark, cell: SalesFillCell | null) => {
    if (cell) out[mark] = cell;
  };
  /** 영업 칸이 비었으면 IT 값, 영업 값과 다르면 칸 아래 "출고 ○○" */
  const fillOrSub = (sales: string, it: string): SalesFillCell | null => {
    if (!it) return null;
    if (!sales) return plainCell(it);
    return same('model', sales, it) ? null : subCell(`출고 ${it}`);
  };
  put(IT_MARK.afterSn, fillOrSub(tr(after.sn), tr(u.serial)));
  put(IT_MARK.afterAsset, fillOrSub(tr(after.asset), tr(u.assetId)));
  put(IT_MARK.afterModel, fillOrSub(tr(after.model), tr(u.actualModel)));
  // 제조사·기종 칸 = "제조사 · 기종" — 칸이 통째로 비었을 때만 IT 제조사를 칸에, 아니면(기종만 있거나 제조사가 다름) 아래 줄
  const itMaker = tr(u.actualMaker);
  const sMaker = tr(after.maker);
  if (itMaker) {
    if (!sMaker && !tr(after.kindModel)) put(IT_MARK.afterMaker, plainCell(itMaker));
    else if (!sMaker || !same('maker', sMaker, itMaker)) put(IT_MARK.afterMaker, subCell(`출고 ${itMaker}`));
  }
  // 하드웨어 = 영업 값 그대로 + IT가 고친 사양이 있으면 "출고: …"
  const ov = u.specOverride ?? {};
  const hw = SPEC_LINE_ORDER.map((k) => specOf(ov, k)).filter(Boolean);
  if (hw.length) put(IT_MARK.afterHw, subCell(`출고: ${hw.join('/')}`));
  return out;
}

// ───────── 유지보수·소프트웨어: IT 기재 명세 장 ─────────

function svcSheetOf(
  doc: Json,
  lines: readonly SalesSlotLine[],
  fallback: { company: string; startDate: string; docNo: string; type: string },
  ctx: Ctx,
): SalesSvcSheet {
  const software = doc.kind === '소프트웨어' || (doc.kind !== '유지보수' && fallback.type === '소프트웨어');
  const rows: string[][] = [];
  let seq = 0;
  for (const line of lines) {
    const name = tr(line.item.model) || catOf(line.item.cat);
    const n = line.slots.length;
    for (const s of line.slots) {
      seq += 1;
      const label = n > 1 ? `${name} (${s.unitNo}/${n})` : name;
      const u = s.unit;
      if (software) {
        const key = u && ctx.keysShown ? tr(ctx.keys[u.id]) : '';
        rows.push([String(seq), label, tr(u?.extra?.pc), tr(u?.extra?.user), key]);
      } else {
        rows.push([String(seq), label, tr(u?.assetId), tr(u?.serial)]);
      }
    }
  }
  return {
    title: software ? 'IT 기재 명세 — 소프트웨어 라이선스' : 'IT 기재 명세 — 유지보수 대상 기기',
    company: tr(doc.company) || fallback.company,
    startDate: tr(doc.startDate) || fallback.startDate,
    docNo: tr(doc.no) || fallback.docNo,
    columns: software ? ['순', '제품', '설치 PC', '사용자', '라이선스 키'] : ['순', '품목', '자산번호', 'S/N'],
    rows,
  };
}

// ───────── 본 함수 ─────────

export function buildFillPlan(input: SalesPrintInput): SalesFillPlan {
  const { detail, options } = input;
  const c = detail.confirm;
  const notes: SalesPrintNote[] = [];
  const warn = (text: string) => notes.push({ tone: 'warn', text });
  const info = (text: string) => notes.push({ tone: 'info', text });
  const plan: SalesFillPlan = { cells: {}, back: null, stamp: '', svcSheet: null, regionFill: null, notes, blocked: null };

  const renderer = c.renderer ?? null;
  const doc = isObj(c.formDoc) ? c.formDoc : null;
  if (!renderer || !doc) {
    plan.blocked = SALES_PRINT_BLOCKED_OLD;
    return plan;
  }
  const type = tr(c.type);
  const byType = rendererForType(type);
  if (type && byType !== renderer) {
    warn(`확인서 종류는 '${type}'인데 영업 양식은 ${RENDERER_LABEL[renderer]} 양식이에요 — 영업 양식(${RENDERER_LABEL[renderer]}) 그대로 그려요`);
  }
  if (options.mode === 'original') return plan; // 영업 종이 그대로(E22)

  // ── 지역(사본으로 그릴 때만 — 영업 실시간 HTML 엔 손대지 않음, D21) ──
  if (!tr(doc.region)) {
    const guess = regionOf(tr(doc.address) || c.address) || tr(detail.regionGuess);
    if (guess) {
      plan.regionFill = guess;
      info(`지역 '${guess}'은 영업이 비워 둬서 주소로 추정했어요(추정) — 받아 둔 양식으로 그릴 때만 머리 띠에 넣어요`);
    } else {
      info('지역이 비어 있어 머리 띠 지역 칸이 빈칸으로 나가요');
    }
  }

  // ── 꼬리 " · IT 기재 MM-DD HH:mm 이름"(세 양식 모두) ──
  const now = kst(input.nowIso);
  const actor = tr(input.actor);
  plan.stamp = ` · IT 기재${now ? ` ${now.md} ${now.hm}` : ''}${actor ? ` ${actor}` : ''}`;

  const ctx: Ctx = { keysShown: options.keys === 'shown', keys: input.licenseKeys ?? {}, e15: 0 };
  let missingAsset = 0;
  let recheck = 0;
  let swUnits = 0;
  let swNoKey = 0;
  for (const line of detail.lines) {
    for (const s of line.slots) {
      const u = s.unit;
      if (s.unackedDiffs.length) recheck += 1;
      if (line.kind === 'device' || line.kind === 'monitor') {
        if (!tr(u?.assetId)) missingAsset += 1;
      } else if (line.kind === 'maintenance') {
        if (!tr(u?.assetId) && !tr(u?.serial)) missingAsset += 1;
      } else if (line.kind === 'software') {
        swUnits += 1;
        if (!u || !tr(ctx.keys[u.id])) swNoKey += 1;
      }
    }
  }

  if (renderer === 'confirm') {
    const docItems = Array.isArray(doc.items) ? doc.items : [];
    const isIt = doc.kind !== 'mfp';
    let mismatch = 0;
    let noRow = 0;
    if (!isIt) info('복합기 확인서로 왔어요 — 영업 양식 그대로 나가고 IT 칸은 채우지 않아요');
    else {
      for (const line of detail.lines) {
        const di = docItems[line.itemIndex];
        if (!isObj(di) || catOf(di.cat) !== catOf(line.item.cat)) {
          if (line.slots.some((s) => s.unit)) mismatch += 1;
          continue;
        }
        const n = line.itemIndex + 1; // 영업 양식 td.n 품목 번호(별지까지 이어짐)
        const salesRows = Math.max(1, Math.floor(Number(di.qty) || 1));
        for (const s of line.slots) {
          const cells = confirmUnitCells(line, s, ctx);
          if (!Object.keys(cells).length) continue;
          if (s.unitNo > salesRows) {
            noRow += 1;
            continue;
          }
          for (const [mark, cell] of Object.entries(cells) as [ItMark, SalesFillCell][]) plan.cells[fillKey(mark, n, s.unitNo)] = cell;
        }
      }
    }
    if (mismatch) warn(`영업 양식의 품목 순서와 기기 칸이 맞지 않는 품목 ${mismatch}개는 IT 칸을 비워 둬요 — 상세를 새로 읽은 뒤 다시 열어 주세요`);
    if (noRow) warn(`영업 양식에 줄이 없는 기기 ${noRow}대는 종이에 안 나가요 — 영업 수량을 확인해 주세요`);
    if (options.withBack) {
      plan.back = {
        preparer: detail.work.processors.map(tr).filter(Boolean).join(', '),
        shipDate: kst(detail.work.shippedAt)?.ymd ?? '',
      };
    }
  } else if (renderer === 'swap') {
    const after = isObj(doc.after) ? doc.after : {};
    if (doc.kind === 'mfp') info('복합기 교체 확인서로 왔어요 — 영업 양식 그대로 나가고 IT 칸은 채우지 않아요');
    else {
      const line = detail.lines.find((l) => l.slots.length) ?? null;
      const slot = line?.slots[0] ?? null;
      for (const [mark, cell] of Object.entries(swapCells(after, slot)) as [ItMark, SalesFillCell][]) plan.cells[fillKey(mark)] = cell;
      if (detail.lines.reduce((s, l) => s + l.slots.length, 0) > 1) {
        info('교체 확인서는 교체 후 기기 한 대 칸만 있어요 — 첫 칸의 값만 종이에 나가요');
      }
    }
  } else {
    // svc — 영업 품목(이름 있는 줄) ↔ 상세 품목 줄이 같은 순서인지
    const named = (Array.isArray(doc.items) ? doc.items : []).filter((it): it is Json => isObj(it) && !!tr(it.name));
    const aligned = named.length === detail.lines.length && named.every((it, k) => tr(it.name) === tr(detail.lines[k]?.item.model));
    if (!aligned) warn('영업 양식의 품목과 기기 칸 품목이 달라요 — IT 기재 명세는 상세의 품목 순서로 적어요(상세를 새로 읽은 뒤 다시 열어 보세요)');
    if (detail.lines.some((l) => l.slots.length)) {
      plan.svcSheet = svcSheetOf(doc, detail.lines, { company: c.company, startDate: c.deliveryDate ?? '', docNo: c.docNo, type }, ctx);
      info(`영업 종이 뒤에 '${plan.svcSheet.title}' 장(대마다 한 줄)이 붙어요`);
    } else {
      info('영업 품목이 비어 있어 IT 기재 명세 장은 안 붙어요');
    }
  }

  // ───── 알림(막지 않음 — §3-E) ─────
  if (missingAsset) warn(`자산번호를 아직 안 적은 기기 ${missingAsset}대(장비·모니터·유지보수) — 그 칸은 빈칸으로 나가요(손으로 적기)`);
  if (detail.salesChanged) {
    warn(`영업에서 고친 판(v${detail.salesChanged.fromVer} → v${detail.salesChanged.toVer})을 아직 '확인함' 안 했어요 — 상세에서 무엇이 바뀌었나 먼저 보세요`);
  }
  if (recheck) warn(`영업 요청이 바뀌어 다시 확인이 필요한 기기 칸 ${recheck}개 — 상세에서 확인해 주세요(종이엔 지금 값이 그대로 나가요)`);
  if (ctx.e15) {
    info(`자산번호·시리얼만 적은 기기 ${ctx.e15}대는 출고 칸의 제조사·모델명을 영업 요청 그대로, 출고 사양을 '${E15_SAME_SPEC}'으로 적어요 — 사양이 다르면 상세에서 꼭 고치세요`);
  }
  if (swUnits) {
    if (!ctx.keysShown) info(`라이선스 키 없이 찍어요 — 소프트웨어 ${swUnits}칸의 키 자리는 빈칸`);
    else if (swNoKey) info(`라이선스 키가 없는 소프트웨어 칸 ${swNoKey}개 — 그 자리는 빈칸`);
  }
  const pv = detail.work.printedVer;
  if (pv !== null && pv !== undefined && c.ver > pv) info(`v${pv} 출력 뒤 영업이 고쳤어요(지금 v${c.ver}) — 이번 출력이 새 판이에요`);
  const printedMs = Date.parse(detail.work.printedAt ?? '');
  if (Number.isFinite(printedMs)) {
    const units = detail.lines.flatMap((l) => l.slots.map((s) => s.unit)).filter((u) => u !== null);
    if (units.some((u) => Date.parse(u.updatedAt) > printedMs)) info('지난 출력 뒤 IT 값(기기 칸)이 바뀌었어요 — 이번 출력에 반영돼요');
  }
  if (detail.orphans.length) info(`영업에서 빠진 칸 ${detail.orphans.length}개(상세 아래 회색)는 종이에 안 나가요`);

  return plan;
}

/** 넘침 신호(itFill 스크립트의 pages)를 받았을 때 출력 창 알림 — 다시 그리는 길은 없음(알림만) */
export function overflowNote(pages: readonly number[]): SalesPrintNote | null {
  const list = pages.filter((p) => Number.isInteger(p) && p > 0);
  if (!list.length) return null;
  return {
    tone: 'warn',
    text: `${list.join('·')}쪽 아래가 종이 밖으로 넘쳐요 — 확인란·서명 칸이 잘릴 수 있어요. 인쇄 미리보기에서 꼭 확인해 주세요(한 품목이 9대쯤 넘거나 소모품·특이사항이 길면 영업 종이도 같아요)`,
  };
}

// ───────── 사본 그리기 ─────────

/*
 * 영업 export 라우트(app/api/export/it-confirms/route.ts)의 fullConf·fullSwap·fullSvc 와 같은 빈 칸 채움.
 * export doc 은 이미 이 결과라 다시 해도 같은 값(같은 종이) — 칸이 빠진 doc 이 와도 렌더러가 깨지지 않게.
 */
function fullConf(raw: Json): ConfDoc {
  const d = { ...emptyConf('it'), ...raw } as ConfDoc;
  return {
    ...d,
    items: (Array.isArray(d.items) ? d.items : []).map((i) => ({ ...emptyItem(d.kind), ...i, spec: { ...(i.spec ?? {}) } })),
    supplies: (Array.isArray(d.supplies) ? d.supplies : []).map((s) => ({
      ...{ name: '', qty: '', charge: '청구' as const, price: '', note: '' },
      ...(s as Partial<ConfDoc['supplies'][number]>),
    })),
  };
}
function fullSwap(raw: Json): SwapDoc {
  const e = emptySwap('it');
  const r = raw as Partial<SwapDoc>;
  return { ...e, ...r, before: { ...e.before, ...(r.before ?? {}) }, after: { ...e.after, ...(r.after ?? {}) }, cond: { ...e.cond, ...(r.cond ?? {}) } } as SwapDoc;
}
function fullSvc(raw: Json): SvcDoc {
  return { ...emptySvc(raw.kind === '소프트웨어' ? '소프트웨어' : '유지보수'), ...raw } as SvcDoc;
}

/**
 * 받아 둔 사본(영업 b33a4c3)으로 그리기.
 * @param doc 상세의 formDoc(영업 export doc — 그대로 영업 렌더러에, E10)
 * @param origin 영업 로고 그림 주소 앞부분(우리 앱 주소 — public/confirm/rabbit.png 가 영업 것과 같음)
 * @param withBack 납품 2면 포함(교체·svc 는 무시)
 * @param marks 참이면 IT 칸 표시(§3-H) — 채우기(applyFillPlan)용. 거짓이면 영업 원본과 글자까지 같음
 * @param regionFill doc 복사본의 지역이 비었을 때만 넣는 추정 지역(plan.regionFill) — 원본과 견줄 땐 주지 말 것
 */
export function renderCopy(
  doc: Record<string, unknown>,
  renderer: SalesRenderer,
  origin: string,
  withBack: boolean,
  marks: boolean,
  regionFill?: string | null,
): string {
  const fill = tr(regionFill);
  const src: Json = fill && !tr(doc.region) ? { ...doc, region: fill } : doc;
  if (renderer === 'confirm') return renderConfirm(fullConf(src), origin, withBack, marks);
  if (renderer === 'swap') return renderSwap(fullSwap(src), origin, marks);
  return renderSvc(fullSvc(src), origin, marks);
}
