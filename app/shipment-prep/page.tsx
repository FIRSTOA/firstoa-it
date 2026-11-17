import Shell from '@/components/Shell';
import ShipmentPrepPage from '@/components/shipmentPrep/ShipmentPrepPage';

export const dynamic = 'force-dynamic';
// 네이버 동기화·제목 태그 수정이 같이 도는 서버 액션이 있어 넉넉하게.
export const maxDuration = 60;

export default function Page() {
  return (
    <Shell activeMenu="출고 준비 리스트" title="✨ 출고 준비 리스트" note="네이버 캘린더 별표(★) IT 일정 — 준비 체크 · 완료 보고 · 카톡 발송">
      <ShipmentPrepPage />
    </Shell>
  );
}
