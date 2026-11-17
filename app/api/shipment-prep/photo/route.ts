import { NextResponse } from 'next/server';
import { storePrepPhotoFile } from '@/app/shipment-prep/reportActions';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 사진 1장 저장 — 서버 액션은 하나씩만 처리돼서, 여러 장을 동시에 올리도록 API로 뺌. */
export async function POST(req: Request) {
  const { eventId, base64, mediaType } = (await req.json().catch(() => ({}))) as { eventId?: string; base64?: string; mediaType?: string };
  if (!eventId || !base64) return NextResponse.json({ ok: false, error: '사진 데이터가 없어요.' }, { status: 400 });
  return NextResponse.json(await storePrepPhotoFile(eventId, base64, mediaType || 'image/jpeg'));
}
