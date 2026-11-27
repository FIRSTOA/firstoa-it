import { NextResponse } from 'next/server';
import { runSalesConfirmImport } from '@/lib/salesConfirms/importer';
import type { SalesImportTrigger } from '@/lib/salesConfirms/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TRIGGERS: readonly SalesImportTrigger[] = ['page', 'interval', 'manual', 'pick-date', 'home', 'detail', 'print'];
/** 한 건 받기({ id })에 허용하는 trigger */
const ONE_TRIGGERS: readonly SalesImportTrigger[] = ['detail', 'print'];
/** 영업 export 의 id 형식과 같은 검사 */
const ID_PATTERN = /^[a-z0-9]{6,32}$/;

/**
 * 영업 웹앱 확인서 가져오기. 서버 액션은 한 화면에서 차례로 돌아 버튼을 붙잡아서 일반 API 로 둠.
 * 응답은 건수·상태만(영업 원문 없음). 겹침은 importer 가 60초(강제 10초)로 막음.
 *   목록: { force?, since?, trigger?, diag? }
 *   한 건(E1): { id, trigger: 'detail' | 'print' } — 그 확인서 한 건만(⑤ 'one' 줄 3초 간격)
 */
export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  if (b.id !== undefined) {
    const id = typeof b.id === 'string' ? b.id : '';
    if (!ID_PATTERN.test(id) || !ONE_TRIGGERS.includes(b.trigger as SalesImportTrigger)) {
      return NextResponse.json({ ok: false, error: '요청이 올바르지 않아요' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(await runSalesConfirmImport({ id, trigger: b.trigger as SalesImportTrigger }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const force = b.force === true;
  const since = typeof b.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.since) ? b.since : undefined;
  // 목록 받기는 'detail'·'print' 를 안 씀(한 건 전용) — 모르는 값이면 'page'
  const trigger =
    TRIGGERS.includes(b.trigger as SalesImportTrigger) && !ONE_TRIGGERS.includes(b.trigger as SalesImportTrigger)
      ? (b.trigger as SalesImportTrigger)
      : 'page';
  // diag: 받은 응답의 칸 이름·종류·건수만 돌려줌(값 없음) — 응답 모양 실측용(설계 §3-6)
  const diag = b.diag === true;
  return NextResponse.json(await runSalesConfirmImport({ force, since, trigger, diag }));
}
