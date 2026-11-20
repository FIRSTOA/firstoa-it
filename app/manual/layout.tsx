import type { ReactNode } from 'react';
import ManualFrame from '@/components/manual/ManualFrame';
import Shell from '@/components/Shell';
import { DEFAULT_MANUAL_KEY, MANUAL_GROUPS, manualDocMetas } from '@/lib/manual';

/**
 * 사용설명서 — 설명서마다 주소가 따로(/manual/<화면>) 있는 정적 화면(DB·시트 안 읽음, 빌드 때 미리 만듦).
 * 틀(Shell + 왼쪽 목록)은 여기 있어서 설명서를 바꿔도 다시 안 그림. 내용: lib/manual/docs/*.ts
 */
export default function ManualLayout({ children }: { children: ReactNode }) {
  return (
    <Shell activeMenu="사용설명서" title="📖 사용설명서" note="화면별 사용법 — 처음 쓰는 분 기준, 링크로 보내기 좋게">
      <ManualFrame groups={MANUAL_GROUPS} docs={manualDocMetas()} defaultKey={DEFAULT_MANUAL_KEY}>
        {children}
      </ManualFrame>
    </Shell>
  );
}
