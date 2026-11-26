/**
 * 품목 종류 판정 + 종류별 기기 칸 규칙 (순수 — import 없음, Node 로 바로 돌려 볼 수 있음).
 * 설계 docs/tasks/2026-11-26-sales-confirm-import.md §3-4 표(D18·D19·D27). 칸 계산(slots.ts)·화면·출력(printFill.ts)이 같이 씀.
 *
 * 위에서부터 첫 번째로 맞는 것:
 *   ① 유지보수(그래서 'PC유지보수'는 장비가 아님) → ② 소프트웨어 → ③ 모니터 → ④ 장비 → ⑤ 기타
 */

export type ItemKind = 'device' | 'monitor' | 'maintenance' | 'software' | 'other';

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  device: '장비',
  monitor: '모니터',
  maintenance: '유지보수',
  software: '소프트웨어',
  other: '기타',
};

export function itemKind(cat: string | null | undefined): ItemKind {
  const c = String(cat ?? '').trim();
  if (/유지보수/.test(c)) return 'maintenance';
  // S/W·SW 는 영어 낱말 속(Switch 등)에 걸리지 않게 앞뒤가 영문자가 아닐 때만
  if (/소프트웨어|라이선스|라이센스/.test(c) || /(^|[^A-Za-z])S\/?W([^A-Za-z]|$)/i.test(c)) return 'software';
  if (/모니터/.test(c)) return 'monitor';
  if (/데스크탑|데스크톱|노트북|맥북|태블릿|아이패드|본체|올인원|워크스테이션/.test(c) || /(^|[^A-Za-z])PC([^A-Za-z]|$)/i.test(c)) {
    return 'device';
  }
  return 'other';
}

/**
 * 기기 칸 입력 칸 이름(화면 순서 = 이 배열 순서, D18 "제조사 · 모델명 · 자산번호 · 시리얼 · 출고사양").
 *   maker·model = ④ actual_maker·actual_model(소프트웨어는 model = 제품명), asset = ④ asset_id, serial = ④ serial,
 *   spec = ④ spec_override(칸별), pc·user = ④ extra.pc·extra.user(소프트웨어), licenseKey = 계약관리 잠금 칸(④ 에 저장 안 함), note = ④ note
 */
export type UnitInputField = 'maker' | 'model' | 'asset' | 'serial' | 'spec' | 'pc' | 'user' | 'licenseKey' | 'note';

/** 영업 요청과 다르면 저장할 때 확인 창(D27) — 비교 대상 칸 묶음 */
export type DiffFieldGroup = 'maker' | 'model' | 'spec';

export interface ItemKindRule {
  kind: ItemKind;
  /** 수량 0(또는 이상한 값)일 때 1칸 — 유지보수·소프트웨어 */
  zeroAsOne: boolean;
  /** 입력 칸(이 순서로 그림). spec 은 장비 중 hasSpec(cat) 품목만 실제로 보임(salesForm/confirm.ts hasSpec) */
  fields: readonly UnitInputField[];
  /** 차이 확인(D27) 대상 — 영업 요청 값이 비어 있지 않은 칸만 실제로 비교 */
  diffFields: readonly DiffFieldGroup[];
  /** 기기별 출고 체크리스트 묶음(it_prep_photo_items.grp) — null = 없음. 장비 중 태블릿은 화면이 null 로 봄 */
  checkGroup: string | null;
  /** 목록·상세 진행 "자산 n/m" 에 셈 — 유지보수는 자산번호 또는 시리얼이 있으면 채운 것 */
  countsProgress: boolean;
}

export const ITEM_KIND_RULES: Record<ItemKind, ItemKindRule> = {
  device: {
    kind: 'device',
    zeroAsOne: false,
    fields: ['maker', 'model', 'asset', 'serial', 'spec', 'note'],
    diffFields: ['maker', 'model', 'spec'],
    checkGroup: '데스크탑&노트북',
    countsProgress: true,
  },
  monitor: {
    kind: 'monitor',
    zeroAsOne: false,
    fields: ['maker', 'model', 'asset', 'serial', 'note'],
    diffFields: ['maker', 'model'],
    checkGroup: '모니터',
    countsProgress: true,
  },
  maintenance: {
    kind: 'maintenance',
    zeroAsOne: true,
    // 대마다 대상 기기(사용자 답 "유지보수도 대마다") — 우리 장비가 아니면 시리얼만
    fields: ['asset', 'serial', 'note'],
    diffFields: [],
    checkGroup: null,
    countsProgress: true,
  },
  software: {
    kind: 'software',
    zeroAsOne: true,
    // 칸 하나 = 라이선스 하나 = 계약관리 좌석 하나(D28). model = 제품명
    fields: ['model', 'maker', 'pc', 'user', 'licenseKey', 'note'],
    diffFields: ['maker', 'model'],
    checkGroup: null,
    countsProgress: false,
  },
  other: {
    kind: 'other',
    zeroAsOne: false,
    fields: ['maker', 'model', 'asset', 'serial', 'note'],
    diffFields: ['maker', 'model'],
    checkGroup: null,
    countsProgress: false,
  },
};

/** 품목 줄 하나의 기기 칸 수 — qty 를 0~50 으로 자르고, 유지보수·소프트웨어는 0이면 1 */
export function unitCountFor(kind: ItemKind, qty: number | null | undefined): number {
  const n = Math.max(0, Math.min(50, Math.floor(Number(qty) || 0)));
  return n === 0 && ITEM_KIND_RULES[kind].zeroAsOne ? 1 : n;
}

/** 태블릿은 장비지만 기기별 체크리스트 없음 */
export function checkGroupFor(kind: ItemKind, cat: string | null | undefined): string | null {
  if (kind === 'device' && /태블릿|아이패드/.test(String(cat ?? ''))) return null;
  return ITEM_KIND_RULES[kind].checkGroup;
}
