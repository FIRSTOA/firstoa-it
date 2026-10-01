import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import StocktakeSessionPage from '@/components/stocktake/StocktakeSessionPage';
import { rowToStocktakeSession, type StocktakeSessionRow } from '@/lib/stocktake';
import { createAdminClient, STOCKTAKE_TABLE } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(STOCKTAKE_TABLE).select('*').eq('id', id).maybeSingle();

  if (error || !data) notFound();

  const session = rowToStocktakeSession(data as StocktakeSessionRow);

  return (
    <Shell activeMenu="실재고 조사" title={`📋 실재고 조사 — ${session.location}`}>
      <StocktakeSessionPage session={session} />
    </Shell>
  );
}
