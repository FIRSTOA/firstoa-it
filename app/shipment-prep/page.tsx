import Shell from '@/components/Shell';
import ShipmentPrepPage from '@/components/shipmentPrep/ShipmentPrepPage';

export const dynamic = 'force-dynamic';
// 네이버 동기화·제목 태그 수정이 같이 도는 서버 액션이 있어 넉넉하게.
// 완료 보고 발송 뒤 재고 위치 변경(after)이 여러 대면 오래 걸려서 넉넉하게.
export const maxDuration = 300;

export default function Page() {
  return (
    <Shell activeMenu="출고 준비 리스트" title="✨ 출고 준비 리스트" note="네이버 캘린더 별표(★) IT 일정 — 준비 체크 · 완료 보고 · 카톡 발송">
      <ShipmentPrepPage />
    </Shell>
  );
}
