import Link from 'next/link';
import type { PrepEventRow } from '@/app/shipment-prep/actions';
import {
  loadConfirmCard,
  loadContractsCard,
  loadInventoryCard,
  loadSystemStatus,
  prepStatusOf,
  type PrepOverview,
  type WorkCard,
} from '@/lib/homeDashboard';
import { AGENT_DEPTS } from '@/lib/agentTeam';
import { COMMIT_LOG, type CommitEntry } from '@/lib/generated/commitLog';
import { RELEASES } from '@/lib/releases';
import { isPrepDone, isPrepInProgress, isPrepOverhaul, shortDateLabel } from '@/lib/shipmentPrep';

/** 홈(/home) 화면 조각들 — 서버에서 그림. 피드백 게시판만 components/home/FeedbackBoard.tsx(브라우저) */

// ---------- 업무 현황 카드 ----------

export function WorkCardView({ card }: { card: WorkCard }) {
  return (
    <Link href={card.href} className={`home-card tone-${card.tone}`}>
      <div className="home-card-head">
        <span>
          <span className="home-card-icon">{card.icon}</span> {card.title}
        </span>
        <span className="home-card-go">›</span>
      </div>
      {card.error ? (
        <div className="home-card-alert tone-muted">못 읽었어요 — {card.error}</div>
      ) : (
        <>
          <div className="home-card-metrics">
            {card.metrics.map((m) => (
              <div key={m.label} className={`home-metric${m.tone ? ` tone-${m.tone}` : ''}`}>
                <div className="v">{m.value}</div>
                <div className="l">{m.label}</div>
              </div>
            ))}
          </div>
          <div className={`home-card-alert tone-${card.alert ? card.tone : 'good'}`}>
            {/* ⚠ 는 손봐야 할 것(주황·빨강)에만 — 초록 카드의 한 줄은 참고 정보 */}
            {card.alert ? `${card.tone === 'warn' || card.tone === 'bad' ? '⚠ ' : ''}${card.alert}` : '✓ 이상 없음'}
          </div>
        </>
      )}
    </Link>
  );
}

/** 구글시트에서 읽는 카드가 도착하기 전 자리 */
export function WorkCardLoading({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="home-card tone-muted">
      <div className="home-card-head">
        <span>
          <span className="home-card-icon">{icon}</span> {title}
        </span>
      </div>
      <div className="home-loading">
        <span className="nav-spinner" aria-hidden /> 구글시트 읽는 중…
      </div>
    </div>
  );
}

export async function InventoryCardAsync() {
  return <WorkCardView card={await loadInventoryCard()} />;
}

export async function ContractsCardAsync() {
  return <WorkCardView card={await loadContractsCard()} />;
}

export async function ConfirmCardAsync({ today }: { today: string }) {
  return <WorkCardView card={await loadConfirmCard(today)} />;
}

// ---------- 오늘·내일 출고 일정 ----------

const KIND_STYLE: Record<string, { bg: string; fg: string }> = {
  납품: { bg: '#dbeafe', fg: '#1e40af' },
  교체: { bg: '#ede9fe', fg: '#6d28d9' },
  철수: { bg: '#ffedd5', fg: '#c2410c' },
};

function PrepRow({ ev, showReport }: { ev: PrepEventRow; showReport: boolean }) {
  const status = prepStatusOf(ev);
  const kind = KIND_STYLE[ev.kind] ?? { bg: 'var(--ink-100)', fg: 'var(--ink-700)' };
  const people = Object.entries(ev.prepChecks).filter(([, e]) => isPrepDone(e) || isPrepInProgress(e) || isPrepOverhaul(e));
  return (
    <Link href="/shipment-prep" className={`home-prep-row prep-${status}`}>
      <div className="home-prep-time">{ev.time || '종일'}</div>
      <div className="home-prep-main">
        <div className="home-prep-title">
          <span className="home-kind" style={{ background: kind.bg, color: kind.fg }}>
            {ev.kind || '일정'}
          </span>
          <b>{ev.company || ev.title}</b>
        </div>
        {ev.items.length > 0 && <div className="home-prep-items">{ev.items.join(' · ')}</div>}
        {people.length > 0 && (
          <div className="home-prep-people">
            {people.map(([name, e]) => (
              <span key={name} className={isPrepDone(e) ? 'done' : 'doing'}>
                {isPrepDone(e) ? '●' : '◐'} {name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="home-prep-state">
        <span className={`home-chip state-${status}`}>{status === 'done' ? '준비 완료' : status === 'doing' ? '준비 중' : '준비 전'}</span>
        {showReport && (
          <span className={`home-chip ${ev.reportSent ? 'state-done' : 'state-waiting'}`}>{ev.reportSent ? '카톡 보고 ✓' : '보고 전'}</span>
        )}
        {showReport && ev.stockProblem > 0 && <span className="home-chip state-doing">재고 반영 안 됨 {ev.stockProblem}대</span>}
      </div>
    </Link>
  );
}

export function UpcomingShipments({ prep }: { prep: PrepOverview }) {
  const groups = [
    { label: `오늘 ${shortDateLabel(prep.today)} 출고`, events: prep.todayEvents, report: true },
    { label: `${shortDateLabel(prep.target)} 출고 — 오늘 준비할 것`, events: prep.targetEvents, report: false },
  ];
  return (
    <section className="home-section">
      <div className="home-section-title">
        <span>🚚 오늘·내일 출고 일정</span>
        <Link href="/shipment-prep" className="home-more">
          출고 준비 리스트 ›
        </Link>
      </div>
      {prep.card.error ? (
        <div className="home-empty">일정을 못 읽었어요 — {prep.card.error}</div>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="home-prep-group">
            <div className="home-prep-group-label">
              {g.label} <span>{g.events.length}건</span>
            </div>
            {g.events.length === 0 ? (
              <div className="home-empty">네이버 캘린더 별표(★) IT 일정이 없어요.</div>
            ) : (
              g.events.map((ev) => <PrepRow key={ev.id} ev={ev} showReport={g.report} />)
            )}
          </div>
        ))
      )}
    </section>
  );
}

// ---------- 운영·시스템 ----------

export async function SystemStatusAsync() {
  const tiles = await loadSystemStatus();
  return (
    <section className="home-section">
      <div className="home-section-title">
        <span>🛰️ 운영·시스템</span>
        <span className="home-section-note">지금 이 화면을 만들면서 잰 값</span>
      </div>
      <div className="home-status-grid">
        {tiles.map((t) => (
          <div key={t.key} className={`home-status tone-${t.tone}`}>
            <div className="home-status-label">
              <span className="dot" /> {t.label}
            </div>
            <div className="home-status-value">{t.value}</div>
            {t.detail && <div className="home-status-detail">{t.detail}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SystemStatusLoading() {
  return (
    <section className="home-section">
      <div className="home-section-title">
        <span>🛰️ 운영·시스템</span>
      </div>
      <div className="home-loading">
        <span className="nav-spinner" aria-hidden /> 응답 시간 재는 중…
      </div>
    </section>
  );
}

// ---------- 업데이트 ----------

/** 사흘 안에 나온 기록이면 NEW */
function isRecent(ymd: string): boolean {
  return Date.now() - new Date(`${ymd}T00:00:00+09:00`).getTime() < 3 * 24 * 3600_000;
}

export function ReleaseNotes() {
  const latest = RELEASES.slice(0, 3);
  const older = RELEASES.slice(3);
  const item = (r: (typeof RELEASES)[number], i: number) => (
    <li key={`${r.date}-${i}`} className="home-release">
      <div className="home-release-head">
        <span className="home-release-date">{r.date.slice(5).replace('-', '/')}</span>
        <b>{r.title}</b>
        {isRecent(r.date) && <span className="home-new">NEW</span>}
      </div>
      <ul>
        {r.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </li>
  );
  const days = groupByDate(COMMIT_LOG);
  const version = days[0]?.date.replace(/-/g, '.');
  return (
    <section className="home-section">
      <div className="home-section-title">
        <span>🆕 업데이트</span>
        <span className="home-release-tags">
          <span className="home-tag">누적 {COMMIT_LOG.length}</span>
          {version && <span className="home-tag ver">v{version}</span>}
        </span>
      </div>
      <ol className="home-releases">{latest.map(item)}</ol>
      {older.length > 0 && (
        <details className="home-release-more">
          <summary>이전 기록 더 보기 ({older.length}건)</summary>
          <ol className="home-releases">{older.map((r, i) => item(r, i + 3))}</ol>
        </details>
      )}

      {days.length > 0 && (
        <div className="home-devlog-block">
          <div className="home-devlog-title">
            <b>개발 기록</b>
            <span className="home-section-note">커밋에서 자동으로 — 배포할 때마다 늘어나요</span>
          </div>
          <ol className="home-releases">
            {days.slice(0, 3).map((g) => (
              <DevLogDay key={g.date} g={g} />
            ))}
          </ol>
          {days.length > 3 && (
            <details className="home-release-more">
              <summary>최근 배포 더 보기 ({days.length - 3}일)</summary>
              <ol className="home-releases">
                {days.slice(3).map((g) => (
                  <DevLogDay key={g.date} g={g} />
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- 개발 기록(커밋에서 자동, lib/generated/commitLog.ts) ----------

type DayGroup = { date: string; items: CommitEntry[] };

function groupByDate(log: CommitEntry[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const c of log) {
    const last = out[out.length - 1];
    if (last && last.date === c.date) last.items.push(c);
    else out.push({ date: c.date, items: [c] });
  }
  return out;
}

const ROLE_BY_KEY = new Map(AGENT_DEPTS.flatMap((d) => d.roles.map((r) => [r.key, r] as const)));

function DevLogItem({ c }: { c: CommitEntry }) {
  const crew = c.crew.flatMap((k) => {
    const r = ROLE_BY_KEY.get(k);
    return r ? [r] : [];
  });
  return (
    // 긴 제목은 두 줄로 줄여 두고, 누르면(details 펼침) 다 보임 — 핸드폰엔 마우스 올리기(title)가 없어서
    <li title={`${c.time} · ${c.hash.slice(0, 7)}${crew.length ? ` · 투입: ${crew.map((r) => r.name).join(', ')}` : ''}`}>
      <details className="home-devlog-item">
        <summary className="home-devlog-text">
          {crew.length > 0 && <span className="home-devlog-crew">{crew.map((r) => r.emoji).join('')}</span>}
          {c.subject}
        </summary>
      </details>
    </li>
  );
}

function DevLogDay({ g }: { g: DayGroup }) {
  const head = g.items.slice(0, 3);
  const rest = g.items.slice(3);
  return (
    <li className="home-release">
      <div className="home-release-head">
        <span className="home-release-date">{g.date}</span>
        {isRecent(g.date) && <span className="home-new">NEW</span>}
        <span className="home-section-note">{g.items.length}건</span>
      </div>
      <ul className="home-devlog">
        {head.map((c) => (
          <DevLogItem key={c.hash} c={c} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="home-devlog-rest">
          <summary>… 외 {rest.length}건</summary>
          <ul className="home-devlog">
            {rest.map((c) => (
              <DevLogItem key={c.hash} c={c} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
