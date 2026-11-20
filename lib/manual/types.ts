/**
 * 사용설명서(/manual) 내용 형식 — 화면마다 ManualDoc 하나.
 * 내용 파일: lib/manual/docs/*.ts → 순서·묶음: lib/manual/index.ts → 그리기: components/manual/*.
 *
 * 글 안의 꾸밈(모든 text·items·q·a·note 에서 씀):
 *   **굵게**        → 굵은 글씨(중요한 말)
 *   `저장`          → 버튼·메뉴·칩 이름을 화면 버튼 모양 알약으로(예: `＋ 새 입고`, `firstoa-works 대조`)
 * 그 밖의 기호는 글자 그대로 나옴(HTML 안 됨).
 */

/** 위 메뉴와 같은 묶음 */
export type ManualGroupKey = 'start' | 'inventory' | 'rental' | 'contract';

export type ManualBlock =
  /** 문단 */
  | { t: 'p'; text: string }
  /** 순서대로 따라 하는 단계 — 검은 동그라미 1, 2, 3 */
  | { t: 'steps'; items: string[] }
  /** 점 목록 */
  | { t: 'list'; items: string[] }
  /** 파란 "팁" 상자 / 주황 "주의" 상자 */
  | { t: 'tip'; text: string; tone?: 'tip' | 'warn' }
  /** 버튼 설명 — 왼쪽에 실제 화면 버튼 모양, 오른쪽에 누르면 무슨 일이 생기는지 */
  | { t: 'buttons'; items: { label: string; style?: 'primary' | 'ghost' | 'chip' | 'danger'; text: string }[] }
  /** 표 — 칸 뜻·색 뜻·상태 뜻 정리 */
  | { t: 'table'; head: string[]; rows: string[][] }
  /** 예전엔 / 지금은 */
  | { t: 'compare'; before: { title: string; items: string[] }; after: { title: string; items: string[] } }
  /** 자주 묻는 질문 */
  | { t: 'faq'; items: { q: string; a: string }[] };

export type ManualSubsection = {
  /** 문서 안에서 겹치지 않는 영문 소문자·숫자·하이픈(주소 #id 로 씀) */
  id: string;
  title: string;
  blocks: ManualBlock[];
};

export type ManualSection = {
  id: string;
  /** 번호 없이 — 화면이 "1. 2. 3." 을 붙임 */
  title: string;
  blocks: ManualBlock[];
  /** 한 단계 아래 꼭지(버튼 하나하나 같은 것) — 왼쪽 목차에 들여 써서 나옴 */
  sub?: ManualSubsection[];
};

/** "이 화면이 해 주는 것" 색 카드(최대 4개). 지어낸 숫자·통계는 쓰지 말 것 — 실제로 하는 일만. */
export type ManualHighlight = {
  /** 카드 위 작은 글자(예: "출고 보고") */
  label: string;
  /** 큰 글자 — 짧게(10자 안팎, 예: "카톡 한 번") */
  value: string;
  /** 아래 한 줄 설명 */
  note: string;
};

export type ManualDoc = {
  /** 주소 /manual?doc=<key> — 영문 소문자·하이픈, 바꾸면 공유한 링크가 깨짐 */
  key: string;
  group: ManualGroupKey;
  /** 왼쪽 메뉴 이름과 똑같이 */
  title: string;
  icon: string;
  /** 실제 화면 주소(“화면 열기 →” 버튼) */
  href: string;
  /** 목록 카드에 보이는 한두 줄(무엇을 하는 화면인지 · 로 이어서) */
  summary: string;
  /** 이 설명서를 마지막으로 고친 날 YYYY-MM-DD */
  updated: string;
  /** 맨 위 검은 상자 설명 2~3문장 */
  intro: string;
  /** 검은 상자 아래 작은 꼬리표(예: "처음 쓰는 분 기준") */
  tags?: string[];
  highlights?: ManualHighlight[];
  sections: ManualSection[];
};
