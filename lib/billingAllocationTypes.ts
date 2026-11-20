/**
 * 청구 "자산번호 확인"(임대 건 단위 지정) — 화면과 서버 액션이 주고받는 모양(계약).
 * 설계: docs/tasks/2026-11-19-billing-allocation.md (§3-5, §8 팀장 결정이 우선).
 * 브라우저·서버 둘 다 import 하므로 server-only 가 아니고, 값은 없이 타입만 둔다.
 */
import type { BillingLine } from '@/lib/billing';

/** 추천 번호 — 사람이 확정해야 저장됨(자동 확정 없음) */
export type AllocationSuggestion = {
  assetId: string;
  /** rental_serial = 같은 시리얼의 다른 임대 건 · sibling_line = 같은 임대 건에서 이미 확정된 줄 · inventory_serial = IT재고 시리얼 일치 */
  source: 'rental_serial' | 'sibling_line' | 'inventory_serial';
  /** 사람이 읽을 출처 설명(예: "같은 시리얼 — 임대리스트 ○○상사 2024-03") */
  detail: string;
};

/** "자산번호 확인" 목록의 한 줄 = 임대 건 하나(works assets.id = it_rental_list.sheet_row) */
export type AllocationGroup = {
  rentalSheetRow: number;
  vendorName: string;
  siteName: string;
  item: string;
  manufacturer: string;
  modelName: string;
  serialNumber: string;
  contractDate: string;
  endDate: string;
  rentalStatus: string;
  firstMonth: string; // 'YYYY-MM'
  lastMonth: string; // 'YYYY-MM'
  lineCount: number;
  amountSum: number; // 취소 제외
  suggestions: AllocationSuggestion[];
};

/** 지정 상태: 적용 중 / works 에도 같은 번호 / works 와 다름(works 번호로 집계 중) / 임대 건 없어짐 */
export type AssignmentState = 'active' | 'works_same' | 'works_differs' | 'rental_gone';

/** "지정한 것" 목록의 한 줄 */
export type RentalAssignment = {
  rentalSheetRow: number;
  assetId: string;
  assignedBy: string;
  createdAt: string;
  vendorName: string;
  siteName: string;
  modelName: string;
  serialNumber: string;
  /** 임대리스트(works)에 지금 적힌 자산번호 — 비어 있으면 '' */
  worksAssetCode: string;
  state: AssignmentState;
};

/** 위 요약 숫자 — rentals = 자산번호 없는 임대 건 수, orphanLines = 임대 건 모르는 청구 줄 수, lines = 확인 필요 줄 전체 */
export type ReviewSummary = { rentals: number; orphanLines: number; lines: number };

export type AllocationReview = {
  summary: ReviewSummary;
  groups: AllocationGroup[];
  /** 임대 건을 모르는 확인 필요 줄 — 줄마다 지정(resolveBillingAllocation) */
  orphanLines: BillingLine[];
  assignments: RentalAssignment[];
  /** it_rental_asset_assignments 표가 아직 없음(SQL 미실행) */
  tableMissing: boolean;
};

export type BillingView = 'lines' | 'review' | 'assigned';
