import { getAlbum } from '@/app/shipment-prep/reportActions';
import AlbumGallery from '@/components/shipmentPrep/AlbumGallery';
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
          <AlbumGallery photos={album.photos} title={album.title} />
        </>
      )}
    </main>
  );
}
