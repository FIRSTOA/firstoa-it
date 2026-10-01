import { NextRequest, NextResponse } from 'next/server';
import { syncNaverCalendars } from '@/lib/naverCalendarSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron(vercel.json, 하루 1번 — Hobby 요금제 제한)이 부르는 안전망입니다.
 * 실제 동기화는 lib/naverCalendarSync.ts의 syncNaverCalendars가 하고, 캘린더 페이지를
 * 열 때마다(app/calendar/page.tsx)도 같은 함수가 best-effort로 불려서 사실상 더
 * 자주 동기화됩니다 — 이 cron은 아무도 캘린더 페이지를 열지 않는 동안에도 최소
 * 하루 한 번은 반영되게 하는 보조 장치입니다.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const result = await syncNaverCalendars();
  return NextResponse.json(result);
}
