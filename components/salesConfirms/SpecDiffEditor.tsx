'use client';

import type { DiffField, SalesSpec, SalesSpecKey } from '@/lib/salesConfirms/types';
import type { FieldMark } from './detailShared';

interface Props {
  keys: SalesSpecKey[];
  /** 영업 요청 사양 — 흐린 글씨(placeholder)로 보임 */
  sales: SalesSpec;
  /** 출고사양 초안(칸 이름 → 글자) */
  value: Record<string, string>;
  onChange: (key: SalesSpecKey, v: string) => void;
  /** 칸을 나갈 때(저장 시점) */
  onBlur?: () => void;
  /** 칸별 노란 표시(없으면 안 보임) */
  marks?: Partial<Record<DiffField, FieldMark>>;
  disabled?: boolean;
  idPrefix: string;
}

/**
 * 출고사양 칸별 입력. 비워 두면 "출고 값 없음 → 영업 요청 그대로". 영업 요청과 다른 칸은 노란색 + "요청 8GB".
 */
export default function SpecDiffEditor({ keys, sales, value, onChange, onBlur, marks, disabled, idPrefix }: Props) {
  return (
    <div className="sc-spec-grid">
      {keys.map((k) => {
        const mark = marks?.[`spec:${k}` as DiffField];
        const req = (sales[k] ?? '').trim();
        return (
          <div key={k} className="sc-spec-cell">
            <label htmlFor={`${idPrefix}-${k}`}>{k}</label>
            <input
              id={`${idPrefix}-${k}`}
              data-field={`spec:${k}`}
              className={`sc-in${mark ? ` sc-diff-${mark.state}` : ''}`}
              value={value[k] ?? ''}
              placeholder={req || '-'}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => onChange(k, e.target.value)}
              onBlur={onBlur}
            />
            {mark && (
              <div className={`sc-diff-cap ${mark.state}`}>
                <b>요청 {mark.sales}</b> · {mark.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
