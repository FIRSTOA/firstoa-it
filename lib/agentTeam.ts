/**
 * 홈 "IT AI 에이전트 팀" 카드의 명단 (2026-11-19 구성 — 참고: CS팀 FIELD AI 에이전트 팀).
 *
 * 원본은 .claude/agents/<key>.md — 머리(frontmatter)의 model 과 본문 첫 줄 `이름 X · 부서 Y · 캐릭터 Z`.
 * 직원을 늘리거나 이름·부서·모델을 바꾸면 여기도 같이 고칠 것. 다르면 빌드 전 scripts/gen-commit-log.mjs 가 빌드를 멈춘다.
 * 그 스크립트가 이 파일을 글자로 읽으므로 역할 한 줄의 필드 순서(key, name, emoji, model, …)와 작은따옴표를 지킬 것.
 * 팀장 규칙(요청 종류별로 누구를 부르는지)은 CLAUDE.md "AI 에이전트 팀".
 */
export type AgentModel = 'opus' | 'sonnet' | 'haiku';
export type AgentRole = { key: string; name: string; emoji: string; model: AgentModel; desc: string; trigger: string };
/** accent: 부서 색(밝은 화면용 진한 색) · stage: AGENT_FLOW_STEPS 의 몇 번째 단계에서 일하는지(null = 흐름 밖 상시 감시) */
export type AgentDept = { name: string; accent: string; stage: number | null; roles: AgentRole[] };

export const AGENT_LEADER = {
  name: '클로드 · Claude Code (Opus 5.5)',
  emoji: '🧭',
  title: '팀장',
  desc: '누구를 부를지 정하고 최종 판단·코드 리뷰',
};

export const AGENT_DEPTS: AgentDept[] = [
  {
    name: '기획실', accent: '#c026d3', stage: 0, roles: [
      { key: 'feature-planner', name: '도면우', emoji: '📐', model: 'opus', desc: '기존 코드·데이터 흐름을 조사해 설계안 작성', trigger: '기능 추가·개선 요청이 오면 먼저' },
    ],
  },
  {
    name: '디자인실', accent: '#db2777', stage: 1, roles: [
      { key: 'ui-designer', name: '고화질', emoji: '🎨', model: 'sonnet', desc: '화면 틀·PC/핸드폰 레이아웃·일관성 담당', trigger: '새 화면을 만들거나 고칠 때' },
    ],
  },
  {
    name: '데이터실', accent: '#2563eb', stage: 1, roles: [
      { key: 'db-schema', name: '정규화', emoji: '🗄️', model: 'opus', desc: 'Supabase 표·SQL과 구글시트 칸 구조 설계', trigger: '새 표·컬럼이 필요하거나 숫자가 이상할 때' },
    ],
  },
  {
    name: '개발실', accent: '#65a30d', stage: 2, roles: [
      { key: 'developer', name: '구동민', emoji: '🧑‍💻', model: 'sonnet', desc: '승인된 설계안대로 코드 구현', trigger: '설계안 승인 뒤 구현할 때' },
      { key: 'debugger', name: '원인규', emoji: '🔍', model: 'opus', desc: '원인 추적·근본 수정·재발 방지', trigger: '에러·"안 돼요"가 들어왔을 때' },
    ],
  },
  {
    name: '품질실', accent: '#ca8a04', stage: 3, roles: [
      { key: 'qa-checker', name: '이상무', emoji: '✅', model: 'sonnet', desc: '타입·빌드·범위·핸드폰 화면 검사', trigger: '작업을 끝내기 직전마다' },
    ],
  },
  {
    name: '검사실', accent: '#ea580c', stage: 4, roles: [
      { key: 'deploy-check', name: '안정빈', emoji: '🚀', model: 'haiku', desc: '배포 전후 통과·실패만 보고', trigger: '커밋·푸시·배포 직전과 직후' },
      { key: 'sql-review', name: '방화벽', emoji: '🔐', model: 'sonnet', desc: 'SQL의 기존 표 변경·삭제 위험·비밀키 검사', trigger: 'SQL을 건네기 직전' },
      { key: 'integration-rules', name: '연동희', emoji: '🔗', model: 'sonnet', desc: '구글시트·네이버·카톡에 쓰는 규칙 강제', trigger: '시트·캘린더·카톡 코드 수정 전후' },
    ],
  },
  {
    name: '운영실', accent: '#0891b2', stage: null, roles: [
      { key: 'ops-monitor', name: '경보람', emoji: '📡', model: 'haiku', desc: '사이트·동기화·카톡 대기를 읽기 전용 점검', trigger: '"잘 돌아가?" 질문이 올 때' },
    ],
  },
];

export const AGENT_FLOW = '기획 → 디자인·DB → 구현 → QA → 배포 검사';
/** 일 흐름 레일 단계(AGENT_FLOW 를 쪼갠 것 — 문구는 AGENT_FLOW 하나만 고치면 된다) */
export const AGENT_FLOW_STEPS = AGENT_FLOW.split(' → ');
/** 팀을 꾸린 날(카드 아래 "입사" 표시) */
export const AGENT_TEAM_SINCE = '2026-11-19';
