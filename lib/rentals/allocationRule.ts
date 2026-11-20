/**
 * firstoa-works 청구 줄 하나의 자산번호를 정하는 규칙(반영·대조 때 app/rentals/actions.ts buildSyncPlan 이 줄마다 부름).
 * 설계: docs/tasks/2026-11-19-billing-allocation.md §8-1 — 위에서부터 먼저 맞는 것.
 *
 *   ① C(works 자산번호) 있음                         → C, confirmed           reason 'works'
 *      (지정표 A 가 있고 A≠C 면 conflict=true — works 를 따르되 지정은 지우지 않음)
 *   ② R(임대 건) 있음 + A(지정표[R]) 있음             → A, confirmed           reason 'assignment'
 *   ③ R 없음 + P(우리 DB 같은 줄)가 confirmed·자산번호 X 있음·P 의 임대 건도 없음
 *                                                    → X 유지, confirmed      reason 'kept'
 *      ("임대 건 모르는 줄"을 사람이 줄 단위로 지정한 값만 지킴)
 *   ④ 그 밖                                          → null, needs_review     reason 'none'
 *
 * DB·외부 호출 없는 순수 함수. import 없음 + 지울 수 있는 TypeScript 문법만(enum·namespace 없음) —
 * Node 24 가 이 파일을 바로 불러 시나리오를 돌려 볼 수 있게.
 */

export type AllocationPrev = {
  assetId: string | null;
  allocationStatus: string;
  rentalSheetRow: number | null;
};

export type AllocationInput = {
  /** C — works 자산번호(works assets.asset_code). 없으면 null */
  worksCode: string | null;
  /** R — 임대 건(works assets.id = it_rental_list.sheet_row). 임대리스트에 없으면 null */
  rentalSheetRow: number | null;
  /** A — 지정표(it_rental_asset_assignments)[R]. 없으면 null */
  assignment: string | null;
  /** P — 우리 DB 에 이미 있는 같은 줄(처음 들어오는 줄이면 null) */
  prev: AllocationPrev | null;
};

export type AllocationReason = 'works' | 'assignment' | 'kept' | 'none';

export type AllocationDecision = {
  assetId: string | null;
  status: 'confirmed' | 'needs_review';
  reason: AllocationReason;
  /** works 번호와 우리 지정이 다름(①에서만 true) */
  conflict: boolean;
};

/** 빈 값·공백만 있는 값은 "없음" */
function clean(v: string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

function hasRow(v: number | null | undefined): boolean {
  return typeof v === 'number';
}

export function decideAllocation(input: AllocationInput): AllocationDecision {
  const c = clean(input.worksCode);
  const rentalKnown = hasRow(input.rentalSheetRow);
  // A 는 지정표[R] — 임대 건을 모르면 지정도 없음
  const a = rentalKnown ? clean(input.assignment) : null;

  // ① works 우선
  if (c !== null) {
    const conflict = a !== null && a.toUpperCase() !== c.toUpperCase();
    return { assetId: c, status: 'confirmed', reason: 'works', conflict };
  }

  // ② 임대 건 지정
  if (a !== null) {
    return { assetId: a, status: 'confirmed', reason: 'assignment', conflict: false };
  }

  // ③ 임대 건 모르는 줄에 사람이 줄 단위로 넣은 값
  const p = input.prev;
  if (!rentalKnown && p && p.allocationStatus === 'confirmed' && !hasRow(p.rentalSheetRow)) {
    const x = clean(p.assetId);
    if (x !== null) return { assetId: x, status: 'confirmed', reason: 'kept', conflict: false };
  }

  // ④
  return { assetId: null, status: 'needs_review', reason: 'none', conflict: false };
}
