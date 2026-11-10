import 'server-only';

/**
 * firstoa-works(별도 ERP, Supabase 프로젝트 ajpcadmhfumcdwjseqez)의 assets/billings
 * 테이블을 읽기 전용으로 조회하는 클라이언트입니다. 같은 Supabase JS 클라이언트 대신 REST
 * (PostgREST)를 직접 호출합니다 — firstoa-it은 이미 자기 Supabase 프로젝트용
 * @supabase/supabase-js 클라이언트(lib/supabase/server.ts)를 쓰고 있어서, 두 번째 프로젝트도
 * 같은 패키지로 클라이언트를 하나 더 만드는 대신 가벼운 fetch 래퍼로 충분합니다.
 *
 * 페이지당 1000행 캡을 실측 확인했습니다(limit=5000 요청해도 1000행만 돌아옴) — 그래서
 * Range 헤더로 페이지네이션하고, 왕복 시간을 줄이려 여러 페이지를 동시에 요청합니다.
 */

const WORKS_URL = process.env.WORKS_SUPABASE_URL;
const WORKS_KEY = process.env.WORKS_SUPABASE_SERVICE_ROLE_KEY;

const PAGE_SIZE = 1000;
const CONCURRENCY = 8;

export function isWorksConfigured(): boolean {
  return Boolean(WORKS_URL && WORKS_KEY);
}

function headers(): HeadersInit {
  return { apikey: WORKS_KEY!, Authorization: `Bearer ${WORKS_KEY}` };
}

function requireConfig(): { url: string; key: string } {
  if (!WORKS_URL || !WORKS_KEY) {
    throw new Error('WORKS_SUPABASE_URL / WORKS_SUPABASE_SERVICE_ROLE_KEY 환경변수가 없어요.');
  }
  return { url: WORKS_URL, key: WORKS_KEY };
}

async function fetchCount(table: string): Promise<number> {
  const { url } = requireConfig();
  const res = await fetch(`${url}/rest/v1/${table}?select=id`, {
    headers: { ...headers(), Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok) throw new Error(`firstoa-works ${table} 건수 조회 실패: ${res.status}`);
  const range = res.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

async function fetchPage<T>(table: string, selectCols: string, offset: number): Promise<T[]> {
  const { url } = requireConfig();
  const res = await fetch(`${url}/rest/v1/${table}?select=${selectCols}`, {
    headers: { ...headers(), Range: `${offset}-${offset + PAGE_SIZE - 1}` },
  });
  if (!res.ok) throw new Error(`firstoa-works ${table} 조회 실패(offset=${offset}): ${res.status}`);
  return (await res.json()) as T[];
}

/**
 * table 전체를 페이지네이션으로 읽어옵니다. 한 페이지라도 실패하면 즉시 throw합니다 —
 * 일부만 받아온 상태로 호출부가 반영(upsert/delete)을 진행하면 안 되기 때문입니다
 * (기존 구글시트 동기화와 같은 안전 원칙 — lib/rentals/sync.ts 참고).
 */
export async function fetchAllWorksRows<T>(table: string, selectCols: string): Promise<T[]> {
  const total = await fetchCount(table);
  const offsets: number[] = [];
  for (let o = 0; o < total; o += PAGE_SIZE) offsets.push(o);

  const pagesAll: T[][] = new Array(offsets.length);
  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
    const batch = offsets.slice(i, i + CONCURRENCY);
    const pages = await Promise.all(batch.map((offset) => fetchPage<T>(table, selectCols, offset)));
    pages.forEach((page, j) => {
      pagesAll[i + j] = page;
    });
  }
  return pagesAll.flat();
}
