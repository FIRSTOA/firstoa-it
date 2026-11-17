import { getAlbum } from '@/app/shipment-prep/reportActions';
import { shortDateLabel } from '@/lib/shipmentPrep';

export const dynamic = 'force-dynamic';

/** 카톡 보고의 "📷 사진 모아보기" 공개 뷰어 — 로그인 없이 사진만 보여줍니다. */
export default async function AlbumPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const album = id ? await getAlbum(id) : null;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '16px', background: '#fff', minHeight: '100vh' }}>
      {!album ? (
        <p style={{ color: '#64748b' }}>앨범을 찾을 수 없어요.</p>
      ) : (
        <>
          <h1 style={{ fontSize: 18, margin: '4px 0 2px' }}>📷 {album.title}</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>
            {album.date ? `${shortDateLabel(album.date)} · ` : ''}사진 {album.photos.length}장
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 10 }}>
            {album.photos.map((p, i) => (
              <a key={p.path} href={p.url} target="_blank" rel="noreferrer" style={{ position: 'relative', display: 'block' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`사진 ${i + 1}`} style={{ width: '100%', borderRadius: 8, display: 'block' }} loading="lazy" />
                <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 12, padding: '1px 7px', borderRadius: 5 }}>
                  {i + 1}
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
