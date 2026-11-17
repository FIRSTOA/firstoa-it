'use client';

import { useState } from 'react';
import PhotoLightbox from '@/components/PhotoLightbox';
import type { PrepPhoto } from '@/lib/shipmentPrep';

/** 공개 앨범(/album) 갤러리 — 사진을 누르면 전체 화면 뷰어. */
export default function AlbumGallery({ photos, title }: { photos: PrepPhoto[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 160px), 1fr))', gap: 8 }}>
        {photos.map((p, i) => (
          <button
            key={p.path}
            type="button"
            onClick={() => setOpen(i)}
            style={{ position: 'relative', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`사진 ${i + 1}`} loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, display: 'block' }} />
            <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 12, padding: '1px 7px', borderRadius: 5 }}>
              {i + 1}
            </span>
          </button>
        ))}
      </div>
      {open !== null && <PhotoLightbox photos={photos.map((p) => ({ url: p.url }))} startIndex={open} title={title} onClose={() => setOpen(null)} />}
    </>
  );
}
