/**
 * 계약 관리 — 구글시트(SW자산_갱신형 / SW자산_비갱신형) 줄을 앱 모양으로 바꾸는 순수 함수.
 * import 없음(Node 로 바로 돌려 볼 수 있게). 설계 docs/tasks/2026-11-20-contract-management.md §3-5, D9.
 * 비밀 칸(비갱신형 9 license_key · 10 account · 14 card / 갱신형 6 account · 7 admin_account)은 칸 하나 = 비밀 하나(1:1).
 * 2차인증(비갱신형 11)은 비밀이 아님 → seat.mfaNote 평문.
 */

export type SheetTab = 'renew' | 'perm';
export type SheetSecretField = 'license_key' | 'account' | 'admin_account' | 'card';
export type ParsedLicenseType = 'perpetual' | 'subscription' | 'free' | 'unknown';
export type ParsedTerm = '' | 'monthly' | 'yearly';
export type ParsedPayCycle = '' | 'monthly' | 'yearly' | 'once';

export type ParsedRow = {
  tab: SheetTab;
  sheetRow: number; // 시트 행 번호(1부터)
  vendorName: string; // 정해진 업체(없으면 '')
  guessedBy: 'name' | 'domain' | 'none'; // name=시트에 업체명 있음, domain=계정 도메인으로 짐작/묶음, none=모름
  domain: string; // 계정 도메인(소문자, 없으면 '')
  groupKey: string;
  product: string; // 정리된 상품명(빈 값이면 '')
  supplier: string;
  typeRaw: string;
  licenseType: ParsedLicenseType;
  term: ParsedTerm;
  payCycle: ParsedPayCycle;
  seat: {
    userName: string;
    dept: string;
    pcAssetCode: string;
    mfaNote: string;
    installedOn: string | null;
    purchasedOn: string | null;
    renewsOn: string | null;
    endsOn: string | null;
    status: string;
  };
  contract: { costNote: string; adminPortal: string; setupVendor: string };
  client: { salesOwner: string; itOwner: string; keyPerson: string; keyPhone: string };
  secrets: { field: SheetSecretField; plain: string }[]; // 값이 있는 칸만, 원문 그대로
  sourceRaw: Record<string, string>; // 비밀 칸 제외, 머리줄 이름 → 값
  seatSourceKey: string; // perm:<행> / renew:<행>
  dateWarnings: number;
};

export type ParsedTab = {
  tab: SheetTab;
  sheetRows: number; // 값 있는 줄
  blankRows: number; // 완전히 빈 줄
  dateWarnings: number;
  rows: ParsedRow[];
};

export type ParsedSheet = { renew: ParsedTab; perm: ParsedTab };

export class SheetHeaderError extends Error {}

// ── 작은 도구 ──────────────────────────────────────────────
function cell(row: string[], i: number): string {
  const v = i >= 0 ? row[i] : undefined;
  return v == null ? '' : String(v);
}
function has(v: string): boolean {
  return v.trim() !== '';
}
export function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/** 거래처 이름 키(lib/contracts/nameKey.ts 와 같은 규칙) — 묶음 키용 */
export function groupNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\(주\)|주식회사|\(유\)|유한회사/g, '')
    .replace(/[\s·.,\-_/()[\]]/g, '')
    .toLowerCase();
}
function stripWs(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 계정 칸("아이디 / 비번" 모양)에서 메일 도메인만 뽑음. 없으면 ''. 비밀번호 쪽은 보지 않음 */
export function extractDomain(v: string): string {
  const m = /@([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/i.exec(v);
  return m ? m[1].toLowerCase() : '';
}

// ── 날짜 4형식 ─────────────────────────────────────────────
/** YYYY-MM-DD / YY-MM-DD / YY. M. D / YYYY. MM. D → 'YYYY-MM-DD'. 빈 값 → {iso:null, ok:true}, 못 읽음 → {iso:null, ok:false} */
export function parseSheetDate(raw: string): { iso: string | null; ok: boolean } {
  const s = raw.trim();
  if (!s) return { iso: null, ok: true };
  const m = /^(\d{4}|\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/.exec(s);
  if (!m) return { iso: null, ok: false };
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return { iso: null, ok: false };
  const p = (n: number) => String(n).padStart(2, '0');
  return { iso: `${y}-${p(mo)}-${p(d)}`, ok: true };
}

// ── 유형 원문 7종 → 칸 ─────────────────────────────────────
export function mapLicenseType(raw: string, tab: SheetTab): { licenseType: ParsedLicenseType; term: ParsedTerm; payCycle: ParsedPayCycle } {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return { licenseType: tab === 'renew' ? 'subscription' : 'unknown', term: '', payCycle: '' };
  if (s.includes('영구')) return { licenseType: 'perpetual', term: '', payCycle: 'once' };
  if (s.includes('무료')) return { licenseType: 'free', term: '', payCycle: '' };
  if (/년 ?구독/.test(s) && /월 ?결제/.test(s)) return { licenseType: 'subscription', term: 'yearly', payCycle: 'monthly' };
  if (/연 ?구독/.test(s)) return { licenseType: 'subscription', term: 'yearly', payCycle: 'yearly' };
  if (/월 ?구독/.test(s)) return { licenseType: 'subscription', term: 'monthly', payCycle: 'monthly' };
  if (s.includes('구독')) return { licenseType: 'subscription', term: '', payCycle: '' };
  return { licenseType: 'unknown', term: '', payCycle: '' };
}

// ── 머리줄 → 칸 위치 ───────────────────────────────────────
type Spec = Record<string, [name: string, occurrence: number]>;

const PERM_SPEC: Spec = {
  supplier: ['매입처', 0],
  product: ['소프트웨어명', 0],
  vendorContract: ['업체명', 0],
  keyPerson: ['키맨성함', 0],
  keyPhone: ['키맨연락처', 0],
  sales: ['퍼스트영업담당자', 0],
  it: ['퍼스트전산담당자', 0],
  user: ['사용자', 0],
  licenseKey: ['라이선스키/ID', 0],
  master: ['마스터아이디및비번', 0],
  mfa: ['2차인증', 0],
  type: ['라이선스유형', 0],
  cost: ['비용', 0],
  card: ['월구독카드', 0],
  purchase1: ['구매날짜', 0],
  purchase2: ['구매날짜', 1],
  renews: ['만료/갱신일', 0],
  ends: ['종료일', 0],
  setup: ['초기세팅업체', 0],
  vendorUser: ['업체명', 1],
  dept: ['부서명', 0],
  name: ['이름', 0],
  pc: ['설치PC자산번호', 0],
  installed: ['날자', 0],
};
const RENEW_SPEC: Spec = {
  pcAsset: ['자산번호', 0],
  vendor: ['고객사', 0],
  admin: ['관리자', 0],
  orderer: ['발주자', 0],
  supplier: ['매입처', 0],
  userAcc: ['사용자계정', 0],
  adminAcc: ['관리자계정', 0],
  product: ['계약상품', 0],
  qty: ['수량', 0],
  start: ['시작일', 0],
  renews: ['갱신날짜', 0],
  status: ['상태', 0],
};

export function findColumns(header: string[], spec: Spec): Record<string, number> {
  const out: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, [name, occ]] of Object.entries(spec)) {
    let seen = 0;
    let at = -1;
    for (let i = 0; i < header.length; i++) {
      if (stripWs(cell(header, i)) === name) {
        if (seen === occ) {
          at = i;
          break;
        }
        seen++;
      }
    }
    if (at < 0) missing.push(occ > 0 ? `${name}(${occ + 1}번째)` : name);
    out[key] = at;
  }
  if (missing.length) throw new SheetHeaderError(`시트 칸 위치가 바뀌었어요 — 머리줄에서 못 찾음: ${missing.join(', ')}`);
  return out;
}

const SEAT_STATUS = ['사용중', '미배정', '회수', '해지', '만료'];

function headerNames(header: string[], skip: Set<number>): string[] {
  // 같은 이름이 또 나오면 "#2" 를 붙여 source_raw 키가 겹치지 않게
  const count: Record<string, number> = {};
  return header.map((h, i) => {
    const base = cleanText(h) || `칸${i + 1}`;
    count[base] = (count[base] ?? 0) + 1;
    return skip.has(i) ? '' : count[base] > 1 ? `${base}#${count[base]}` : base;
  });
}

function buildRaw(row: string[], names: string[]): Record<string, string> {
  const raw: Record<string, string> = {};
  for (let i = 0; i < row.length; i++) {
    const n = names[i];
    if (!n) continue;
    const v = cell(row, i);
    if (has(v)) raw[n] = v.trim();
  }
  return raw;
}

// ── 한 탭 읽기 ─────────────────────────────────────────────
type Pre = Omit<ParsedRow, 'vendorName' | 'guessedBy' | 'groupKey'> & { vendorNamed: string };

function parsePerm(values: string[][]): { pre: Pre[]; blank: number } {
  if (values.length < 2) throw new SheetHeaderError('시트 칸 위치가 바뀌었어요 — 비갱신형 머리줄(2행)이 없어요');
  const row1 = values[0];
  const header = values[1];
  const c = findColumns(header, PERM_SPEC);
  const secretCols = new Set([c.licenseKey, c.master, c.card]);
  const names = headerNames(header, secretCols);
  const portalHead = cleanText(cell(row1, 2));
  const pre: Pre[] = [];
  let blank = 0;
  for (let r = 2; r < values.length; r++) {
    const row = values[r] ?? [];
    if (!row.some((v) => has(String(v ?? '')))) {
      blank++;
      continue;
    }
    let dw = 0;
    const date = (i: number) => {
      const p = parseSheetDate(cell(row, i));
      if (!p.ok) dw++;
      return p.iso;
    };
    const purchased1 = date(c.purchase1);
    const purchased = purchased1 ?? date(c.purchase2);
    const product = cleanText(cell(row, c.product));
    const typeRaw = cleanText(cell(row, c.type));
    const t = mapLicenseType(typeRaw, 'perm');
    const vendorNamed = cleanText(cell(row, c.vendorContract)) || cleanText(cell(row, c.vendorUser));
    const secrets: ParsedRow['secrets'] = [];
    const pushSecret = (field: SheetSecretField, i: number) => {
      const v = cell(row, i);
      if (has(v)) secrets.push({ field, plain: v });
    };
    pushSecret('license_key', c.licenseKey);
    pushSecret('account', c.master);
    pushSecret('card', c.card);
    const adminPortal = portalHead && /microsoft|365|office|오피스/i.test(product) ? portalHead : '';
    const sheetRow = r + 1;
    pre.push({
      tab: 'perm',
      sheetRow,
      vendorNamed,
      domain: extractDomain(cell(row, c.master)),
      product,
      supplier: cleanText(cell(row, c.supplier)),
      typeRaw,
      licenseType: t.licenseType,
      term: t.term,
      payCycle: t.payCycle,
      seat: {
        userName: cleanText(cell(row, c.name)) || cleanText(cell(row, c.user)),
        dept: cleanText(cell(row, c.dept)),
        pcAssetCode: cell(row, c.pc).replace(/\s+/g, '').toUpperCase(),
        mfaNote: cell(row, c.mfa).trim(),
        installedOn: date(c.installed),
        purchasedOn: purchased,
        renewsOn: date(c.renews),
        endsOn: date(c.ends),
        status: '사용중',
      },
      contract: { costNote: cleanText(cell(row, c.cost)), adminPortal, setupVendor: cleanText(cell(row, c.setup)) },
      client: {
        salesOwner: cleanText(cell(row, c.sales)),
        itOwner: cleanText(cell(row, c.it)),
        keyPerson: cleanText(cell(row, c.keyPerson)),
        keyPhone: cleanText(cell(row, c.keyPhone)),
      },
      secrets,
      sourceRaw: buildRaw(row, names),
      seatSourceKey: `perm:${sheetRow}`,
      dateWarnings: dw,
    });
  }
  return { pre, blank };
}

function parseRenew(values: string[][]): { pre: Pre[]; blank: number } {
  if (values.length < 1) throw new SheetHeaderError('시트 칸 위치가 바뀌었어요 — 갱신형 머리줄(1행)이 없어요');
  const header = values[0];
  const c = findColumns(header, RENEW_SPEC);
  const secretCols = new Set([c.userAcc, c.adminAcc]);
  const names = headerNames(header, secretCols);
  const pre: Pre[] = [];
  let blank = 0;
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    if (!row.some((v) => has(String(v ?? '')))) {
      blank++;
      continue;
    }
    let dw = 0;
    const date = (i: number) => {
      const p = parseSheetDate(cell(row, i));
      if (!p.ok) dw++;
      return p.iso;
    };
    const secrets: ParsedRow['secrets'] = [];
    if (has(cell(row, c.userAcc))) secrets.push({ field: 'account', plain: cell(row, c.userAcc) });
    if (has(cell(row, c.adminAcc))) secrets.push({ field: 'admin_account', plain: cell(row, c.adminAcc) });
    const statusRaw = cleanText(cell(row, c.status));
    const raw = buildRaw(row, names);
    if (statusRaw && !SEAT_STATUS.includes(statusRaw)) raw['상태(원문)'] = statusRaw;
    const sheetRow = r + 1;
    const t = mapLicenseType('', 'renew');
    pre.push({
      tab: 'renew',
      sheetRow,
      vendorNamed: cleanText(cell(row, c.vendor)),
      domain: extractDomain(cell(row, c.userAcc)) || extractDomain(cell(row, c.adminAcc)),
      product: cleanText(cell(row, c.product)),
      supplier: cleanText(cell(row, c.supplier)),
      typeRaw: '',
      licenseType: t.licenseType,
      term: t.term,
      payCycle: t.payCycle,
      seat: {
        userName: '',
        dept: '',
        pcAssetCode: cell(row, c.pcAsset).replace(/\s+/g, '').toUpperCase(),
        mfaNote: '',
        installedOn: null,
        purchasedOn: date(c.start),
        renewsOn: date(c.renews),
        endsOn: null,
        status: SEAT_STATUS.includes(statusRaw) ? statusRaw : '사용중',
      },
      contract: { costNote: '', adminPortal: '', setupVendor: '' },
      client: { salesOwner: '', itOwner: cleanText(cell(row, c.admin)), keyPerson: '', keyPhone: '' },
      secrets,
      sourceRaw: raw,
      seatSourceKey: `renew:${sheetRow}`,
      dateWarnings: dw,
    });
  }
  return { pre, blank };
}

/** 업체 정하기: 시트에 업체명 → 없으면 같은 계정 도메인의 다른 줄 업체가 한 가지일 때만 짐작 → 아니면 도메인 묶음/업체 모름 */
function decideVendors(tab: SheetTab, pre: Pre[]): ParsedRow[] {
  const byDomain = new Map<string, Map<string, string>>(); // 도메인 → (업체 키 → 업체 이름)
  for (const p of pre) {
    if (!p.vendorNamed || !p.domain) continue;
    const m = byDomain.get(p.domain) ?? new Map<string, string>();
    m.set(groupNameKey(p.vendorNamed), p.vendorNamed);
    byDomain.set(p.domain, m);
  }
  return pre.map(({ vendorNamed, ...rest }) => {
    if (vendorNamed) {
      return { ...rest, vendorName: vendorNamed, guessedBy: 'name' as const, groupKey: `${tab}:n:${groupNameKey(vendorNamed)}` };
    }
    const cands = rest.domain ? byDomain.get(rest.domain) : undefined;
    if (cands && cands.size === 1) {
      const [key, name] = [...cands.entries()][0];
      return { ...rest, vendorName: name, guessedBy: 'domain' as const, groupKey: `${tab}:n:${key}` };
    }
    if (rest.domain) return { ...rest, vendorName: '', guessedBy: 'domain' as const, groupKey: `${tab}:d:${rest.domain}` };
    return { ...rest, vendorName: '', guessedBy: 'none' as const, groupKey: `${tab}:unknown` };
  });
}

/** 두 탭의 값(A1부터, 머리줄 포함)을 읽어 줄별로 정리. 머리줄이 바뀌었으면 SheetHeaderError */
export function parseSheets(renewValues: string[][], permValues: string[][]): ParsedSheet {
  const a = parseRenew(renewValues);
  const b = parsePerm(permValues);
  const mk = (tab: SheetTab, r: { pre: Pre[]; blank: number }): ParsedTab => {
    const rows = decideVendors(tab, r.pre);
    return { tab, sheetRows: rows.length, blankRows: r.blank, dateWarnings: rows.reduce((n, x) => n + x.dateWarnings, 0), rows };
  };
  return { renew: mk('renew', a), perm: mk('perm', b) };
}

// ── 묶음(미리보기용) ───────────────────────────────────────
export type GroupSummary = {
  groupKey: string;
  tab: SheetTab;
  sheetName: string;
  guessedBy: 'name' | 'domain' | 'none';
  domainHint: string;
  rows: number;
  products: { name: string; rows: number }[];
  secretCounts: Partial<Record<SheetSecretField, number>>;
};

export function summarizeGroups(sheet: ParsedSheet): GroupSummary[] {
  const map = new Map<string, { g: GroupSummary; names: Map<string, number>; prods: Map<string, number> }>();
  for (const tab of [sheet.renew, sheet.perm]) {
    for (const r of tab.rows) {
      let e = map.get(r.groupKey);
      if (!e) {
        e = {
          g: { groupKey: r.groupKey, tab: r.tab, sheetName: '', guessedBy: r.guessedBy, domainHint: '', rows: 0, products: [], secretCounts: {} },
          names: new Map(),
          prods: new Map(),
        };
        map.set(r.groupKey, e);
      }
      e.g.rows++;
      if (r.guessedBy === 'name') e.g.guessedBy = 'name';
      else if (r.guessedBy === 'domain' && !e.g.domainHint && !r.vendorName) e.g.domainHint = r.domain;
      if (r.vendorName) e.names.set(r.vendorName, (e.names.get(r.vendorName) ?? 0) + (r.guessedBy === 'name' ? 1 : 0));
      const pn = r.product || '(상품명 없음)';
      e.prods.set(pn, (e.prods.get(pn) ?? 0) + 1);
      for (const s of r.secrets) e.g.secretCounts[s.field] = (e.g.secretCounts[s.field] ?? 0) + 1;
    }
  }
  return [...map.values()].map(({ g, names, prods }) => ({
    ...g,
    sheetName: [...names.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '',
    products: [...prods.entries()].map(([name, rows]) => ({ name, rows })).sort((x, y) => y.rows - x.rows),
  }));
}

/** 이름 정리표용: 상품명·매입처가 몇 줄에 나오는지 */
export function countNames(sheet: ParsedSheet, which: 'product' | 'supplier'): { name: string; rows: number }[] {
  const m = new Map<string, number>();
  for (const tab of [sheet.renew, sheet.perm]) {
    for (const r of tab.rows) {
      const v = which === 'product' ? r.product : r.supplier;
      if (!v) continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  return [...m.entries()].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows - a.rows);
}

/** 비밀 칸 종류별 시트 개수(탭별) */
export function countSecrets(tab: ParsedTab): Partial<Record<SheetSecretField, number>> {
  const out: Partial<Record<SheetSecretField, number>> = {};
  for (const r of tab.rows) for (const s of r.secrets) out[s.field] = (out[s.field] ?? 0) + 1;
  return out;
}

/** 계약 상품 중복 방지 키 재료(client id 는 반영 때 붙임) */
export function contractSig(product: string, typeRaw: string, supplier: string): string {
  const n = (s: string) => groupNameKey(s);
  return `${n(product)}:${n(typeRaw)}:${n(supplier)}`;
}
