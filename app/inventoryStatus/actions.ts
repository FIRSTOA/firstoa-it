'use server';

import { revalidatePath } from 'next/cache';
import {
  rowToLocationFloorMap,
  rowToQuantityCheck,
  rowToZoneStatus,
  rowToZoneVerification,
  type LocationFloorMap,
  type LocationFloorMapRow,
  type QuantityCheck,
  type QuantityCheckRow,
  type ZoneStatus,
  type ZoneStatusRow,
  type ZoneVerification,
  type ZoneVerificationRow,
} from '@/lib/zoneStatus';
import {
  createAdminClient,
  LOCATION_FLOOR_MAP_TABLE,
  QUANTITY_CHECKS_TABLE,
  ZONE_LOCATIONS_TABLE,
  ZONE_STATUS_TABLE,
  ZONE_VERIFICATIONS_TABLE,
} from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function listZoneLocations(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(ZONE_LOCATIONS_TABLE).select('name').order('name');
  if (error) {
    console.error('[inventoryStatus] listZoneLocations 실패:', error);
    return [];
  }
  return (data ?? []).map((r) => (r as { name: string }).name);
}

/** 드롭다운에 없는 새 위치로 태깅하면 호출 — 실패해도 본 작업(위치 태깅)을 막지 않습니다. */
export async function addZoneLocationIfNew(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const supabase = createAdminClient();
  const { error } = await supabase.from(ZONE_LOCATIONS_TABLE).upsert({ name: trimmed }, { onConflict: 'name' });
  if (error) console.error('[inventoryStatus] addZoneLocationIfNew 실패:', error);
}

export async function listLocationFloorMap(): Promise<LocationFloorMap[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(LOCATION_FLOOR_MAP_TABLE).select('*');
  if (error) {
    console.error('[inventoryStatus] listLocationFloorMap 실패:', error);
    return [];
  }
  return ((data ?? []) as LocationFloorMapRow[]).map(rowToLocationFloorMap);
}

/** 위치 코드(A1/B1/K2 등) 하나를 층에 매핑합니다 — 이 코드를 쓰는 모든 자산이 한꺼번에 해결됩니다. */
export async function setLocationFloor(code: string, floor: string): Promise<ActionResult> {
  const trimmedCode = code.trim();
  if (!trimmedCode) return { ok: false, error: '코드가 비어있어요.' };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from(LOCATION_FLOOR_MAP_TABLE)
    .upsert({ code: trimmedCode, floor: floor.trim() }, { onConflict: 'code' });
  if (error) {
    console.error('[inventoryStatus] setLocationFloor 실패:', error);
    return { ok: false, error: `저장에 실패했어요: ${error.message}` };
  }
  if (floor.trim()) await addZoneLocationIfNew(floor);
  revalidatePath('/inventory-status');
  return { ok: true };
}

export async function listZoneStatuses(): Promise<ZoneStatus[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(ZONE_STATUS_TABLE).select('*');
  if (error) {
    console.error('[inventoryStatus] listZoneStatuses 실패:', error);
    return [];
  }
  return ((data ?? []) as ZoneStatusRow[]).map(rowToZoneStatus);
}

export async function listZoneVerifications(): Promise<ZoneVerification[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(ZONE_VERIFICATIONS_TABLE).select('*');
  if (error) {
    console.error('[inventoryStatus] listZoneVerifications 실패:', error);
    return [];
  }
  return ((data ?? []) as ZoneVerificationRow[]).map(rowToZoneVerification);
}

/** 자산 하나의 위치/상태(세부)를 태깅합니다 — 구글시트 원장과 무관한 Supabase 오버레이. */
export async function updateZoneStatus(
  assetId: string,
  location: string,
  conditionStatus: string,
  note = '',
  updatedBy = '',
): Promise<ActionResult> {
  const trimmed = assetId.trim();
  if (!trimmed) return { ok: false, error: '자산번호가 비어있어요.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from(ZONE_STATUS_TABLE).upsert(
    {
      asset_id: trimmed,
      location: location.trim(),
      condition_status: conditionStatus,
      note: note.trim(),
      updated_by: updatedBy.trim(),
    },
    { onConflict: 'asset_id' },
  );
  if (error) {
    console.error('[inventoryStatus] updateZoneStatus 실패:', error);
    return { ok: false, error: `저장에 실패했어요: ${error.message}` };
  }

  if (location.trim()) await addZoneLocationIfNew(location);

  revalidatePath('/inventory-status');
  revalidatePath('/');
  return { ok: true };
}

/** 위치×품목 조합에 검증자를 지정합니다(아직 검증은 안 함 — verified는 그대로 둠). */
export async function setZoneVerifier(location: string, category: string, verifierName: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from(ZONE_VERIFICATIONS_TABLE)
    .select('verified, verified_at, verified_count')
    .eq('location', location)
    .eq('category', category)
    .maybeSingle();

  const { error } = await supabase.from(ZONE_VERIFICATIONS_TABLE).upsert(
    {
      location,
      category,
      verifier_name: verifierName.trim(),
      verified: existing?.verified ?? false,
      verified_at: existing?.verified_at ?? null,
      verified_count: existing?.verified_count ?? null,
    },
    { onConflict: 'location,category' },
  );
  if (error) {
    console.error('[inventoryStatus] setZoneVerifier 실패:', error);
    return { ok: false, error: `저장에 실패했어요: ${error.message}` };
  }
  revalidatePath('/inventory-status');
  return { ok: true };
}

/** 검증자가 "확인 완료"를 누른 시점 — 그때 수량을 스냅샷으로 남겨서, 나중에 숫자가 바뀌면
 * "검증 후 변경됨"을 판단할 수 있게 합니다. */
export async function markZoneVerified(location: string, category: string, count: number): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from(ZONE_VERIFICATIONS_TABLE)
    .select('verifier_name')
    .eq('location', location)
    .eq('category', category)
    .maybeSingle();

  const { error } = await supabase.from(ZONE_VERIFICATIONS_TABLE).upsert(
    {
      location,
      category,
      verifier_name: existing?.verifier_name ?? '',
      verified: true,
      verified_at: new Date().toISOString(),
      verified_count: count,
    },
    { onConflict: 'location,category' },
  );
  if (error) {
    console.error('[inventoryStatus] markZoneVerified 실패:', error);
    return { ok: false, error: `저장에 실패했어요: ${error.message}` };
  }
  revalidatePath('/inventory-status');
  return { ok: true };
}

export async function listQuantityChecks(): Promise<QuantityCheck[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(QUANTITY_CHECKS_TABLE).select('*');
  if (error) {
    console.error('[inventoryStatus] listQuantityChecks 실패:', error);
    return [];
  }
  return ((data ?? []) as QuantityCheckRow[]).map(rowToQuantityCheck);
}

/** 자산번호/품목 매칭 없이, 위치 하나를 보고 센 대수만 입력해서 시스템 수량과 비교합니다(1차 숫자 체크). */
export async function setQuantityCheck(location: string, count: number, checkedBy: string): Promise<ActionResult> {
  const trimmedLocation = location.trim();
  if (!trimmedLocation) return { ok: false, error: '위치가 비어있어요.' };
  if (!Number.isFinite(count) || count < 0) return { ok: false, error: '대수를 올바르게 입력해주세요.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from(QUANTITY_CHECKS_TABLE).upsert(
    {
      location: trimmedLocation,
      counted_count: count,
      checked_by: checkedBy.trim(),
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'location' },
  );
  if (error) {
    console.error('[inventoryStatus] setQuantityCheck 실패:', error);
    return { ok: false, error: `저장에 실패했어요: ${error.message}` };
  }
  revalidatePath('/inventory-status');
  return { ok: true };
}
