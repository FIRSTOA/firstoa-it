import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ManualDocView from '@/components/manual/ManualDocView';
import { MANUAL_DOCS, getManualDoc } from '@/lib/manual';

// 목록에 있는 설명서만 빌드 때 미리 만듦 — 없는 이름은 404
export const dynamicParams = false;

export function generateStaticParams() {
  return MANUAL_DOCS.map((d) => ({ doc: d.key }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  const d = getManualDoc(doc);
  return { title: d ? `${d.title} 사용설명서 · FIRSTOA ERP` : '사용설명서 · FIRSTOA ERP' };
}

export default async function ManualDocPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = getManualDoc(doc);
  if (!d) notFound();
  return <ManualDocView doc={d} />;
}
