/**
 * 홈 화면 앱(PWA) 정보 — app/manifest.ts(설치 정보)와 app/layout.tsx(head 메타)가 같이 씀.
 * 아이콘 PNG는 scripts/make-pwa-icons.js 로 만듦(색을 바꾸면 그 스크립트도 같은 색으로 다시 돌릴 것).
 */
export const APP_NAME = '퍼스트전산 IT ERP';
/** 홈 화면 아이콘 밑에 보이는 이름 — 길면 잘리므로 6자 이내 */
export const APP_SHORT_NAME = '퍼스트IT';
/** 대표 색 — 안드로이드 상단 상태바 색. globals.css 의 --indigo-600 */
export const THEME_COLOR = '#4f46e5';
/** 안드로이드에서 앱을 켤 때 잠깐 보이는 시작 화면 배경 */
export const BACKGROUND_COLOR = '#ffffff';

export const APPLE_TOUCH_ICON = '/icons/apple-touch-icon.png';
