/**
 * 영업 요청 값 ↔ 출고 값 "같다고 보는 기준" (설계 §3-10, D27) — 순수 함수, 실행 import 없음(import type 만 → Node 로 바로 돌려 봄).
 * 화면(차이 확인 창)·서버 저장 검사(salesDetailActions)·목록 "다시 확인 필요"(slots)·출력(printFill, developer D)이 모두 이 한 곳을 씀.
 *
 * 기준:
 *   - 앞뒤 공백·대소문자·띄어쓰기·하이픈 무시(전각 글자는 NFKC 로 반각)
 *   - 용량 칸(RAM·SSD·HDD): 숫자+단위로 맞춤 — 16GB = 16G = 16 / 1TB = 1T = 1000GB = 1024GB, 칸 이름(SSD 512GB) 앞뒤 글자는 뗌
 *   - 인치: 숫자만(24인치 = 24" = 24) — 숫자가 둘 이상이면 글자 비교
 *   - 그 밖(CPU·그래픽·OS·제조사·모델명): 글자 비교 → i5 와 i5-12400 은 다름
 *   - "없음" 꼴(X·-·없음·무·none·N/A)은 서로 같음
 *   - **애매하면 다름**(한 번 더 묻는 쪽이 안전 — 너무 자주 뜨는 칸이 생기면 여기서 넓힘)
 * 비교하는 칸: 영업 요청 값이 비어 있지 않고 출고 값도 비어 있지 않은 칸만(빈 요청 = 요청 없음, 빈 출고 = 출고 값 없음 → 안 물음).
 */
import type { DiffField, DiffItem, SalesConfirmItem, SalesSpec, SalesSpecKey } from './types';
import type { ItemKind } from './itemKind';

// types.ts 의 SALES_SPEC_KEYS 와 같은 목록·순서(값 import 를 피하려고 여기 따로 — 바꾸면 같이)
const SPEC_ORDER: readonly SalesSpecKey[] = ['CPU', 'RAM', 'SSD', 'HDD', '그래픽', 'OS', '인치'];
const CAPACITY_KEYS: readonly string[] = ['RAM', 'SSD', 'HDD'];

// itemKind.ts ITEM_KIND_RULES[kind].diffFields 와 같게(값 import 를 피하려고 여기 따로 — 바꾸면 같이)
const DIFF_GROUPS: Record<ItemKind, readonly ('maker' | 'model' | 'spec')[]> = {
  device: ['maker', 'model', 'spec'],
  monitor: ['maker', 'model'],
  maintenance: [],
  software: ['maker', 'model'],
  other: ['maker', 'model'],
};

/** 글자 비교용: NFKC · 소문자 · 공백·하이픈 제거 */
export function normText(v: string | null | undefined): string {
  return String(v ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s ​]+/g, '')
    .replace(/[-‐-―−－]+/g, '');
}

const NONE_RE = /^(x|없음|무|none|n\/a|na|미장착|미포함)$/;
/** "없음" 꼴 — X·없음·무·none·N/A, 또는 하이픈만(-·—) */
function isNone(raw: string): boolean {
  const t = String(raw ?? '').trim();
  if (!t) return false;
  if (/^[-‐-―−－]+$/.test(t)) return true;
  return NONE_RE.test(normText(t));
}

/**
 * 용량 → 비교용 열쇠. 1000GB 이상이면서 1000 또는 1024 로 나누어떨어지면 TB 로 바꿈(1TB = 1000GB = 1024GB).
 * 숫자+단위 꼴이 아니면 null(→ 글자 비교).
 */
function capacityKey(n: string, field: string): string | null {
  // 칸 이름이 값 앞뒤에 붙은 경우(SSD512GB, RAM16G, 메모리 16GB) 뗌
  let s = n;
  const names = field === 'RAM' ? ['ram', '메모리', 'ddr4', 'ddr5', 'ddr3'] : field === 'SSD' ? ['ssd', 'nvme', 'm.2', 'm2'] : ['hdd'];
  for (const name of names) {
    if (s.startsWith(name)) s = s.slice(name.length);
    if (s.endsWith(name)) s = s.slice(0, s.length - name.length);
  }
  const m = /^(\d+(?:\.\d+)?)(tb|t|테라|gb|g|기가|기가바이트|테라바이트)?$/.exec(s);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;
  const unit = m[2] ?? '';
  if (/^(tb|t|테라|테라바이트)$/.test(unit)) return `${num}tb`;
  // GB(또는 단위 없음)
  if (num >= 1000) {
    if (num % 1000 === 0) return `${num / 1000}tb`;
    if (num % 1024 === 0) return `${num / 1024}tb`;
  }
  return `${num}gb`;
}

/** capacityKey 결과("512gb"·"1tb") → GB 숫자(1TB = 1000GB). 이상하면 0 */
function capacityGb(key: string): number {
  const m = /^(\d+(?:\.\d+)?)(tb|gb)$/.exec(key);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'tb' ? n * 1000 : n;
}

/** 인치 → 숫자 하나(24인치·24"·24inch·24형). 숫자가 없거나 둘 이상이면 null */
function inchKey(n: string): string | null {
  const nums = n.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 1) return null;
  const rest = n.replace(nums[0], '');
  if (rest && !/^("|''|”|″|′′|인치|inch|inches|in|형)$/.test(rest)) return null;
  return String(Number(nums[0]));
}

// ───────── 제조사·모델명(2026-11-27 사용자 신고: 영업 "조립"·IT재고 "조립PC", 영업 모델 "A5고사데"·IT재고 "데스크탑" 이 다르다고 확인 창) ─────────

/** 제조사 다른 이름 → 같은 열쇠(정규화 뒤 글자). 회사 꼬리(전자·컴퓨터·PC·(주))를 뗀 뒤 찾음 */
const MAKER_ALIAS: Record<string, string> = {
  삼성: 'samsung', samsung: 'samsung',
  엘지: 'lg', lg: 'lg',
  레노버: 'lenovo', lenovo: 'lenovo',
  델: 'dell', dell: 'dell',
  에이치피: 'hp', hp: 'hp', hewlettpackard: 'hp',
  애플: 'apple', apple: 'apple',
  에이수스: 'asus', 아수스: 'asus', asus: 'asus',
  에이서: 'acer', acer: 'acer',
  마이크로소프트: 'microsoft', ms: 'microsoft', microsoft: 'microsoft',
  한성: 'hansung', hansung: 'hansung',
  조립: '조립', 조립형: '조립',
};

/** 제조사 비교 열쇠 — "조립PC"="조립", "삼성전자"="SAMSUNG", "LG전자"="엘지" */
export function makerKey(v: string | null | undefined): string {
  let s = normText(v).replace(/\(주\)|㈜|주식회사|corporation|corp\.?|inc\.?|co\.,?ltd\.?|ltd\.?/g, '');
  if (MAKER_ALIAS[s]) return MAKER_ALIAS[s];
  for (const tail of ['전자', '컴퓨터', 'computer', 'pc', 'electronics']) {
    if (s.length > tail.length && s.endsWith(tail)) {
      s = s.slice(0, s.length - tail.length);
      break;
    }
  }
  return MAKER_ALIAS[s] ?? s;
}

/** 모델명 자리에 적힌 종류 이름(모델 정보 없음) — IT재고 조립PC 는 모델명 칸이 "데스크탑" */
const GENERIC_MODEL_RE = /^(데스크탑|데스크톱|desktop|노트북|notebook|laptop|모니터|monitor|pc|본체|조립pc|조립|컴퓨터|미니pc|올인원|일체형pc|일체형|태블릿|tablet)$/;
export function isGenericModel(v: string | null | undefined): boolean {
  const n = normText(v);
  return !!n && GENERIC_MODEL_RE.test(n);
}

/** 이 칸에서 두 값을 같다고 볼지(§3-10). 둘 다 비면 같음, 하나만 비면 다름 */
export function sameSpecValue(field: DiffField, a: string, b: string): boolean {
  const na = normText(a);
  const nb = normText(b);
  if (na === nb) return true;
  if (isNone(a) && isNone(b)) return true;
  if (!na || !nb) return false;
  // 제조사: 다른 이름·회사 꼬리 무시
  if (field === 'maker') return makerKey(a) === makerKey(b);
  // 모델명: 한쪽이 종류 이름뿐이면(모델 정보 없음) 다르다고 안 봄
  if (field === 'model' && (isGenericModel(a) || isGenericModel(b))) return true;
  // 모델명: 한쪽이 다른 쪽을 6글자 이상 그대로 품으면 같은 모델("NT751XHD" ⊂ "NT751XHD-KR735", "삼성 갤럭시북5 NT751XHD" ⊃ "NT751XHD")
  if (field === 'model') {
    const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
    if (short.length >= 6 && long.includes(short)) return true;
  }
  if (field.startsWith('spec:')) {
    const key = field.slice('spec:'.length);
    if (CAPACITY_KEYS.includes(key)) {
      const ka = capacityKey(na, key);
      const kb = capacityKey(nb, key);
      if (ka !== null && kb !== null) {
        if (ka === kb) return true;
        // SSD·HDD 는 같은 급이면 같음 — 영업 "500GB" ↔ IT재고 "512", 250↔256·240↔256·120↔128·1TB↔1024(2026-11-27 사용자: "제대로 넣으면 동일 사양")
        // 7% 안(512 대 500 = 2.3%, 256 대 240 = 6.3%, 256 대 512 는 다름). RAM 은 정확히.
        if (key !== 'RAM') {
          const ga = capacityGb(ka);
          const gb = capacityGb(kb);
          if (ga > 0 && gb > 0 && Math.abs(ga - gb) / Math.max(ga, gb) <= 0.07) return true;
        }
        return false;
      }
      return false;
    }
    // CPU: "세대"·"gen" 꼬리 무시(I5-12세대 = I5-12)
    if (key === 'CPU') return na.replace(/세대|gen|th$/g, '') === nb.replace(/세대|gen|th$/g, '');
    if (key === '인치') {
      const ka = inchKey(na);
      const kb = inchKey(nb);
      if (ka !== null && kb !== null) return ka === kb;
      return false;
    }
  }
  return false;
}

/**
 * 영업 요청과 다른 칸 목록(확인 여부와 상관없이 지금 다른 것 전부). 순서 = 제조사 · 모델명 · 사양(CPU→인치).
 * 종류별 비교 칸은 itemKind 규칙(유지보수는 없음, 사양은 장비만). sales·actual 은 앞뒤 공백만 뗀 원래 글자(화면 표시용).
 */
export function diffsFor(
  kind: ItemKind,
  item: SalesConfirmItem,
  actual: { maker: string; model: string; spec: SalesSpec },
): DiffItem[] {
  const groups = DIFF_GROUPS[kind] ?? [];
  const out: DiffItem[] = [];
  const push = (field: DiffField, salesRaw: unknown, actualRaw: unknown) => {
    const sales = typeof salesRaw === 'string' ? salesRaw.trim() : '';
    const act = typeof actualRaw === 'string' ? actualRaw.trim() : '';
    if (!sales || !act) return;
    if (!sameSpecValue(field, sales, act)) out.push({ field, sales, actual: act });
  };
  if (groups.includes('maker')) push('maker', item?.maker, actual?.maker);
  if (groups.includes('model')) push('model', item?.model, actual?.model);
  if (groups.includes('spec')) {
    const salesSpec = (item?.spec ?? {}) as SalesSpec;
    const actSpec = (actual?.spec ?? {}) as SalesSpec;
    for (const k of SPEC_ORDER) push(`spec:${k}`, salesSpec[k], actSpec[k]);
  }
  return out;
}
