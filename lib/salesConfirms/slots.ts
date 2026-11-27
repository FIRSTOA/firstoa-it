/**
 * 기기 칸 규칙 — 품목 → 칸, ④ 행 붙이기, 영업에서 빠진 칸, 스냅숏 비교, 확인 안 된 차이 (설계 §3-4, D18·D19·D27).
 * 순수 함수(import type + itemKind·specCompare 만) — 상세(work.ts)·저장 검사(salesDetailActions)·목록(listQuery)·화면·출력이 같이 씀.
 * **칸 계산은 이 파일 한 곳.**
 *
 * 칸 열쇠 slot_key = 품목구분(cat, 비면 '기타') + '#' + 같은 품목구분 줄 안 순서 → '데스크탑#1', '데스크탑#2', '모니터#1'
 * unit_no = 1..칸 수. 칸 수 = unitCountFor(종류, qty) — 0~50 으로 자르고 유지보수·소프트웨어는 0이면 1.
 * 화면을 그릴 때마다 지금 영업 품목으로 칸을 계산하고 ④ 행을 (slot_key, unit_no)로 붙임 → 가져오기는 ④를 안 건드림.
 * 갈 곳 없는 ④ 행 중 IT가 뭐라도 적은 행 = "영업에서 빠진 칸"(지우지 않음), 아무것도 안 적은 행은 안 보임.
 * 교체 건에 items 가 비고 after 만 오면 after 를 1칸짜리 품목으로 봄(slotItems).
 * `＋ 줄 추가`(2026-11-27 사용자 결정): ④ extra.added 표시가 있는 행은 unit_no 가 영업 수량보다 커도 "빠진 칸"이 아니라
 *   그 품목의 정상 칸(SalesSlot.added — 영업 수량 칸 뒤, unit_no 순). 표시 없는 넘는 행은 지금처럼 "빠진 칸".
 *   영업이 수량을 늘려 그 번호가 영업 칸 안에 들어오면 그냥 영업 칸(added 아님 — 종이 영업 줄로).
 *   **화면·저장 검사·목록·완료 보고(prepLink)가 모두 이 함수로 칸을 만듦 → ④ 를 읽을 때 extra 칸도 같이 읽어야 함.**
 */
import type {
  DiffAckMap,
  DiffField,
  DiffItem,
  NormalizedSalesConfirm,
  SalesConfirmItem,
  SalesSlot,
  SalesSlotLine,
  SalesSpec,
  SalesSpecKey,
  SalesUnitExtra,
  SalesUnitRow,
} from './types';
import { ITEM_KIND_RULES, itemKind, unitCountFor, type ItemKind } from './itemKind';
import { diffsFor, sameSpecValue } from './specCompare';

// types.ts 의 SALES_SPEC_KEYS 와 같은 목록·순서(값 import 를 피하려고 여기 따로 — 바꾸면 같이)
const SPEC_ORDER: readonly SalesSpecKey[] = ['CPU', 'RAM', 'SSD', 'HDD', '그래픽', 'OS', '인치'];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): string =>
  (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').slice(0, max);

// ───────────────────────── 파서(DB jsonb → 화면 모양, 모르는 칸은 버림) ─────────────────────────

/** 사양 칸 — CPU·RAM·SSD·HDD·그래픽·OS·인치 중 값 있는 것만 */
export function parseSpec(raw: unknown): SalesSpec {
  const out: SalesSpec = {};
  if (!isObj(raw)) return out;
  for (const k of SPEC_ORDER) {
    const v = str(raw[k], 200);
    if (v) out[k] = v;
  }
  return out;
}

/** 체크 {항목: {at, by}} */
export function parseChecks(raw: unknown): Record<string, { at: string; by: string }> {
  const out: Record<string, { at: string; by: string }> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!k || k.length > 200 || !isObj(v)) continue;
    out[k] = { at: str(v.at, 60), by: str(v.by, 60) };
  }
  return out;
}

/** ④ extra — pc·user·ledgerPushed·added 만(라이선스 키 같은 다른 칸은 버림 — 키는 ④ 에 절대 안 둠) */
export function parseExtra(raw: unknown): SalesUnitExtra {
  const out: SalesUnitExtra = {};
  if (!isObj(raw)) return out;
  if (raw.added === true) out.added = true;
  const pc = str(raw.pc, 100);
  if (pc) out.pc = pc;
  const user = str(raw.user, 100);
  if (user) out.user = user;
  if (isObj(raw.ledgerPushed)) {
    const lp: NonNullable<SalesUnitExtra['ledgerPushed']> = {};
    // 빈 글자도 의미 있음(대장에 빈 값으로 올렸음) — 문자열이면 그대로
    for (const k of ['product', 'pc', 'user', 'at'] as const) {
      const v = raw.ledgerPushed[k];
      if (typeof v === 'string') lp[k] = v.slice(0, 200);
    }
    out.ledgerPushed = lp;
  }
  return out;
}

export function isDiffField(v: unknown): v is DiffField {
  if (v === 'maker' || v === 'model') return true;
  return typeof v === 'string' && v.startsWith('spec:') && (SPEC_ORDER as readonly string[]).includes(v.slice('spec:'.length));
}

/** ④ diff_ack */
export function parseDiffAck(raw: unknown): DiffAckMap {
  const out: DiffAckMap = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isDiffField(k) || !isObj(v)) continue;
    const sales = str(v.sales);
    const actual = str(v.actual);
    if (!sales || !actual) continue;
    out[k] = { sales, actual, at: str(v.at, 60), by: str(v.by, 60) };
  }
  return out;
}

/** 저장된 품목 한 줄(① items 사본·④ item_snapshot) → SalesConfirmItem. 객체가 아니면 null */
export function parseItem(raw: unknown): SalesConfirmItem | null {
  if (!isObj(raw)) return null;
  const qty = Math.floor(Number(raw.qty));
  const item: SalesConfirmItem = {
    cat: str(raw.cat, 100) || '기타',
    model: str(raw.model),
    maker: str(raw.maker),
    state: str(raw.state, 100),
    qty: Number.isFinite(qty) && qty > 0 ? qty : 0,
    spec: parseSpec(raw.spec),
    place: str(raw.place, 1000),
  };
  if (isObj(raw.specExtra)) {
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.specExtra)) {
      const s = str(v, 200);
      if (k && s) extra[k] = s;
    }
    if (Object.keys(extra).length) item.specExtra = extra;
  }
  if (typeof raw.rent === 'number' && Number.isFinite(raw.rent)) item.rent = raw.rent;
  else if (raw.rent === null) item.rent = null;
  return item;
}

export function toSalesItems(raw: unknown): SalesConfirmItem[] {
  return (Array.isArray(raw) ? raw : []).map(parseItem).filter((x): x is SalesConfirmItem => x !== null);
}

/** ④ DB 한 줄(select 결과) → 화면 모양. 블록 A 전이라 extra·diff_ack 칸이 없으면 빈 값 */
export function unitRowFromDb(raw: Json): SalesUnitRow {
  const unitNo = Math.floor(Number(raw.unit_no));
  return {
    id: str(raw.id, 100),
    slotKey: typeof raw.slot_key === 'string' ? raw.slot_key : '',
    unitNo: Number.isFinite(unitNo) ? unitNo : 0,
    itemSnapshot: parseItem(raw.item_snapshot),
    assetId: str(raw.asset_id, 100),
    serial: str(raw.serial, 200),
    actualMaker: str(raw.actual_maker, 200),
    actualModel: str(raw.actual_model, 300),
    specOverride: parseSpec(raw.spec_override),
    checks: parseChecks(raw.checks),
    note: str(raw.note, 2000),
    extra: parseExtra(raw.extra),
    diffAck: parseDiffAck(raw.diff_ack),
    // 동시 수정 확인용 — DB 가 준 문자열 그대로(µs 포함, Date 로 바꾸지 않음)
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    updatedBy: str(raw.updated_by, 60),
  };
}

// ───────────────────────── 칸 계산 ─────────────────────────

/** 품목구분(비면 '기타') */
export function catOf(item: Pick<SalesConfirmItem, 'cat'> | null | undefined): string {
  return String(item?.cat ?? '').trim() || '기타';
}

/** 품목 줄마다 slot_key = 품목구분#같은 품목구분 안 순서 */
export function slotKeysFor(items: readonly Pick<SalesConfirmItem, 'cat'>[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const cat = catOf(it);
    const n = (seen.get(cat) ?? 0) + 1;
    seen.set(cat, n);
    return `${cat}#${n}`;
  });
}

/** slot_key → 품목구분(마지막 '#숫자' 뗌) */
export function catOfSlotKey(slotKey: string): string {
  return String(slotKey ?? '').replace(/#\d+$/, '') || '기타';
}

/** slot_key 만으로 종류(영업에서 빠진 칸처럼 지금 품목이 없을 때) */
export function kindOfSlotKey(slotKey: string): ItemKind {
  return itemKind(catOfSlotKey(slotKey));
}

/**
 * 교체 건 after(교체 후 기기) → 품목 줄. 객체면 1줄, 배열이면 원소마다 1줄, 각 1칸.
 * after 모양(실측): {item, model, maker, sn, asset, spec, sw} — spec 이 글자면 specExtra '사양' 으로 보여 주기만.
 */
export function itemsFromReplaceAfter(after: unknown): SalesConfirmItem[] {
  const list = Array.isArray(after) ? after : isObj(after) ? [after] : [];
  const out: SalesConfirmItem[] = [];
  for (const a of list) {
    if (!isObj(a)) continue;
    const item: SalesConfirmItem = {
      cat: str(a.item, 100) || '기타',
      model: str(a.model),
      maker: str(a.maker),
      state: '',
      qty: 1,
      spec: parseSpec(a.spec),
      place: '',
    };
    const specText = typeof a.spec === 'string' ? a.spec.trim().slice(0, 200) : '';
    if (specText) item.specExtra = { 사양: specText };
    if (!str(a.item) && !item.model && !item.maker && !specText && Object.keys(item.spec).length === 0) continue;
    out.push(item);
  }
  return out;
}

/** 칸을 계산할 품목 — 영업 items, 비었으면 교체 after(1칸씩) */
export function slotItems(confirm: Pick<NormalizedSalesConfirm, 'items' | 'replaceInfo'>): SalesConfirmItem[] {
  const items = Array.isArray(confirm.items) ? confirm.items : [];
  if (items.length) return items;
  return itemsFromReplaceAfter(confirm.replaceInfo?.after ?? null);
}

/** ④ item_snapshot 에 넣을 모양(cat·model·maker·state·spec + 보여 주기용 qty·place) */
export function itemSnapshot(item: SalesConfirmItem): SalesConfirmItem {
  return {
    cat: catOf(item),
    model: String(item.model ?? '').trim(),
    maker: String(item.maker ?? '').trim(),
    state: String(item.state ?? '').trim(),
    qty: Number(item.qty) || 0,
    spec: parseSpec(item.spec),
    place: String(item.place ?? '').trim(),
  };
}

/** 칸을 채울 때의 영업 품목과 지금 품목이 다른지(cat·model·maker·state·사양 칸 — 앞뒤 공백만 무시). 스냅숏이 없으면 false */
export function snapshotChanged(snapshot: SalesConfirmItem | null | undefined, item: SalesConfirmItem): boolean {
  if (!snapshot) return false;
  const t = (v: unknown) => String(v ?? '').trim();
  if (catOf(snapshot) !== catOf(item)) return true;
  if (t(snapshot.model) !== t(item.model) || t(snapshot.maker) !== t(item.maker) || t(snapshot.state) !== t(item.state)) return true;
  const a = snapshot.spec ?? {};
  const b = item.spec ?? {};
  return SPEC_ORDER.some((k) => t(a[k]) !== t(b[k]));
}

/** 이 차이를 확인한 기록이 있는지 — 기록의 (영업 값, 출고 값) 쌍이 지금 쌍과 같을 때만(같다고 보는 기준은 specCompare) */
export function isAcked(ack: DiffAckMap | null | undefined, d: DiffItem): boolean {
  const a = ack?.[d.field];
  return !!a && sameSpecValue(d.field, a.sales, d.sales) && sameSpecValue(d.field, a.actual, d.actual);
}

/** 칸의 지금 출고 값으로 계산한 차이 */
export function unitDiffs(kind: ItemKind, item: SalesConfirmItem, unit: Pick<SalesUnitRow, 'actualMaker' | 'actualModel' | 'specOverride'>): DiffItem[] {
  return diffsFor(kind, item, { maker: unit.actualMaker, model: unit.actualModel, spec: unit.specOverride ?? {} });
}

/** 영업 요청과 다른데 확인 안 된 차이(영업 요청이 바뀌어 풀린 것 포함) */
export function unackedDiffsFor(kind: ItemKind, item: SalesConfirmItem, unit: SalesUnitRow): DiffItem[] {
  return unitDiffs(kind, item, unit).filter((d) => !isAcked(unit.diffAck, d));
}

/** IT가 뭐라도 적은 칸인지(대장에 올린 소프트웨어 칸 포함, extra.added 표시만 있는 빈 줄은 아님) — 아니면 "영업에서 빠진 칸"에 안 보임 */
export function unitHasContent(u: SalesUnitRow): boolean {
  if (u.assetId || u.serial || u.actualMaker || u.actualModel || u.note) return true;
  if (Object.values(u.specOverride ?? {}).some((v) => String(v ?? '').trim())) return true;
  if (Object.keys(u.checks ?? {}).length) return true;
  const e = u.extra ?? {};
  return !!(e.pc || e.user || e.ledgerPushed);
}

/** 진행 "자산 n/m" 에 채운 칸으로 셀지 — 유지보수는 자산번호 또는 시리얼, 나머지는 자산번호 */
export function slotFilled(kind: ItemKind, unit: Pick<SalesUnitRow, 'assetId' | 'serial'> | null | undefined): boolean {
  if (!unit) return false;
  if (kind === 'maintenance') return !!(unit.assetId.trim() || unit.serial.trim());
  return !!unit.assetId.trim();
}

const unitKey = (slotKey: string, unitNo: number) => `${slotKey}\u0000${unitNo}`;

/** `＋ 줄 추가`를 받는 종류 — 장비·모니터·기타(완료 보고로 가는 칸과 같음, prepLinkRules REPORT_KINDS). 유지보수·소프트웨어는 안 받음 */
export const ADDABLE_KINDS: readonly ItemKind[] = ['device', 'monitor', 'other'];
/** 품목 한 줄에 더할 수 있는 줄 수(영업 수량 밖) */
export const ADDED_LINE_MAX = 30;

/**
 * 이 확인서·품목 종류에 `＋ 줄 추가`를 보여 주고 받는지(화면·서버 같은 판정).
 * 납품(영업 양식 confirm — 옛 원문이면 type '납품')만: 교체 종이는 교체 후 한 대 칸뿐, 유지보수·소프트웨어는 'IT 기재 명세'가 이미 대마다,
 * 따로 보는 종류(판매·철수·이전)는 기기 칸이 없음.
 */
export function addLineAllowed(
  confirm: Pick<NormalizedSalesConfirm, 'type' | 'renderer' | 'otherRenderer'>,
  kind: ItemKind,
): boolean {
  if (!ADDABLE_KINDS.includes(kind)) return false;
  if (confirm.otherRenderer) return false;
  if (confirm.renderer) return confirm.renderer === 'confirm';
  return String(confirm.type ?? '').trim() === '납품';
}

/** 줄 추가 때 새 unit_no — 영업 수량 칸·붙은 칸과 이 칸 열쇠의 ④ 행(영업에서 빠진 칸 포함) 중 가장 큰 번호 + 1(같은 번호 충돌 방지) */
export function nextAddedUnitNo(
  line: Pick<SalesSlotLine, 'slotKey' | 'slots'>,
  units: readonly Pick<SalesUnitRow, 'slotKey' | 'unitNo'>[],
): number {
  let max = 0;
  for (const s of line.slots) max = Math.max(max, s.unitNo);
  for (const u of units) if (u.slotKey === line.slotKey) max = Math.max(max, u.unitNo);
  return max + 1;
}

/** 이 줄에 지금 붙은 추가 줄 수 */
export function addedSlotCount(line: Pick<SalesSlotLine, 'slots'>): number {
  return line.slots.filter((s) => s.added).length;
}

/**
 * 지금 품목으로 칸을 계산하고 ④ 행을 붙임.
 *   영업 수량 칸(1..수량) 뒤에 ④ extra.added 행(unit_no > 수량)을 unit_no 순으로 붙임(SalesSlot.added).
 * @returns lines(품목 줄마다 칸), orphans(갈 곳 없는 행 중 뭐라도 적은 것 — slot_key·unit_no 순)
 */
export function buildSlotLines(
  items: readonly SalesConfirmItem[],
  units: readonly SalesUnitRow[],
): { lines: SalesSlotLine[]; orphans: SalesUnitRow[] } {
  const byKey = new Map<string, SalesUnitRow>();
  const addedByKey = new Map<string, SalesUnitRow[]>();
  for (const u of units) {
    const k = unitKey(u.slotKey, u.unitNo);
    if (byKey.has(k)) continue;
    byKey.set(k, u);
    if (u.extra?.added === true && u.unitNo >= 1) {
      const list = addedByKey.get(u.slotKey);
      if (list) list.push(u);
      else addedByKey.set(u.slotKey, [u]);
    }
  }
  const keys = slotKeysFor(items);
  const used = new Set<SalesUnitRow>();
  const lines: SalesSlotLine[] = items.map((item, i) => {
    const kind = itemKind(item.cat);
    const count = unitCountFor(kind, item.qty);
    const slots: SalesSlot[] = [];
    let changed = false;
    for (let n = 1; n <= count; n++) {
      const unit = byKey.get(unitKey(keys[i], n)) ?? null;
      if (unit) {
        used.add(unit);
        if (snapshotChanged(unit.itemSnapshot, item)) changed = true;
      }
      slots.push({ slotKey: keys[i], unitNo: n, unit, unackedDiffs: unit ? unackedDiffsFor(kind, item, unit) : [] });
    }
    // `＋ 줄 추가`한 행 — 영업 수량 밖 번호만(안쪽 번호는 위에서 영업 칸으로 붙음)
    const added = (addedByKey.get(keys[i]) ?? []).filter((u) => u.unitNo > count).sort((a, b) => a.unitNo - b.unitNo);
    for (const unit of added) {
      used.add(unit);
      if (snapshotChanged(unit.itemSnapshot, item)) changed = true;
      slots.push({ slotKey: keys[i], unitNo: unit.unitNo, unit, unackedDiffs: unackedDiffsFor(kind, item, unit), added: true });
    }
    return { itemIndex: i, item, kind, slotKey: keys[i], slots, snapshotChanged: changed };
  });
  const orphans = units
    .filter((u) => !used.has(u) && unitHasContent(u))
    .sort((a, b) => a.slotKey.localeCompare(b.slotKey) || a.unitNo - b.unitNo);
  return { lines, orphans };
}

/** 칸 하나 찾기(저장 검사용) — 없으면 null(영업에서 빠졌거나 잘못된 칸) */
export function findSlotLine(
  lines: readonly SalesSlotLine[],
  slotKey: string,
  unitNo: number,
): { line: SalesSlotLine; slot: SalesSlot } | null {
  for (const line of lines) {
    if (line.slotKey !== slotKey) continue;
    const slot = line.slots.find((s) => s.unitNo === unitNo);
    return slot ? { line, slot } : null;
  }
  return null;
}

/** 진행 n/m — m = 장비·모니터·유지보수 칸 수(itemKind 규칙 countsProgress, `＋ 줄 추가`한 칸 포함 — 내보낼 기기라서), n = 그중 채운 칸 */
export function slotProgress(lines: readonly SalesSlotLine[]): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  for (const line of lines) {
    if (!ITEM_KIND_RULES[line.kind].countsProgress) continue;
    total += line.slots.length;
    filled += line.slots.filter((s) => slotFilled(line.kind, s.unit)).length;
  }
  return { filled, total };
}

/** "요청과 다름"(확인 안 된 차이가 하나라도 있는) 칸 수 — 2026-11-27부터 저장은 안 막고 인쇄 때 한 번에 확인 */
export function recheckSlotCount(lines: readonly SalesSlotLine[]): number {
  let n = 0;
  for (const line of lines) for (const s of line.slots) if (s.unackedDiffs.length) n++;
  return n;
}
