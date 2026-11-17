import { NextResponse } from 'next/server';
import { triggerPrepSync } from '@/app/shipment-prep/actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 출고 준비 화면의 60초 네이버 동기화. 서버 액션은 한 화면에서 차례로 하나씩만 처리돼서
 * 오래 걸리는 동기화가 체크 버튼을 붙잡고 있었어요 — 일반 API로 빼서 버튼과 따로 돌게 합니다.
 */
export async function POST() {
  return NextResponse.json(await triggerPrepSync());
}
