/** 반출 확인서 탭 종류 — app/confirmForm/actions.ts는 'use server'라 상수를 못 내보내서 분리. */
export const CONFIRM_FORM_TABS = ['납품', '교체', '철수'] as const;
export type ConfirmFormTab = (typeof CONFIRM_FORM_TABS)[number];
