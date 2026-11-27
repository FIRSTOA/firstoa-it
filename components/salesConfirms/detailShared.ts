/**
 * 영업 확인서 상세 화면이 같이 쓰는 모양·도우미(순수 — 서버·브라우저 어디서나).
 * 차이(노란색) 표시는 SalesSlot.unackedDiffs·④ diff_ack 만 보고 그림 — 화면이 따로 비교하지 않음. unackedDiffs 는 서버(slots.buildSlotLines)가
 * 계산하고, 저장 직후엔 상세 화면이 **같은 순수 함수**(slots.unackedDiffsFor)로 그 칸만 다시 계산(2026-11-27 — 저장이 더는 확인을 겸하지 않음).
 */
import type {
  DiffField,
  DiffItem,
  SalesSlot,
  SalesSpec,
  SalesSpecKey,
  SalesUnitExtra,
  SalesUnitRow,
} from '@/lib/salesConfirms/types';
import type { ItemKind } from '@/lib/salesConfirms/itemKind';
import { fmtDateTime } from './format';

/** 기기 칸 저장에 보내는 바뀐 칸만(saveSalesUnit patch) */
export interface UnitPatch {
  assetId?: string;
  serial?: string;
  actualMaker?: string;
  actualModel?: string;
  /** 칸 전체 교체 — 빈 칸은 키를 빼고 보냄 */
  specOverride?: SalesSpec;
  note?: string;
  /** 소프트웨어 pc·user 만(ledgerPushed 는 서버가 지킴) */
  extra?: SalesUnitExtra;
  checks?: { label: string; on: boolean }[];
}

export interface SlotRef {
  itemIndex: number;
  slotKey: string;
  unitNo: number;
}

export type SaveUnitResult = { ok: true } | { ok: false; redo?: DiffItem[] };
export type SaveUnit = (ref: SlotRef, patch: UnitPatch) => Promise<SaveUnitResult>;

/** 같은 자산번호가 들어 있는 다른 확인서 */
export interface AssetUse {
  confirmId: string;
  docNo: string;
  company: string;
}

export type LookupAssetResult =
  | { ok: true; maker: string; model: string; serials: string[]; specHint: string; dupes: AssetUse[]; dupesError?: string }
  /** 못 찾아도 다른 확인서에 같은 자산번호가 있으면 dupes */
  | { ok: false; error: string; dupes?: AssetUse[]; dupesError?: string };
export type LookupAsset = (assetId: string, hint: string) => Promise<LookupAssetResult>;

/** 차이 확인 칸 이름 → 쉬운 말(소프트웨어는 모델명 대신 제품명) */
export function diffFieldLabel(field: DiffField, modelLabel = '모델명'): string {
  if (field === 'maker') return '제조사';
  if (field === 'model') return modelLabel;
  return field.slice('spec:'.length);
}

export interface FieldMark {
  /** need = 아직 확인 안 됨(노란색 + "확인이 필요해요"), ack = 확인함(연한 노란색 + 누가 언제) */
  state: 'need' | 'ack';
  /** 영업 요청 값 */
  sales: string;
  text: string;
}

function fieldValue(u: SalesUnitRow, f: DiffField): string {
  if (f === 'maker') return u.actualMaker;
  if (f === 'model') return u.actualModel;
  return u.specOverride[f.slice('spec:'.length) as SalesSpecKey] ?? '';
}

/** 칸별 노란 표시 — 확인 안 된 것(서버 unackedDiffs) + 이미 확인한 것(diff_ack 쌍이 지금 값과 같을 때) */
export function slotMarks(slot: SalesSlot): Partial<Record<DiffField, FieldMark>> {
  const marks: Partial<Record<DiffField, FieldMark>> = {};
  const u = slot.unit;
  if (u) {
    const acks = u.diffAck ?? {};
    for (const key of Object.keys(acks) as DiffField[]) {
      const a = acks[key];
      if (!a) continue;
      const cur = fieldValue(u, key).trim();
      if (cur && cur === a.actual.trim()) {
        marks[key] = { state: 'ack', sales: a.sales, text: `✓ ${a.by || '누군가'} ${fmtDateTime(a.at)} 확인` };
      }
    }
  }
  for (const d of slot.unackedDiffs) {
    marks[d.field] = { state: 'need', sales: d.sales, text: '영업 요청과 달라요 — 인쇄할 때 한 번에 확인해요' };
  }
  return marks;
}

/** 사양 칸 초안(문자열 지도) → 저장 모양(빈 칸은 뺌) */
export function cleanSpec(d: Record<string, string>): SalesSpec {
  const out: SalesSpec = {};
  for (const k of Object.keys(d)) {
    const v = (d[k] ?? '').trim();
    if (v) out[k as SalesSpecKey] = v;
  }
  return out;
}

export function specToDraft(s: SalesSpec | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const k of Object.keys(s)) out[k] = (s[k as SalesSpecKey] ?? '').trim();
  return out;
}

/** 초안 둘이 같은지(공백·빈 칸 무시) */
export function sameDraftSpec(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(cleanSpec(a));
  const kb = Object.keys(cleanSpec(b));
  if (ka.length !== kb.length) return false;
  const ca = cleanSpec(a);
  const cb = cleanSpec(b);
  return ka.every((k) => ca[k as SalesSpecKey] === cb[k as SalesSpecKey]);
}

export const slotDomId = (itemIndex: number, unitNo: number) => `sc-slot-${itemIndex}-${unitNo}`;

/** 칸을 채운 것으로 셀지 — 장비·모니터는 자산번호, 유지보수는 자산번호 또는 시리얼 */
export function unitFilled(kind: ItemKind, u: SalesUnitRow | null): boolean {
  if (!u) return false;
  if (kind === 'maintenance') return !!(u.assetId.trim() || u.serial.trim());
  return !!u.assetId.trim();
}

/** "1시간 40분" 꼴 */
export function minutesText(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 60)}시간`;
}
