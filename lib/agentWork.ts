import 'server-only';
import { AGENT_DEPTS } from '@/lib/agentTeam';
import { COMMIT_LOG, type CommitEntry } from '@/lib/generated/commitLog';

/**
 * AI 팀 카드의 "한 일" 집계 — 커밋 본문 `투입: 이름, 이름` 줄(lib/generated/commitLog.ts 의 crew)에서.
 * 한 커밋에 여러 직원이 들어가므로 부서·전체 합계는 커밋 해시 기준 고유 수(같은 커밋은 1건).
 * 서버에서 계산해 카드(클라이언트)에는 숫자와 오늘 항목만 넘긴다(커밋 기록 전체를 브라우저로 보내지 않게).
 */
export type WorkItem = { hash: string; time: string; subject: string };
export type WorkCount = { today: number; week: number };
export type TeamWork = {
  byRole: Record<string, { today: WorkItem[]; week: number }>;
  byDept: Record<string, WorkCount>;
  total: WorkCount;
};

/** 오늘(KST, YYYY-MM-DD)이 든 주의 월요일~일요일 */
export function weekRange(today: string): { start: string; end: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const fromMon = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - fromMon * 86400_000);
  const end = new Date(start.getTime() + 6 * 86400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function buildTeamWork(today: string, log: CommitEntry[] = COMMIT_LOG): TeamWork {
  const { start, end } = weekRange(today);
  const deptOf = new Map(AGENT_DEPTS.flatMap((d) => d.roles.map((r) => [r.key, d.name] as const)));
  const sets = () => ({ today: new Set<string>(), week: new Set<string>() });
  const role = new Map<string, { today: WorkItem[]; week: Set<string> }>();
  const dept = new Map<string, ReturnType<typeof sets>>();
  const all = sets();

  for (const c of log) {
    if (!c.crew.length || c.date < start || c.date > end) continue;
    const isToday = c.date === today;
    for (const key of c.crew) {
      const dn = deptOf.get(key);
      if (!dn) continue;
      const r = role.get(key) ?? { today: [], week: new Set<string>() };
      r.week.add(c.hash);
      if (isToday && !r.today.some((i) => i.hash === c.hash)) r.today.push({ hash: c.hash, time: c.time, subject: c.subject });
      role.set(key, r);
      const d = dept.get(dn) ?? sets();
      d.week.add(c.hash);
      if (isToday) d.today.add(c.hash);
      dept.set(dn, d);
      all.week.add(c.hash);
      if (isToday) all.today.add(c.hash);
    }
  }

  const byRole: TeamWork['byRole'] = {};
  const byDept: TeamWork['byDept'] = {};
  for (const d of AGENT_DEPTS) {
    const s = dept.get(d.name);
    byDept[d.name] = { today: s?.today.size ?? 0, week: s?.week.size ?? 0 };
    for (const r of d.roles) {
      const w = role.get(r.key);
      byRole[r.key] = { today: w?.today ?? [], week: w?.week.size ?? 0 };
    }
  }
  return { byRole, byDept, total: { today: all.today.size, week: all.week.size } };
}
