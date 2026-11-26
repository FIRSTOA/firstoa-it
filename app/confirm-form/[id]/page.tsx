import SalesConfirmDetail from '@/components/salesConfirms/SalesConfirmDetail';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { openSalesConfirm } from '../salesDetailActions';

export const dynamic = 'force-dynamic';
// 자산번호 조회(IT재고 시트 색인)·출고 준비 후보 읽기가 같이 돌 수 있어 목록 화면과 같게 넉넉히.
export const maxDuration = 60;

const MENU = '확인서/출고및반출준비';

/**
 * 영업 확인서 상세 — 주소는 salesConfirmHref(id) = /confirm-form/ + encodeURIComponent(id) 로만 만듦(lib/salesConfirms/types.ts).
 * 받은 값을 한 번 decode(실패하면 받은 그대로)해서 찾고, 못 찾았는데 decode 전 값이 다르면 그 값으로 한 번 더
 * (Next 가 이미 decode 해서 넘긴 경우 — '%' 가 든 id 를 두 번 풀지 않게).
 * **app/confirm-form/ 아래에 다른 정적 하위 폴더를 만들지 말 것** — 같은 이름의 id 를 가림(§4-2).
 * 처음 열 때는 이름을 몰라 actor '' — 화면이 이름을 안 뒤 openSalesConfirm 을 다시 불러 "처음 연 사람"을 남김.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }

  if (!isSupabaseConfigured()) {
    return (
      <Shell activeMenu={MENU} title="📋 영업 확인서">
        <SetupGuide schemaFile="supabase/sales_confirms_schema.sql" />
      </Shell>
    );
  }

  let initial = await openSalesConfirm({ id, actor: '' });
  if (!initial.ok && initial.notFound && raw !== id) initial = await openSalesConfirm({ id: raw, actor: '' });

  const title = initial.ok ? initial.data.confirm.company || initial.data.confirm.docNo || '영업 확인서' : '영업 확인서';
  return (
    <Shell activeMenu={MENU} title={title}>
      <SalesConfirmDetail initial={initial} />
    </Shell>
  );
}
