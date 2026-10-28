'use client';

import { STATUSES } from '@/lib/types';

/** 기존 .badge-{상태} 클래스와 같은 색 팔레트를 그래프에도 그대로 씁니다(app/globals.css). */
export const STATUS_COLORS: Record<string, string> = {
  상품화준비중: '#d97706',
  상품화완료: '#059669',
  임대중: '#2563eb',
  수리중: '#dc2626',
  판매: '#4f46e5',
  폐기: '#334155',
  미정: '#94a3b8',
  기타: '#cbd5e1',
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS['기타'];
}

export function StatusLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '11.5px', color: 'var(--ink-500)' }}>
      {STATUSES.map((s) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: statusColor(s), display: 'inline-block' }} />
          {s}
        </span>
      ))}
    </div>
  );
}

export type ChartSegment = { label: string; value: number; color: string };

/** 순수 SVG 도넛(라이브러리 없음) — stroke-dasharray로 원 둘레를 상태 비율만큼 끊어 그립니다. */
export function DonutChart({ segments, size = 108, strokeWidth = 16 }: { segments: ChartSegment[]; size?: number; strokeWidth?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`총 ${total}대`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--ink-100)" strokeWidth={strokeWidth} />
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const frac = s.value / total;
            const dash = frac * circumference;
            // 주의: SVG 안이라도 <title> JSX 엘리먼트는 쓰지 않습니다 — React 19의 자동
            // 문서 메타데이터 처리가 <title> 태그를 발견 위치와 무관하게 <head>로 끌어올리려
            // 하면서 서버 렌더 결과를 비워버려(hydration mismatch, 콘솔에 에러 418) 실제로
            // 겪었던 문제입니다. 대신 aria-label로만 접근성 정보를 둡니다(네이티브 마우스
            // 오버 툴팁은 없지만, 정확한 수치는 범례/표에 이미 나와 있음).
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                aria-label={`${s.label}: ${s.value}대`}
              />
            );
            offset += dash;
            return el;
          })}
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.19} fontWeight={700} fill="var(--ink-900)">
        {total}
      </text>
    </svg>
  );
}

/** 가로 막대 — 표의 각 행 옆에 붙여 수량 비율을 한눈에 보여줍니다. */
export function StackedBar({ segments, total }: { segments: ChartSegment[]; total: number }) {
  return (
    <div
      style={{
        display: 'flex',
        height: '14px',
        minWidth: '90px',
        borderRadius: '7px',
        overflow: 'hidden',
        background: 'var(--ink-100)',
      }}
    >
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.label}
              title={`${s.label}: ${s.value}대`}
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            />
          ))}
    </div>
  );
}
