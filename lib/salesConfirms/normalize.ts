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

/** 배열이면 그대로, 객체면 items/confirms/data 중 배열인 키 하나. 그 밖이면 null(=모양 다름) */
export function extractRecords(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (isObj(body)) {
    for (const k of ['items', 'confirms', 'data']) {
      const v = body[k];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
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

function itemOf(v: unknown): SalesConfirmItem | null {
  if (!isObj(v)) return null;
  return {
    cat: str(v.cat) || '기타',
    model: str(v.model),
    maker: str(v.maker),
    state: str(v.state),
    qty: qtyOf(v.qty),
    spec: specOf(v.spec),
    place: str(v.place),
  };
}

function supplyOf(v: unknown): SalesConfirmSupply | null {
  if (!isObj(v)) return null;
  return { name: str(v.name), qty: qtyOf(v.qty), charge: str(v.charge), note: str(v.note) };
}

function contactsOf(v: unknown): SalesConfirmContacts {
  const c = isObj(v) ? v : {};
  return { manager: str(c.manager), resident: str(c.resident), payer: str(c.payer), phone: str(c.phone) };
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
