/**
 * 사용설명서 목록 — 묶음(위 메뉴와 같음)과 순서(왼쪽 메뉴와 같음).
 * 새 화면을 만들면: lib/manual/docs/ 의 알맞은 파일에 ManualDoc 하나 추가 → 아래 ORDER 에 key 를 넣음.
 * ORDER 에 없는 문서는 그 묶음 맨 끝에 붙음. key·섹션 id 가 겹치면 빌드가 멈춤(아래 검사).
 */
import { BASIC_DOCS } from './docs/basic';
import { INVENTORY_DOCS } from './docs/inventory';
import { RENTAL_CONTRACT_DOCS } from './docs/rentalContract';
import { SHIPPING_DOCS } from './docs/shipping';
import { STOCK_DOCS } from './docs/stock';
import type { ManualDoc, ManualGroupKey } from './types';

export const MANUAL_GROUPS: { key: ManualGroupKey; label: string }[] = [
  { key: 'start', label: '기본' },
  { key: 'inventory', label: '재고관리' },
  { key: 'rental', label: '임대·청구' },
  { key: 'contract', label: '계약관리' },
];

/** 왼쪽 메뉴 순서 그대로 */
const ORDER = [
  'start',
  'home',
  'calendar',
  'inventory',
  'receiving',
  'dispatch',
  'shipment-prep',
  'confirm-form',
  'sales',
  'asset-history',
  'stocktake',
  'inventory-status',
  'consumables',
  'rentals',
  'billing',
  'contracts-sw',
  'contracts-pcm',
];

const ALL: ManualDoc[] = [...BASIC_DOCS, ...INVENTORY_DOCS, ...SHIPPING_DOCS, ...STOCK_DOCS, ...RENTAL_CONTRACT_DOCS];

function check(docs: ManualDoc[]): void {
  const keys = new Set<string>();
  for (const d of docs) {
    if (!/^[a-z0-9-]+$/.test(d.key)) throw new Error(`사용설명서 key 형식이 틀렸어요: "${d.key}"`);
    if (keys.has(d.key)) throw new Error(`사용설명서 key 가 겹쳐요: "${d.key}"`);
    keys.add(d.key);
    const ids = new Set<string>(['highlights']);
    for (const s of d.sections) {
      for (const id of [s.id, ...(s.sub ?? []).map((x) => x.id)]) {
        if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`사용설명서 "${d.key}" 섹션 id 형식이 틀렸어요: "${id}"`);
        if (ids.has(id)) throw new Error(`사용설명서 "${d.key}" 섹션 id 가 겹쳐요: "${id}"`);
        ids.add(id);
      }
    }
  }
}

function sortDocs(docs: ManualDoc[]): ManualDoc[] {
  const rank = (d: ManualDoc) => {
    const i = ORDER.indexOf(d.key);
    return i === -1 ? ORDER.length : i;
  };
  const groupRank = (d: ManualDoc) => MANUAL_GROUPS.findIndex((g) => g.key === d.group);
  return [...docs].sort((a, b) => groupRank(a) - groupRank(b) || rank(a) - rank(b));
}

check(ALL);

export const MANUAL_DOCS: ManualDoc[] = sortDocs(ALL);

/** /manual (주소에 화면 이름이 없을 때) 보여 줄 설명서 */
export const DEFAULT_MANUAL_KEY = MANUAL_DOCS[0]?.key ?? 'start';

export function getManualDoc(key: string): ManualDoc | undefined {
  return MANUAL_DOCS.find((d) => d.key === key);
}

export function manualGroupLabel(key: ManualGroupKey): string {
  return MANUAL_GROUPS.find((g) => g.key === key)?.label ?? '';
}

/** 왼쪽 목록에 필요한 것만(본문은 브라우저로 안 보냄) */
export type ManualDocMeta = Pick<ManualDoc, 'key' | 'group' | 'title' | 'icon' | 'summary' | 'updated'>;

export function manualDocMetas(): ManualDocMeta[] {
  return MANUAL_DOCS.map(({ key, group, title, icon, summary, updated }) => ({ key, group, title, icon, summary, updated }));
}
