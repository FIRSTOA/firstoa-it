import Shell from '@/components/Shell';
import ShipmentPrepPage from '@/components/shipmentPrep/ShipmentPrepPage';

export const dynamic = 'force-dynamic';
// 네이버 동기화·제목 태그 수정이 같이 도는 서버 액션이 있어 넉넉하게.
// 완료 보고 발송 뒤 재고 위치 변경(after)이 여러 대면 오래 걸려서 넉넉하게.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?event=<일정 id>` — 영업 확인서 상세의 출고 준비 상자에서 넘어올 때 그 일정으로 스크롤·강조(4-1, H11).
 * 일정 id(uuid) 꼴이 아니면 무시(목록은 그대로).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = typeof sp.event === 'string' ? sp.event.trim() : '';
  const focusEventId = UUID_RE.test(raw) ? raw.toLowerCase() : null;
  return (
    <Shell activeMenu="출고 준비 리스트" title="✨ 출고 준비 리스트" note="네이버 캘린더 별표(★) IT 일정 — 준비 체크 · 완료 보고 · 카톡 발송">
      <ShipmentPrepPage focusEventId={focusEventId} />
    </Shell>
  );
}
