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
 *
 * forceFull: true로 호출 — 완료 체크처럼 기존 일정의 속성만 바뀌는 경우 컬렉션 ctag가
 * 안 바뀔 수도 있어서(네이버 서버 구현에 따라 다름), 페이지 방문 시 동기화는 ctag로
 * 빠르게 생략하더라도 하루 1번 이 cron만은 ctag와 무관하게 항상 전체 점검합니다.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const result = await syncNaverCalendars(true);
  return NextResponse.json(result);
}
