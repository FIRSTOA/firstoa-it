import { NextResponse } from 'next/server';
import { syncPrepTitleTag } from '@/app/shipment-prep/actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 체크 저장 뒤 네이버 제목 태그 반영 — 버튼 응답과 분리해서 따로 돕니다. */
export async function POST(req: Request) {
  const { eventId } = (await req.json().catch(() => ({}))) as { eventId?: string };
  if (!eventId) return NextResponse.json({ ok: false, error: 'eventId 없음' }, { status: 400 });
  return NextResponse.json(await syncPrepTitleTag(eventId));
}
