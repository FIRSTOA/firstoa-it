/**
 * 커밋 기록 → lib/generated/commitLog.ts — `npm run build` 전에 prebuild 로 자동 실행(로컬·Vercel 둘 다).
 *
 * - 홈 "업데이트"의 개발 기록(날짜별 커밋 제목)과 "IT AI 에이전트 팀" 카드의 직원별 한 일이 이 파일을 읽는다.
 *   한 일 = 커밋 본문의 `투입: 이름, 이름` 줄(CLAUDE.md "AI 에이전트 팀" — 실제로 일한 직원만 적음).
 * - Vercel 은 얕은 클론이라 git 기록이 짧거나 아예 못 읽을 수 있다 → 이미 커밋돼 있는 파일과 해시 기준으로 합쳐 목록이 줄지 않게.
 *   git 을 못 읽으면 VERCEL_GIT_COMMIT_SHA/MESSAGE 로 이번 커밋 한 건이라도 넣는다.
 *   그래서 로컬에서 빌드해 갱신된 파일을 같이 커밋해 두는 게 원칙(deploy-check 가 확인).
 * - 직원 명단 검사: lib/agentTeam.ts(카드)와 .claude/agents/*.md(원본)의 이름·부서·캐릭터·모델이 다르면 빌드를 멈춘다.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('lib/generated/commitLog.ts', ROOT);
const TEAM_FILE = new URL('lib/agentTeam.ts', ROOT);
const AGENTS_DIR = new URL('.claude/agents/', ROOT);
const SKIP = /^(Merge|Revert)\b/;
const KEEP = 1000;

// ── 직원 명단: lib/agentTeam.ts 를 글자로 읽음(이 스크립트는 .ts 를 import 하지 않음) ──────────────────
function readTeam() {
  const src = readFileSync(TEAM_FILE, 'utf8');
  const depts = [...src.matchAll(/name:\s*'([^']+)',\s*accent:/g)].map((m) => ({ name: m[1], at: m.index }));
  const roles = [...src.matchAll(/\{\s*key:\s*'([^']+)',\s*name:\s*'([^']+)',\s*emoji:\s*'([^']+)',\s*model:\s*'([^']+)'/g)].map((m) => ({
    key: m[1],
    name: m[2],
    emoji: m[3],
    model: m[4],
    dept: depts.filter((d) => d.at < m.index).pop()?.name ?? '',
  }));
  return roles;
}

// ── 원본 .claude/agents/*.md 와 대조 ────────────────────────────────────────────────────────────
function checkRoster(team) {
  if (!existsSync(AGENTS_DIR)) return []; // 배포 환경에 폴더가 없으면 검사 생략
  const problems = [];
  const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const src = readFileSync(new URL(f, AGENTS_DIR), 'utf8');
    const key = src.match(/^name:\s*(\S+)/m)?.[1];
    const model = src.match(/^model:\s*(\S+)/m)?.[1];
    const who = src.match(/^이름\s+(\S+)\s*·\s*부서\s+(\S+)\s*·\s*캐릭터\s+([^\s.]+)/m);
    const role = team.find((r) => r.key === key);
    if (!key || !who) {
      problems.push(`${f}: 머리의 name: 또는 "이름 X · 부서 Y · 캐릭터 Z" 줄이 없음`);
      continue;
    }
    if (!role) {
      problems.push(`${f}: lib/agentTeam.ts 에 '${key}' 가 없음(카드에 추가할 것)`);
      continue;
    }
    const [, name, dept, emoji] = who;
    for (const [label, a, b] of [['이름', name, role.name], ['부서', dept, role.dept], ['캐릭터', emoji, role.emoji], ['모델', model, role.model]]) {
      if (a !== b) problems.push(`${f}: ${label} 이(가) 다름 — 역할 파일 '${a}' / lib/agentTeam.ts '${b}'`);
    }
  }
  const keys = new Set(files.map((f) => f.replace(/\.md$/, '')));
  for (const r of team) if (!keys.has(r.key)) problems.push(`lib/agentTeam.ts 의 '${r.key}' 에 해당하는 .claude/agents/${r.key}.md 가 없음`);
  return problems;
}

const team = readTeam();
const problems = checkRoster(team);
if (problems.length) {
  console.error('\n[gen-commit-log] AI 팀 명단이 서로 다릅니다 — lib/agentTeam.ts 와 .claude/agents/*.md 를 맞춰 주세요.');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
const byName = new Map(team.map((r) => [r.name, r.key]));
const keySet = new Set(team.map((r) => r.key));

/** 본문의 `투입: 이름, 이름` 줄 → 역할 key 목록(이름이나 key 둘 다 받음, 모르는 이름은 무시) */
function crewOf(body) {
  const out = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*투입\s*[:：]\s*(.+)$/);
    if (!m) continue;
    for (const tok of m[1].split(/[\s,，、·]+/).filter(Boolean)) {
      const key = byName.get(tok) ?? (keySet.has(tok) ? tok : null);
      if (key && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

// ── 이미 있는 파일(얕은 클론 대비) ───────────────────────────────────────────────────────────────
function readExisting() {
  if (!existsSync(OUT)) return [];
  try {
    const m = readFileSync(OUT, 'utf8').match(/COMMIT_LOG:[^=]*=\s*(\[[\s\S]*\]);/);
    return m ? JSON.parse(m[1]) : [];
  } catch {
    return [];
  }
}

// ── git 기록(한국 시간으로) ───────────────────────────────────────────────────────────────────────
function readGit() {
  try {
    const out = execSync('git log -1000 --date=format-local:"%Y-%m-%d %H:%M" --pretty=format:"%H%x1f%ad%x1f%s%x1f%b%x1e"', {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, TZ: 'KST-9' }, // POSIX 표기 — 윈도우 git 도 알아들음
    });
    const list = [];
    for (const rec of out.split('\x1e')) {
      const [hash, at, subject = '', body = ''] = rec.replace(/^\s+/, '').split('\x1f');
      if (!hash || !at) continue;
      const [date, time] = at.split(' ');
      list.push({ hash: hash.slice(0, 10), date, time, subject: subject.trim(), crew: crewOf(body) });
    }
    return list;
  } catch {
    return [];
  }
}

function fromVercelEnv() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const msg = process.env.VERCEL_GIT_COMMIT_MESSAGE;
  if (!sha || !msg) return [];
  const now = new Date(Date.now() + 9 * 3600_000).toISOString(); // KST
  const [subject, ...rest] = msg.split('\n');
  return [{ hash: sha.slice(0, 10), date: now.slice(0, 10), time: now.slice(11, 16), subject: subject.trim(), crew: crewOf(rest.join('\n')) }];
}

const fresh = readGit();
const seen = new Map();
for (const e of [...fresh, ...(fresh.length ? [] : fromVercelEnv()), ...readExisting()]) {
  if (e && e.hash && e.date && e.subject && !seen.has(e.hash)) seen.set(e.hash, { ...e, time: e.time ?? '' });
}
const merged = [...seen.values()]
  .filter((e) => !SKIP.test(e.subject))
  .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
  .slice(0, KEEP);

mkdirSync(new URL('lib/generated/', ROOT), { recursive: true });
writeFileSync(
  OUT,
  `// 자동 생성 — scripts/gen-commit-log.mjs 가 빌드 전에 git 기록에서 갱신한다. 직접 고치지 말 것.
// crew = 커밋 본문 \`투입: 이름, 이름\` 줄의 AI 직원(lib/agentTeam.ts 의 key).
export type CommitEntry = { hash: string; date: string; time: string; subject: string; crew: string[] };
export const COMMIT_LOG: CommitEntry[] = ${JSON.stringify(merged, null, 2)};
`,
);
console.log(`commit log: ${merged.length}건 (git ${fresh.length}건${fresh.length ? '' : ', git 못 읽음 — 기존 파일·Vercel 환경값 사용'}) · AI 팀 ${team.length}명 명단 일치`);
