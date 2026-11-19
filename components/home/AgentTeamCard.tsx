'use client';

import { useState, type CSSProperties } from 'react';
import {
  AGENT_DEPTS,
  AGENT_FLOW_STEPS,
  AGENT_LEADER,
  AGENT_TEAM_SINCE,
  type AgentDept,
  type AgentModel,
} from '@/lib/agentTeam';
import type { TeamWork } from '@/lib/agentWork';

const MODELS: AgentModel[] = ['opus', 'sonnet', 'haiku'];
const MODEL_LABEL: Record<AgentModel, string> = { opus: '설계·원인 추적', sonnet: '구현·검사', haiku: '빠른 통과 점검' };
const ALL_ROLES = AGENT_DEPTS.flatMap((d) => d.roles);
const MODEL_COUNT = Object.fromEntries(MODELS.map((m) => [m, ALL_ROLES.filter((r) => r.model === m).length])) as Record<AgentModel, number>;
const OFF_FLOW = AGENT_DEPTS.filter((d) => d.stage === null);
const EMPTY = { today: 0, week: 0 };

const accentOf = (d: AgentDept) => ({ '--accent': d.accent }) as CSSProperties;
const stageShort = (d: AgentDept) => (d.stage === null ? '상시' : `${d.stage + 1}단계`);
const stageLong = (d: AgentDept) => (d.stage === null ? '흐름 밖 · 상시 감시' : `${d.stage + 1}단계 · ${AGENT_FLOW_STEPS[d.stage]}`);

/**
 * 홈 "IT AI 에이전트 팀" 카드(2026-11-19, 참고: CS팀 FIELD AI 에이전트 팀 — 우리 홈에 맞춰 밝은 색).
 * 머리글(직원·부서·모델 수, 팀 한 일) → 조직도(팀장 → 부서 7) → 고른 부서 직원 카드 → 일 흐름 → 모델 구성.
 * 넓으면(카드 폭 900px↑) 가로 조직도 + 아래 직원 카드, 좁으면 왼쪽 줄기 나무 + 고른 부서 바로 아래 펼침 — CSS 컨테이너 쿼리.
 * 명단은 lib/agentTeam.ts(원본 .claude/agents/), 한 일은 서버가 커밋 기록에서 계산해 넘김(lib/agentWork.ts).
 */
export default function AgentTeamCard({ work }: { work: TeamWork }) {
  const [openDept, setOpenDept] = useState(AGENT_DEPTS[0].name);
  const dept = AGENT_DEPTS.find((d) => d.name === openDept);
  const toggle = (name: string) => setOpenDept((cur) => (cur === name ? '' : name));

  return (
    <section className="home-section agent-team" id="agent-team" aria-label="IT AI 에이전트 팀">
      <header className="agent-head">
        <div className="agent-head-text">
          <div className="agent-eyebrow">🤖 FIRSTOA IT · AI AGENT TEAM</div>
          <h3 className="agent-title">IT AI 에이전트 팀</h3>
          <p className="agent-lead">
            IT팀이 꾸린 AI 직원 {ALL_ROLES.length}명입니다. 사람 1명이 지시하면 팀장 클로드가 기획→구현→검사로 일을 나눠 맡깁니다.
          </p>
          <div className={`agent-work-chip${work.total.today > 0 ? ' busy' : ''}`}>
            <span aria-hidden>📅</span>
            <span className="muted">팀 한 일 ·</span> 오늘 <b>{work.total.today}</b>건 · 이번 주 <b>{work.total.week}</b>건
          </div>
        </div>
        <ul className="agent-stats" aria-label="팀 규모">
          <li>
            <span className="l">직원</span> <b>{ALL_ROLES.length}</b>
            <span className="s live">출근 중</span>
          </li>
          <li>
            <span className="l">부서</span> <b>{AGENT_DEPTS.length}</b>
            <span className="s">흐름 {AGENT_FLOW_STEPS.length}단계</span>
          </li>
          <li>
            <span className="l">모델</span> <b>{MODELS.filter((m) => MODEL_COUNT[m] > 0).length}</b>
            <span className="s">급별 배치</span>
          </li>
        </ul>
      </header>

      {/* 조직도: 팀장 → 부서 */}
      <div className="agent-block">
        <div className="agent-block-head">
          <span className="agent-eyebrow2">조직도</span>
          <span className="agent-note">부서를 누르면 직원 카드가 펼쳐집니다</span>
        </div>
        <div className="agent-org">
          <div className="agent-leader">
            <span className="agent-leader-icon" aria-hidden>
              {AGENT_LEADER.emoji}
              <span className="agent-live-dot ping" />
            </span>
            <span className="agent-leader-text">
              <span className="agent-leader-role">{AGENT_LEADER.title} · 지휘</span>
              <b>{AGENT_LEADER.name}</b>
              <span className="agent-leader-desc">{AGENT_LEADER.desc}</span>
            </span>
          </div>
          <div className="agent-stem" aria-hidden />
          <ul className="agent-depts">
            {AGENT_DEPTS.map((d) => {
              const open = openDept === d.name;
              const count = work.byDept[d.name] ?? EMPTY;
              return (
                <li key={d.name} className={open ? 'open' : undefined} style={accentOf(d)}>
                  <button type="button" className="agent-dept" aria-expanded={open} onClick={() => toggle(d.name)}>
                    <span className="agent-dept-emojis" aria-hidden>
                      {d.roles.map((r) => (
                        <span key={r.key}>{r.emoji}</span>
                      ))}
                    </span>
                    <span className="agent-dept-body">
                      <span className="agent-dept-name">
                        {d.name} <small>{d.roles.length}명</small>
                      </span>
                      <span className="agent-dept-meta">
                        <span className="agent-stage">{stageShort(d)}</span>
                        <span className="agent-model-dots" aria-hidden>
                          {d.roles.map((r) => (
                            <i key={r.key} className={`am-${r.model}`} />
                          ))}
                        </span>
                        <span className={`agent-count${count.today > 0 ? ' busy' : ''}`}>
                          오늘 {count.today} · 주 {count.week}
                        </span>
                      </span>
                    </span>
                    <span className="agent-chev" aria-hidden>
                      ▾
                    </span>
                  </button>
                  {/* 좁은 화면: 고른 부서 바로 아래 펼침(넓은 화면에선 CSS 로 숨기고 아래 칸에 보여 줌) */}
                  {open && (
                    <div className="agent-roles-inline">
                      <RoleList d={d} work={work} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* 넓은 화면: 고른 부서 직원 카드 */}
      {dept && (
        <div className="agent-block agent-dept-detail" style={accentOf(dept)}>
          <div className="agent-block-head">
            <span className="agent-dept-title">
              <i className="agent-accent-dot" aria-hidden />
              <b>{dept.name}</b>
              <span className="agent-note">{stageLong(dept)}</span>
            </span>
            <span className="agent-note strong">
              오늘 {(work.byDept[dept.name] ?? EMPTY).today}건 · 이번 주 {(work.byDept[dept.name] ?? EMPTY).week}건
            </span>
          </div>
          <RoleList d={dept} work={work} />
        </div>
      )}

      {/* 일 흐름 */}
      <div className="agent-block">
        <div className="agent-block-head">
          <span className="agent-eyebrow2">일 흐름</span>
          <span className="agent-note">{dept ? `${dept.name} · ${stageLong(dept)}` : '부서를 고르면 흐름 위 위치가 표시됩니다'}</span>
        </div>
        <div className="agent-flow-wrap" style={dept ? accentOf(dept) : undefined}>
          {/* 레일은 ol 밖에(ol 의 자식은 li 만) — 위치 기준은 감싼 div */}
          <span className="agent-flow-rail" aria-hidden>
            <span className="agent-flow-dot" />
          </span>
          <ol className="agent-flow">
          {AGENT_FLOW_STEPS.map((s, i) => {
            const on = !!dept && dept.stage === i;
            return (
              <li key={s} className={on ? 'on' : undefined} aria-current={on ? 'step' : undefined}>
                <span className="agent-flow-num">{i + 1}</span>
                <b>{s}</b>
                <span className="agent-flow-owner">
                  {AGENT_DEPTS.filter((d) => d.stage === i)
                    .map((d) => d.name)
                    .join('·')}
                </span>
              </li>
            );
          })}
          </ol>
        </div>
        {OFF_FLOW.length > 0 && (
          <p className={`agent-note agent-offflow${dept && dept.stage === null ? ' on' : ''}`}>
            {OFF_FLOW.map((d) => d.name).join('·')}은 흐름 밖에서 사이트·네이버 동기화·카톡 대기를 상시 읽기 전용으로 지켜봅니다.
          </p>
        )}
      </div>

      {/* 모델 구성 */}
      <div className="agent-block">
        <div className="agent-block-head">
          <span className="agent-eyebrow2">급에 따라 모델을 나눠 씁니다</span>
          <span className="agent-note">무거운 판단은 큰 모델, 반복 점검은 가벼운 모델</span>
        </div>
        <div className="agent-model-bar" aria-hidden>
          {MODELS.map((m) => (
            <span key={m} className={`am-${m}`} style={{ flexGrow: MODEL_COUNT[m] }} />
          ))}
        </div>
        <ul className="agent-models">
          {MODELS.map((m) => (
            <li key={m}>
              <span className={`agent-model am-${m}`}>{m}</span>
              <b>
                {MODEL_COUNT[m]}
                <small>명</small>
              </b>
              <span className="agent-models-label">{MODEL_LABEL[m]}</span>
            </li>
          ))}
        </ul>
        <p className="agent-foot">
          {AGENT_TEAM_SINCE} 입사 · 직원 명부는 저장소 .claude/agents/ · 팀장 규칙은 CLAUDE.md · 한 일은 커밋 기록의 &lsquo;투입:&rsquo; 줄에서
          자동으로 모읍니다(같은 커밋은 1건)
        </p>
      </div>
    </section>
  );
}

/** 부서 직원 카드 — 출근 점 · 모델 · 오늘 투입/대기 중 · 하는 일 · 언제 불리나 · 오늘 한 일(최대 2줄) · 이번 주 n건 */
function RoleList({ d, work }: { d: AgentDept; work: TeamWork }) {
  if (d.roles.length === 0) return <p className="agent-empty">아직 배치된 직원이 없습니다. 준비 중입니다.</p>;
  return (
    <ul className="agent-roles" style={accentOf(d)}>
      {d.roles.map((r) => {
        const w = work.byRole[r.key] ?? { today: [], week: 0 };
        const busy = w.today.length > 0;
        return (
          <li key={r.key} className="agent-role">
            <div className="agent-role-head">
              <span className="agent-role-icon" aria-hidden>
                {r.emoji}
                <span className="agent-live-dot" />
              </span>
              <span className="agent-role-id">
                <span className="agent-role-line">
                  <b>{r.name}</b>
                  <span className={`agent-model am-${r.model}`}>{r.model}</span>
                  <span className={`agent-busy${busy ? ' on' : ''}`}>{busy ? '오늘 투입' : '대기 중'}</span>
                </span>
                <code>{r.key}</code>
              </span>
            </div>
            <div className="agent-role-desc">{r.desc}</div>
            <div className="agent-role-when">
              <span>언제</span>
              {r.trigger}
            </div>
            <div className="agent-role-work">
              {busy ? (
                <>
                  <div className="agent-role-work-head">
                    <span className="on">오늘 한 일</span>
                    <span>이번 주 {w.week}건</span>
                  </div>
                  <ul>
                    {w.today.slice(0, 2).map((it) => (
                      <li key={it.hash} title={`${it.time} ${it.hash.slice(0, 7)} ${it.subject}`}>
                        {it.subject}
                      </li>
                    ))}
                  </ul>
                  {w.today.length > 2 && <div className="agent-role-more">외 {w.today.length - 2}건 더</div>}
                </>
              ) : (
                <div className="agent-role-idle">오늘은 대기 중 · 이번 주 {w.week}건</div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
