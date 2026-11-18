import { Suspense } from 'react';
import ConsumablesPage from '@/components/consumables/ConsumablesPage';
import PageLoading from '@/components/PageLoading';
import SetupGuide from '@/components/SetupGuide';
import Shell from '@/components/Shell';
import { isConsumablesSheetConfigured, listConsumablesFromSheet } from '@/lib/inventory/consumablesSheet';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!isConsumablesSheetConfigured()) {
    return (
      <Shell activeMenu="소모품 가격표" title="🧰 소모품 가격표">
        <SetupGuide source="sheets" />
      </Shell>
    );
  }

  // 메뉴·제목은 바로 보내고, 소모품 시트를 읽는 동안 본문 자리에 "불러오는 중"을 보여 줍니다.
  return (
    <Shell
      activeMenu="소모품 가격표"
      title="🧰 소모품 가격표"
      note="IT 소모품 판매 단가 기준표 — 구글시트 소모품구매판매 탭과 연동"
    >
      <Suspense fallback={<PageLoading label="소모품 시트를 읽는 중이에요" />}>
        <ConsumablesContent />
      </Suspense>
    </Shell>
  );
}

async function ConsumablesContent() {
  let items;
  try {
    items = await listConsumablesFromSheet();
  } catch (err) {
    return <SetupGuide source="sheets" error={err instanceof Error ? err.message : String(err)} />;
  }
  return <ConsumablesPage items={items} />;
}
