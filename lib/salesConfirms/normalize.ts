/**
 * 영업 확인서 원문 1건 → NormalizedSalesConfirm (순수 함수 — import type 말고는 import 없음, Node 로 바로 돌려 볼 수 있음).
 * 응답 모양은 키를 받은 뒤 1회 실측으로 확정(설계 §3-6) — 지금은 지침의 칸 이름만 너그럽게 읽고, 칸 이름을 추측으로 더 만들지 않음.
 * 실패 reason 에는 칸 이름만(값·연락처 금지).
 */
import type {
  NormalizedSalesConfirm,
  SalesConfirmContacts,
  SalesConfirmItem,
  SalesConfirmSupply,
  SalesPrintExtra,
  SalesSpec,
  SalesSpecKey,
} from './types';

export type NormalizeResult =
  | { ok: true; value: NormalizedSalesConfirm }
  | { ok: false; id: string; reason: string };

// types.ts 의 SALES_SPEC_KEYS 와 같은 목록(값 import 를 피하려고 여기 따로 — 바꾸면 같이)
const SPEC_NAMES: readonly SalesSpecKey[] = ['CPU', 'RAM', 'SSD', 'HDD', '그래픽', 'OS', '인치'];
const SPEC_ALIAS: Record<string, SalesSpecKey> = (() => {
  const m: Record<string, SalesSpecKey> = {};
  for (const k of SPEC_NAMES) m[k.toLowerCase()] = k;
  m.graphic = '그래픽';
  m.graphics = '그래픽';
  m.gpu = '그래픽';
  m.inch = '인치';
  m.inches = '인치';
  return m;
})();

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function qtyOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** 객체 안에서 확인서 목록 배열 찾기 — 이름(items/confirms/data)으로, 아니면 "배열인 값이 딱 하나"일 때 그것(구조로만, 칸 이름 추측 없음) */
function arrayIn(o: Record<string, unknown>): unknown[] | null {
  for (const k of ['items', 'confirms', 'data']) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  const arrays = Object.values(o).filter((v): v is unknown[] => Array.isArray(v));
  return arrays.length === 1 ? arrays[0] : null;
}

/**
 * 응답 → 확인서 목록. 배열이면 그대로, 객체면 arrayIn, 그래도 없으면 data/result 객체 한 단계 안에서 arrayIn.
 * 그 밖이면 null(=모양 다름). 목록 안 한 건마다 id·ver 검사는 normalizeSalesConfirm 이 함(없으면 그 건 건너뜀).
 */
export function extractRecords(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!isObj(body)) return null;
  const direct = arrayIn(body);
  if (direct) return direct;
  for (const k of ['data', 'result']) {
    const inner = body[k];
    if (isObj(inner)) {
      const got = arrayIn(inner);
      if (got) return got;
    }
  }
  return null;
}

// ───────── 응답 모양 요약(칸 이름·종류만 — 값은 절대 안 넣음) ─────────

/** 영문·숫자 꼴 칸 이름과 사양 칸 이름만 보여 줌. 그 밖(한글 회사명이 열쇠로 쓰인 경우 등)은 가림 */
const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$-]{0,40}$/;
function keyName(k: string): string {
  return SAFE_KEY.test(k) || (SPEC_NAMES as readonly string[]).includes(k) ? k : '(이름 가림)';
}

function typeTag(v: unknown): string {
  if (Array.isArray(v)) return `배열${v.length}`;
  if (v === null) return 'null';
  if (isObj(v)) return '객체';
  if (typeof v === 'string') return '글자';
  if (typeof v === 'number') return '숫자';
  if (typeof v === 'boolean') return '참거짓';
  return typeof v;
}

/** 여러 객체의 칸 이름 합집합 "이름:종류"(처음 본 값의 종류, 비어 있지 않은 값 우선) */
function unionKeys(objs: Record<string, unknown>[], limit = 40): string {
  const seen = new Map<string, string>();
  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      const prev = seen.get(k);
      if (prev === undefined || ((prev === 'null' || prev === '글자') && v !== null && v !== '')) seen.set(k, typeTag(v));
    }
  }
  if (seen.size > limit) return `칸 ${seen.size}개(이름 생략)`;
  return [...seen.entries()].map(([k, t]) => `${keyName(k)}:${t}`).join(', ');
}

/**
 * 받은 응답의 모양을 한 줄로(설계 §3-6 실측용 — 칸 이름·종류·건수만). 예:
 *   "객체 {ok:참거짓, rows:배열37} · 목록 37건 · 한 건 {id:글자, no:글자, ver:숫자, …} · items[] {cat:글자, …} · items[].spec {CPU:글자, …}"
 */
export function describeShape(body: unknown): string {
  const parts: string[] = [];
  if (Array.isArray(body)) parts.push(`배열${body.length}`);
  else if (isObj(body)) parts.push(`객체 {${unionKeys([body], 25)}}`);
  else parts.push(typeTag(body));
  if (isObj(body)) {
    for (const k of ['data', 'result']) {
      const inner = body[k];
      if (isObj(inner)) parts.push(`${k} {${unionKeys([inner], 25)}}`);
    }
  }

  const recs = extractRecords(body);
  if (!recs) {
    parts.push('목록 못 찾음');
    return parts.join(' · ').slice(0, 1500);
  }
  const objs = recs.filter(isObj).slice(0, 60);
  parts.push(`목록 ${recs.length}건${objs.length < Math.min(recs.length, 60) ? `(객체 아닌 것 섞임)` : ''}`);
  if (objs.length === 0) return parts.join(' · ').slice(0, 1500);
  parts.push(`한 건 {${unionKeys(objs)}}`);

  // id 모양(값 대신 종류·길이), ver 범위
  const ids = objs.map((o) => o.id);
  const idLens = [...new Set(ids.map((v) => (typeof v === 'string' ? v.length : -1)).filter((n) => n >= 0))].sort((a, b) => a - b);
  const uuidLike = ids.every((v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v));
  parts.push(`id ${typeTag(ids[0])}${idLens.length ? ` 길이 ${idLens.slice(0, 4).join('/')}` : ''}${uuidLike ? '(uuid 꼴)' : ''}`);
  const vers = objs.map((o) => Number(o.ver)).filter((n) => Number.isFinite(n));
  if (vers.length) parts.push(`ver ${Math.min(...vers)}~${Math.max(...vers)}`);

  // 한 단계 안: 객체 칸(contacts 등)과 객체 배열 칸(items 등), 그 안의 객체 칸(spec 등)
  const keys = new Set(objs.flatMap((o) => Object.keys(o)));
  for (const k of keys) {
    const vals = objs.map((o) => o[k]);
    const innerObjs = vals.filter(isObj);
    if (innerObjs.length) parts.push(`${keyName(k)} {${unionKeys(innerObjs, 25)}}`);
    const elems = vals.filter(Array.isArray).flat().filter(isObj).slice(0, 200);
    if (elems.length) {
      parts.push(`${keyName(k)}[] {${unionKeys(elems, 25)}}`);
      const sub = new Set(elems.flatMap((e) => Object.keys(e)));
      for (const k2 of sub) {
        const subObjs = elems.map((e) => e[k2]).filter(isObj);
        if (subObjs.length) parts.push(`${keyName(k)}[].${keyName(k2)} {${unionKeys(subObjs, 25)}}`);
      }
    }
  }
  return parts.join(' · ').slice(0, 1500);
}

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' / ISO / 'YYYY.MM.DD' / 'YYYY/MM/DD' → 'YYYY-MM-DD', 아니면 null. 시간대(Z·+hh:mm)가 붙은 ISO 는 한국 날짜로 */
function toDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    const k = new Date(t + 9 * 3600_000);
    return ymd(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate());
  }
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s])/);
  if (!m) return null;
  return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
}

function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const t = new Date(v > 1e11 ? v : v * 1000);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function specOf(v: unknown): SalesSpec {
  const out: SalesSpec = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    const name = SPEC_ALIAS[k.trim().toLowerCase()];
    const s = str(val);
    if (name && s && !out[name]) out[name] = s;
  }
  return out;
}

/** SPEC_NAMES·별칭 밖의 사양 칸 — 칸 이름 그대로(20자까지), 값 있는 것만, 최대 10개 */
function specExtraOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    const key = k.trim();
    if (!key || SPEC_ALIAS[key.toLowerCase()]) continue;
    const s = str(val);
    if (!s) continue;
    out[key.slice(0, 20)] = s;
    if (++n >= 10) break;
  }
  return out;
}

// ───────── 출력용 칸(2+3단계, developer D) — 영업 가져오기에 아직 없는 칸. hash(원문 기준)와는 무관 ─────────
// null = 응답에 칸이 없음(안 옴 → 종이에 빈칸, 가짜 ₩0·자동 체크 안 찍음 — D17), '' = 영업이 비워서 보냄(영업 출력과 같게)

/** 출력용 글자 칸: 없거나 null → null, 글자 → 앞뒤 공백 뗀 값, 숫자 → 글자, 그 밖(객체 등) → '' */
function printStr(o: Record<string, unknown>, k: string): string | null {
  if (!(k in o)) return null;
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return '';
}

/** 품목 월 렌탈료: 없거나 null → null, 숫자 → 그대로, 글자 → 영업 양식처럼 숫자만 읽음(못 읽으면 0 — 영업 출력도 ₩0) */
function rentOf(o: Record<string, unknown>): number | null {
  if (!('rent' in o)) return null;
  const v = o.rent;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return null;
}

/** 확인서 1면 계약·청구 요약 칸. 팩스·계산서메일·계약서메일은 연락처 묶음(contacts) 안에 올 수도 있어 거기도 봄 */
function printOf(raw: Record<string, unknown>): SalesPrintExtra {
  const contacts = isObj(raw.contacts) ? raw.contacts : {};
  const top = (k: string) => printStr(raw, k);
  const either = (k: string) => top(k) ?? printStr(contacts, k);
  const orderDate = top('orderDate');
  return {
    kind: top('kind'),
    months: top('months'),
    deposit: top('deposit'),
    payNote: top('payNote'),
    extra: top('extra'),
    orderDate: orderDate ? (toDate(orderDate) ?? orderDate) : orderDate,
    industry: top('industry'),
    statusNo: top('statusNo'),
    fax: either('fax'),
    taxMail: either('taxMail'),
    contractMail: either('contractMail'),
  };
}

function itemOf(v: unknown): SalesConfirmItem | null {
  if (!isObj(v)) return null;
  const extra = specExtraOf(v.spec);
  return {
    cat: str(v.cat) || '기타',
    model: str(v.model),
    maker: str(v.maker),
    state: str(v.state),
    qty: qtyOf(v.qty),
    spec: specOf(v.spec),
    ...(Object.keys(extra).length ? { specExtra: extra } : {}),
    place: str(v.place),
    rent: rentOf(v),
  };
}

function supplyOf(v: unknown): SalesConfirmSupply | null {
  if (!isObj(v)) return null;
  return { name: str(v.name), qty: qtyOf(v.qty), charge: str(v.charge), note: str(v.note), price: printStr(v, 'price') };
}

function contactsOf(v: unknown): SalesConfirmContacts {
  const c = isObj(v) ? v : {};
  return {
    manager: str(c.manager),
    resident: str(c.resident),
    payer: str(c.payer),
    contractor: str(c.contractor),
    phone: str(c.phone),
  };
}

/** 글자(키 포함) 안에 NUL 문자가 있는지 — Postgres jsonb·text 가 거절함 */
function hasNulChar(v: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (typeof v === 'string') return v.includes('\u0000');
  if (Array.isArray(v)) return v.some((x) => hasNulChar(x, depth + 1));
  if (isObj(v)) return Object.entries(v).some(([k, x]) => k.includes('\u0000') || hasNulChar(x, depth + 1));
  return false;
}

export function normalizeSalesConfirm(raw: unknown): NormalizeResult {
  if (!isObj(raw)) return { ok: false, id: '', reason: '객체가 아님' };
  const id = str(raw.id);
  if (!id) return { ok: false, id: '', reason: 'id 칸이 없음' };
  const verRaw = typeof raw.ver === 'number' ? raw.ver : typeof raw.ver === 'string' && raw.ver.trim() !== '' ? Number(raw.ver) : NaN;
  if (!Number.isFinite(verRaw)) return { ok: false, id, reason: 'ver 칸이 없거나 숫자가 아님' };
  // 표의 ver 는 integer — 범위 밖(예: 시각을 판 번호로 쓰는 경우)이면 그 건만 건너뜀(묶음 전체 저장 실패 방지)
  if (verRaw < 0 || verRaw > 2_147_483_647) return { ok: false, id, reason: 'ver 칸이 0~2147483647 범위 밖' };
  // Postgres 는 글자 안의 \u0000 을 받지 않음(jsonb·text) — 그 건만 건너뜀
  if (hasNulChar(raw)) return { ok: false, id, reason: '원문에 쓸 수 없는 글자(\\u0000)가 있음' };

  const items = (Array.isArray(raw.items) ? raw.items : []).map(itemOf).filter((x): x is SalesConfirmItem => x !== null);
  const supplies = (Array.isArray(raw.supplies) ? raw.supplies : [])
    .map(supplyOf)
    .filter((x): x is SalesConfirmSupply => x !== null);
  const hasReplace = raw.before !== undefined || raw.after !== undefined;

  return {
    ok: true,
    value: {
      id,
      docNo: str(raw.no),
      ver: Math.trunc(verRaw),
      type: str(raw.type),
      term: str(raw.term),
      savedAt: toIso(raw.savedAt),
      savedBy: str(raw.savedBy),
      salesRep: str(raw.sales),
      company: str(raw.company),
      address: str(raw.address),
      region: str(raw.region),
      deliveryDate: toDate(raw.deliveryDate),
      contacts: contactsOf(raw.contacts),
      special: str(raw.special),
      items,
      supplies,
      replaceInfo: hasReplace ? { before: raw.before ?? null, after: raw.after ?? null } : null,
      docUrl: str(raw.docUrl),
      inflow: str(raw.inflow),
      leaseNo: str(raw.leaseNo),
      reason: str(raw.reason),
      print: printOf(raw),
    },
  };
}

/** 키를 정렬한 JSON 문자열(해시용 — 키 순서가 달라도 같은 값이면 같은 문자열) */
export function stableStringify(raw: unknown): string {
  if (Array.isArray(raw)) return `[${raw.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  if (isObj(raw)) {
    const keys = Object.keys(raw)
      .filter((k) => raw[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(raw[k])}`).join(',')}}`;
  }
  if (typeof raw === 'number' && !Number.isFinite(raw)) return 'null';
  const s = JSON.stringify(raw);
  return s === undefined ? 'null' : s;
}
