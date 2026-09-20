import ConsumablesPage from '@/components/consumables/ConsumablesPage';
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

  let items;
  try {
    items = await listConsumablesFromSheet();
  } catch (err) {
    return (
      <Shell activeMenu="소모품 가격표" title="🧰 소모품 가격표">
        <SetupGuide source="sheets" error={err instanceof Error ? err.message : String(err)} />
      </Shell>
    );
  }

  return (
    <Shell
      activeMenu="소모품 가격표"
      title="🧰 소모품 가격표"
      note="IT 소모품 판매 단가 기준표 — 구글시트 소모품구매판매 탭과 연동"
    >
      <ConsumablesPage items={items} />
    </Shell>
  );
}
