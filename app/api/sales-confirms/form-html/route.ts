import { claimImportGap, readSalesConfirmType } from '@/lib/salesConfirms/importer';
import { fetchSalesFormHtml, SALES_ID_PATTERN } from '@/lib/salesConfirms/source';
import type { SalesFormHtmlResult } from '@/lib/salesConfirms/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;

const HTML_GAP_MS = 2_000;

/**
 * 영업 양식 중계(설계 E8) — POST { id } → 영업 `?id=&type=&html=1`(그 순간 영업 최신 양식)을 **JSON 으로만** 감싸 돌려줌.
 * 응답에 text/html 을 절대 쓰지 않음(우리 주소에서 영업 HTML 이 페이지로 열리면 우리 쪽에서 스크립트가 돎).
 * 키는 헤더로만(source.ts). 로그엔 HTTP 숫자·reason 만(HTML·id·연락처 금지).
 */
function reply(body: SalesFormHtmlResult, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function fail(reason: Extract<SalesFormHtmlResult, { ok: false }>['reason'], message: string, status = 200): Response {
  return reply({ ok: false, reason, message }, status);
}

export async function POST(req: Request) {
  // 끄는 스위치 — 늘 받아 둔 사본으로
  if (process.env.SALES_FORM_SOURCE === 'copy') {
    return fail('copy_only', '영업 양식을 직접 받지 않도록 꺼 두었어요 — 받아 둔 양식으로 그려요');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const id = typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).id === 'string' ? ((body as Record<string, unknown>).id as string) : '';
  if (!SALES_ID_PATTERN.test(id)) return fail('bad_request', '확인서 번호가 올바르지 않아요', 400);

  // ① 에 있는 id 만
  const t = await readSalesConfirmType(id);
  if (!t.ok) return fail('db_error', t.error);
  if (t.type === null) return fail('not_found', '이 확인서를 찾지 못했어요');

  // 간격 막기 — ⑤ 'html' 줄 2초
  const gap = await claimImportGap('html', HTML_GAP_MS);
  if (!gap.ok) return fail('db_error', gap.error);
  if (!gap.claimed) return fail('busy', '방금 영업 양식을 받았어요 — 잠시 뒤 다시 해 주세요');

  const got = await fetchSalesFormHtml(id, t.type, 4_000);
  if (got.ok) return reply({ ok: true, html: got.html });
  if ('notFound' in got && got.notFound) {
    console.warn('[sales-form] 영업 404');
    return fail('not_found', '영업 웹앱에서 이 확인서를 찾지 못했어요');
  }
  if ('tooBig' in got && got.tooBig) {
    console.warn('[sales-form] too_big');
    return fail('too_big', '영업 양식이 너무 커서 받지 않았어요');
  }
  if ('code' in got) {
    console.warn(`[sales-form] ${got.code}`);
    const reason = got.code === 'no_key' || got.code === 'unauthorized' || got.code === 'unreachable' ? got.code : got.code === 'db_error' ? 'db_error' : 'unreachable';
    return fail(reason, got.error);
  }
  return fail('unreachable', '영업 웹앱이 응답하지 않아요');
}
