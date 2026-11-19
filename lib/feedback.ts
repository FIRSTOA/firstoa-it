/** 홈 피드백 게시판 — 종류·상태 목록과 타입(서버 액션 파일엔 함수만 둘 수 있어 따로) */
export const FEEDBACK_KINDS = ['불편', '버그', '개선', '기타'] as const;
export const FEEDBACK_STATUSES = ['접수', '진행', '완료', '보류', '반려'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type Feedback = {
  id: string;
  kind: FeedbackKind;
  body: string;
  author: string;
  page: string;
  status: FeedbackStatus;
  reply: string;
  plusCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackListResult =
  | { ok: true; items: Feedback[] }
  | { ok: false; missingTable: boolean; error: string };

/** 피드백을 적을 때 고르는 "관련 화면" */
export const FEEDBACK_PAGES = [
  '홈',
  'IT 재고 리스트',
  '입고',
  '출고',
  '출고 준비 리스트',
  '확인서/출고및반출준비',
  '판매리스트',
  '자산 이력',
  '실재고 조사',
  '재고 현황판',
  '소모품 가격표',
  '임대리스트',
  '청구리스트',
  '통합 캘린더',
  '핸드폰 화면',
  '기타',
];
