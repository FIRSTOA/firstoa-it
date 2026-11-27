/**
 * 기기 표의 '사양' 한 칸(글자 한 줄) ↔ ④ 출고사양 (2026-11-27 사용자 — 확인서 상세 기기 입력을 예전 방식 표처럼).
 * 순수 함수(import type + stockSpec·specCompare 만 — Node 로 바로 시험) — 화면(표 줄)·서버 저장(salesDetailActions)·출력(printFill)이 같이 씀.
 *
 * 보이는 꼴(formatSpecLine): "I5-12 / 32GB / 512GB / 2TB / 1660S"
 *   자리 차례 = CPU / RAM / SSD / HDD / 그래픽, 가운데 빈 자리는 '-', 뒤쪽 빈 자리는 뺌.
 *   OS·인치는 자리 대신 뒤에 이름표로 — OS 낱말이면 그대로("윈11"), 아니면 "OS 값" · 인치는 "15.6인치".
 * 읽는 꼴(parseSpecLine):
 *   ① IT재고 꼴 — 조각 6개에 둘째가 숫자(세대, "I5/12/32/500/2/1660S") 또는 RAM·SSD 자리가 숫자뿐인 5조각("I5/16/512/X/내장")
 *      → stockSpec.specFromStockLabel(단위 붙임). 거기서 모호하다고 비우면 못 읽음(null).
 *   ② 사람이 쓴 꼴·보이는 꼴 — "I5-12/32GB/512GB/X/내장" 처럼 자리 차례대로 1~5조각, '-'·빈 조각 = 그 칸 안 적음.
 *      CPU 자리에 용량(16GB 등)이 섞여 있으면(빗금 없이 띄어 쓴 "I5 16GB 512GB") 못 읽음.
 *      숫자뿐인 용량은 단위를 붙임(RAM = GB, SSD 10 미만 = TB, HDD 100 미만 = TB — stockSpec 과 같은 규칙).
 *   OS 낱말(윈·Win·Windows·맥OS·리눅스·도스…)·"OS …" 조각 = OS, "15.6인치"·'15.6"' 조각 = 인치(그 품목 칸에 있을 때만, 아니면 못 읽음).
 *   base(지금 값 = 영업 요청에 출고 값을 덮은 것)를 주면, 글자가 사실상 같은 칸은 base 글자 그대로 둠(보이는 꼴을 다시 읽어도 값이 안 바뀜).
 *   못 읽으면 null → 화면이 그 글자를 ④ extra.specText 로(칸별 값은 비움). 출력·완료 보고는 칸별 값이 없을 때만 specText 를 씀.
 * 규칙(서버도 같게): specText 는 칸별 출고사양(spec_override)이 비었을 때만 의미 — 칸별 값을 저장하면 specText 는 지움.
 *   모니터·기타·사양 칸 없는 장비(태블릿 등)는 칸별 값이 없어 '사양' 칸 글자가 늘 specText.
 */
import type { ItemKind } from './itemKind';
import type { SalesSpec, SalesSpecKey } from './types';
import { normText } from './specCompare';
import { specFromStockLabel } from './stockSpec';

/** 자리로 읽는 칸(차례 그대로) */
export const SPEC_LINE_CORE: readonly SalesSpecKey[] = ['CPU', 'RAM', 'SSD', 'HDD', '그래픽'];
/** ④ extra.specText 최대 글자 수(서버 parseExtra·저장과 같음) */
export const SPEC_TEXT_MAX = 200;

/** '사양' 칸 글자(specText)를 받는 종류 — 장비·모니터·기타(유지보수·소프트웨어는 사양 칸 없음) */
export function specTextAllowed(kind: ItemKind): boolean {
  return kind === 'device' || kind === 'monitor' || kind === 'other';
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 값이 하나라도 있는 사양인지 */
export function hasSpecValues(spec: SalesSpec | null | undefined): boolean {
  return !!spec && Object.values(spec).some((v) => clean(v) !== '');
}

/** 칸마다 출고 값이 있으면 그것, 없으면 영업 요청(keys 안 칸만) */
export function mergeSpec(request: SalesSpec | null | undefined, override: SalesSpec | null | undefined, keys: readonly SalesSpecKey[]): SalesSpec {
  const out: SalesSpec = {};
  for (const k of keys) {
    const v = clean(override?.[k]) || clean(request?.[k]);
    if (v) out[k] = v;
  }
  return out;
}

// ───────── 이름표 조각(OS·인치) ─────────

const OS_WORD_RE = /^(win|windows|윈도우?|윈\s?\d|mac\s?os|macos|맥\s?os|리눅스|linux|우분투|ubuntu|chrome\s?os|크롬\s?os|free\s?dos|프리\s?도스|dos\b|도스|os\s?없음|os\s?미설치)/i;
const OS_LABEL_RE = /^OS(?:\s*[:：]\s*|\s+)(.+)$/i;
const INCH_RE = /^\d+(?:\.\d+)?\s*(인치|"|″|”|inch(?:es)?|형)$/i;
const INCH_LABEL_RE = /^인치\s*[:：]?\s*(.+)$/;

function osValue(tok: string): string | null {
  if (OS_WORD_RE.test(tok)) return tok;
  const m = OS_LABEL_RE.exec(tok);
  return m ? m[1].trim() || null : null;
}
function inchValue(tok: string): string | null {
  if (INCH_RE.test(tok)) return tok;
  const m = INCH_LABEL_RE.exec(tok);
  return m ? m[1].trim() || null : null;
}
const osToken = (v: string) => (OS_WORD_RE.test(v) ? v : `OS ${v}`);
const inchToken = (v: string) => (inchValue(v) !== null ? v : `${v}인치`);

// ───────── 보이는 꼴 ─────────

/** 칸별 값 → 한 줄(keys 안 칸만). 값이 없으면 '' */
export function formatSpecLine(spec: SalesSpec | null | undefined, keys: readonly SalesSpecKey[]): string {
  const core = SPEC_LINE_CORE.filter((k) => keys.includes(k));
  const vals = core.map((k) => clean(spec?.[k]));
  let last = vals.length - 1;
  while (last >= 0 && !vals[last]) last--;
  const parts = vals.slice(0, last + 1).map((v) => v || '-');
  const os = clean(spec?.OS);
  if (keys.includes('OS') && os) parts.push(osToken(os));
  const inch = clean(spec?.['인치']);
  if (keys.includes('인치') && inch) parts.push(inchToken(inch));
  return parts.join(' / ');
}

// ───────── 읽기 ─────────

const CPU_STOCK_RE = /^[A-Za-z]{1,4}\d{1,2}[A-Za-z]{0,2}$/; // stockSpec.ts CPU_RE 와 같게(I5 · I7 · A5 · R7 · M1 …)
const BARE_NUM_RE = /^\d+(?:\.\d+)?$/;
/** CPU 자리에 용량이 들어 있으면("I5 16GB 512GB" — 빗금 없이 띄어 쓴 글) 자리로 못 읽음 */
const CAPACITY_IN_RE = /\d+(?:\.\d+)?\s*(?:gb|tb|기가|테라)/i;

/** 숫자뿐인 용량에 단위(stockSpec 과 같은 규칙) — 그 밖은 글자 그대로 */
function withUnit(key: SalesSpecKey, raw: string): string {
  if (!BARE_NUM_RE.test(raw)) return raw;
  const n = Number(raw);
  if (key === 'RAM') return `${n}GB`;
  if (key === 'SSD') return n < 10 ? `${n}TB` : `${n}GB`;
  if (key === 'HDD') return n < 100 ? `${n}TB` : `${n}GB`;
  return raw;
}

/** base 글자와 사실상 같은 글자인지(대소문자·공백·하이픈, 인치 꼬리) — 같으면 base 글자를 그대로 둠 */
function sameSpelling(a: string, b: string): boolean {
  const na = normText(a);
  const nb = normText(b);
  return na === nb || `${na}인치` === nb || na === `${nb}인치`;
}

/**
 * 한 줄 → 칸별 값. '' = {}(사양 안 적음). 못 읽으면 null.
 * @param keys 이 품목의 사양 칸(salesForm specKeys — 노트북만 인치)
 * @param base 지금 보이는 값(영업 요청에 출고 값을 덮은 것) — 같은 글자 칸은 base 글자 그대로
 */
export function parseSpecLine(text: string, keys: readonly SalesSpecKey[], base?: SalesSpec | null): SalesSpec | null {
  const t = clean(text);
  if (!t) return {};
  if (t.length > SPEC_TEXT_MAX) return null;
  const has = (k: SalesSpecKey) => keys.includes(k);
  const out: SalesSpec = {};
  const raw: Partial<Record<SalesSpecKey, string>> = {};
  const core: string[] = [];
  for (const tok of t.split('/').map((s) => s.trim())) {
    const os = tok ? osValue(tok) : null;
    if (os !== null) {
      if (!has('OS') || out.OS) return null;
      out.OS = os;
      raw.OS = os;
      continue;
    }
    const inch = tok ? inchValue(tok) : null;
    if (inch !== null) {
      if (!has('인치') || out['인치']) return null;
      out['인치'] = inch;
      raw['인치'] = inch;
      continue;
    }
    core.push(tok);
  }
  const coreKeys = SPEC_LINE_CORE.filter(has);
  while (core.length && !core[core.length - 1]) core.pop(); // 끝의 빈 조각("I5-12/16GB/")
  if (core.length) {
    const stockLike =
      (core.length === 6 && /^\d{1,3}$/.test(core[1])) ||
      (core.length === 5 && BARE_NUM_RE.test(core[1]) && BARE_NUM_RE.test(core[2]) && CPU_STOCK_RE.test(core[0]));
    if (stockLike) {
      const stock = specFromStockLabel(core.join('/'));
      if (!hasSpecValues(stock)) return null; // IT재고 꼴인데 모호 — 칸별로 안 나눔(stockSpec 과 같은 판단)
      for (const k of coreKeys) {
        const v = clean(stock[k]);
        if (v) {
          out[k] = v;
          raw[k] = v;
        }
      }
    } else {
      if (core.length > coreKeys.length) return null;
      if (coreKeys[0] === 'CPU' && CAPACITY_IN_RE.test(core[0] ?? '')) return null;
      core.forEach((tok, i) => {
        if (!tok || /^[-‐-―−－]+$/.test(tok)) return;
        const k = coreKeys[i];
        out[k] = withUnit(k, tok);
        raw[k] = tok;
      });
    }
  }
  for (const k of Object.keys(out) as SalesSpecKey[]) {
    const b = clean(base?.[k]);
    const r = raw[k] ?? '';
    if (b && r && sameSpelling(b, r)) out[k] = b;
    if ((out[k] ?? '').length > SPEC_TEXT_MAX) return null;
  }
  return out;
}

/** 두 칸별 값이 같은지(앞뒤 공백·빈 칸 무시, 글자 그대로) */
export function sameSpecMap(a: SalesSpec | null | undefined, b: SalesSpec | null | undefined): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]) as Set<SalesSpecKey>;
  for (const k of keys) if (clean(a?.[k]) !== clean(b?.[k])) return false;
  return true;
}

/**
 * 표의 '사양' 칸에 지금 보일 글자.
 *   칸별 출고 값이 있으면 영업 요청에 덮어 한 줄 · 없으면 specText · 둘 다 없으면 ''(흐린 글씨로 영업 요청 — specLinePlaceholder).
 *   칸별 칸이 없는 품목(keys 빈 배열 — 모니터·기타 등)은 specText 만.
 */
export function specLineOf(
  unit: { specOverride?: SalesSpec | null; extra?: { specText?: string } | null } | null | undefined,
  request: SalesSpec | null | undefined,
  keys: readonly SalesSpecKey[],
): string {
  const ov = unit?.specOverride ?? {};
  if (keys.length && hasSpecValues(ov)) return formatSpecLine(mergeSpec(request, ov, keys), keys);
  return clean(unit?.extra?.specText);
}

/** '사양' 칸이 비었을 때 흐린 글씨 — 영업 요청 한 줄 */
export function specLinePlaceholder(request: SalesSpec | null | undefined, keys: readonly SalesSpecKey[]): string {
  return keys.length ? formatSpecLine(request, keys) : '';
}

/**
 * 고친 '사양' 칸 글자 → 저장할 값. 칸별 칸이 있는 품목은 읽어서 specOverride(+ specText 지움), 못 읽으면 specOverride {} + specText 글자 그대로.
 * 칸별 칸이 없는 품목은 specText 만(specOverride 는 안 보냄).
 */
export function specPatchFromLine(
  text: string,
  keys: readonly SalesSpecKey[],
  base: SalesSpec | null | undefined,
): { specOverride?: SalesSpec; specText: string } {
  const t = clean(text).slice(0, SPEC_TEXT_MAX);
  if (!keys.length) return { specText: t };
  if (!t) return { specOverride: {}, specText: '' };
  const parsed = parseSpecLine(t, keys, base);
  if (parsed) return { specOverride: parsed, specText: '' };
  return { specOverride: {}, specText: t };
}

/**
 * 품목 한 칸 '제조사' — 그 품목 줄들의 출고 제조사(actualMaker).
 *   values = 적힌 서로 다른 값(처음 글자 그대로), blank = 빈 줄 수. 값이 하나면 value = 그것(빈 줄이 있으면 "일부 줄만"), 여럿이면 value '' (여러 개).
 */
export function lineMakerState(units: readonly ({ actualMaker?: string | null } | null | undefined)[]): {
  value: string;
  values: string[];
  blank: number;
  total: number;
} {
  const values: string[] = [];
  let blank = 0;
  for (const u of units) {
    const m = clean(u?.actualMaker);
    if (!m) blank++;
    else if (!values.includes(m)) values.push(m);
  }
  return { value: values.length === 1 ? values[0] : '', values, blank, total: units.length };
}
