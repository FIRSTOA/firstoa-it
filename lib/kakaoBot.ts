import 'server-only';

/**
 * 카톡 자동 전송 — 이미 다른 시스템(점검AS)에서 쓰고 있는 메신저봇R 폴링 봇 인프라를
 * 그대로 재사용합니다. 그 봇이 폴링하는 Supabase 프로젝트(이 앱과는 별개 프로젝트)의
 * outbox 테이블에 { room, text }만 insert하면, 봇이 7초 안팎으로 읽어서 해당 카톡방에
 * 그대로 게시하고 자기가 지웁니다 — 이 앱은 큐에 넣기만 하면 끝입니다.
 *
 * 이미지 첨부는 지원하지 않습니다(그 봇은 텍스트만 보냄) — 이미지를 같이 보내야 하면
 * 기존 "공유하기"(Web Share API, 시스템 공유창)를 쓰세요.
 */

export const KAKAO_ROOM_PURCHASE_APPROVAL = '신)매입 승인방';

function botSupabaseUrl(): string {
  return process.env.KAKAO_BOT_SUPABASE_URL || '';
}

function botSupabaseAnonKey(): string {
  return process.env.KAKAO_BOT_SUPABASE_ANON_KEY || '';
}

export function isKakaoBotConfigured(): boolean {
  return Boolean(botSupabaseUrl() && botSupabaseAnonKey());
}

/** outbox에 한 줄 넣습니다 — 실패하면 그대로 예외를 던지니, 호출부가 ActionResult로 감싸세요. */
export async function queueKakaoBotMessage(room: string, text: string): Promise<void> {
  const url = botSupabaseUrl();
  const key = botSupabaseAnonKey();
  if (!url || !key) throw new Error('카톡봇 연동이 설정되지 않았어요.');

  const res = await fetch(`${url}/rest/v1/outbox`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ room, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`카톡봇 큐 등록 실패(${res.status}): ${body || '알 수 없는 오류'}`);
  }
}
