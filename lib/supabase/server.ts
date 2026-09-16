import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * 환경변수가 모두 채워졌는지 확인합니다.
 * 설정 전에도 앱이 죽지 않고 안내 화면을 띄우기 위해 사용합니다.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

/**
 * service_role 키를 쓰는 서버 전용 클라이언트입니다.
 * RLS 를 우회하므로 서버(Server Component / Server Action)에서만 호출해야 합니다.
 * `import 'server-only'` 덕분에 클라이언트 컴포넌트에서 임포트하면 빌드가 실패합니다.
 */
export function createAdminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 설정하세요.',
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const ASSETS_TABLE = 'it_assets';
export const DISPATCH_TABLE = 'it_dispatch_log';
export const RECEIVING_TABLE = 'it_receiving_log';
export const ASSET_HISTORY_TABLE = 'asset_history';
export const ASSET_MOVEMENTS_TABLE = 'asset_movements';
export const ASSET_OVERHAUL_TABLE = 'asset_overhaul_records';
