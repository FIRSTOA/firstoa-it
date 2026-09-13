/**
 * 재고 데이터를 어디서 읽고 쓸지 결정하는 스위치.
 * 지금은 구글시트를 기본으로 쓰고, 나중에 Supabase 셋업이 끝나면
 * INVENTORY_DATA_SOURCE=supabase 로 바꿔서 되돌릴 수 있습니다.
 */
export type DataSource = 'sheets' | 'supabase';

export const DATA_SOURCE: DataSource =
  process.env.INVENTORY_DATA_SOURCE === 'supabase' ? 'supabase' : 'sheets';
