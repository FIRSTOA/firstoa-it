import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ManualDocView from '@/components/manual/ManualDocView';
import { DEFAULT_MANUAL_KEY, getManualDoc } from '@/lib/manual';

export const metadata: Metadata = { title: '사용설명서 · FIRSTOA ERP' };

/** /manual — 주소에 화면 이름이 없으면 첫 설명서(처음 시작하기) */
export default function ManualIndexPage() {
  const doc = getManualDoc(DEFAULT_MANUAL_KEY);
  if (!doc) notFound();
  return <ManualDocView doc={doc} />;
}
