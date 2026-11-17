'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 전체 화면 사진 뷰어(라이트박스) — 원본: first-as-search AlbumViewerPage 상세 모드.
 * 원본 기능(휠 확대, 드래그 이동, 회전/맞춤/선명하게/다운로드, ← → R Esc, 썸네일 줄)에
 * 휴대폰 갤러리식 조작(두 손가락 확대, 두 번 탭, 확대 중 한 손가락 이동, 확대 안 됐을 때만
 * 좌우 스와이프)을 더했습니다. 확대는 0.3~5배, ✨선명하게는 화면 필터일 뿐 다운로드는 원본.
 */
export type LightboxPhoto = { url: string; name?: string };

type Props = { photos: LightboxPhoto[]; startIndex: number; title?: string; onClose: () => void };

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 5;
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +z.toFixed(3)));

type Pt = { x: number; y: number };

export default function PhotoLightbox({ photos, startIndex, title, onClose }: Props) {
  const [idx, setIdx] = useState(Math.min(Math.max(startIndex, 0), photos.length - 1));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [sharp, setSharp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const areaRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  // 최신 값 참조(이벤트 핸들러용)
  const view = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  view.current = { zoom, pan };

  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<
    | { kind: 'pan'; id: number; start: Pt; startPan: Pt }
    | { kind: 'swipe'; id: number; start: Pt; t: number }
    | { kind: 'pinch'; startDist: number; startMid: Pt; startZoom: number; startPan: Pt }
    | null
  >(null);
  const lastTap = useRef<{ t: number; p: Pt } | null>(null);
  const lastPointerType = useRef('mouse');

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= photos.length) return;
      setIdx(i);
      reset();
    },
    [photos.length, reset],
  );
  const prev = useCallback(() => goTo(idx - 1), [goTo, idx]);
  const next = useCallback(() => goTo(idx + 1), [goTo, idx]);

  /** 화면 좌표 p(영역 중심 기준)를 고정점으로 확대/축소. */
  const zoomAt = useCallback((nextZoom: number, p: Pt) => {
    const { zoom: z, pan: pn } = view.current;
    const nz = clampZoom(nextZoom);
    const k = nz / z;
    setZoom(nz);
    setPan(nz <= 1 ? { x: 0, y: 0 } : { x: p.x - (p.x - pn.x) * k, y: p.y - (p.y - pn.y) * k });
  }, []);

  const toLocal = (clientX: number, clientY: number): Pt => {
    const r = areaRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };

  // 키보드
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'r' || e.key === 'R') setRotation((r) => (r + 90) % 360);
      else if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomAt(view.current.zoom * 1.2, { x: 0, y: 0 });
      else if (e.key === '-') zoomAt(view.current.zoom / 1.2, { x: 0, y: 0 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose, zoomAt]);

  // 휠 확대 — 마우스 포인터 위치 기준
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(view.current.zoom * factor, toLocal(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // 페이지 자체 확대(iOS 제스처) 막기 + 뒤 화면 스크롤 막기
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // 썸네일 자동 스크롤
  useEffect(() => {
    const el = thumbRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [idx]);

  function startPinch() {
    const [a, b] = [...pointers.current.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture.current = {
      kind: 'pinch',
      startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      startMid: mid,
      startZoom: view.current.zoom,
      startPan: view.current.pan,
    };
  }

  function startSingle(id: number, p: Pt) {
    if (view.current.zoom > 1) {
      gesture.current = { kind: 'pan', id, start: p, startPan: view.current.pan };
      setDragging(true);
    } else {
      gesture.current = { kind: 'swipe', id, start: p, t: Date.now() };
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    lastPointerType.current = e.pointerType;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toLocal(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) startPinch();
    else if (pointers.current.size === 1) startSingle(e.pointerId, p);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toLocal(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nz = clampZoom(g.startZoom * (dist / g.startDist));
      const k = nz / g.startZoom;
      setZoom(nz);
      // 손가락 사이 중점을 고정점으로(두 손가락으로 끌면 같이 이동)
      setPan({ x: mid.x - (g.startMid.x - g.startPan.x) * k, y: mid.y - (g.startMid.y - g.startPan.y) * k });
    } else if (g.kind === 'pan' && g.id === e.pointerId) {
      setPan({ x: g.startPan.x + (p.x - g.start.x), y: g.startPan.y + (p.y - g.start.y) });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const p = pointers.current.get(e.pointerId) ?? toLocal(e.clientX, e.clientY);
    const g = gesture.current;
    pointers.current.delete(e.pointerId);

    if (g?.kind === 'pinch') {
      if (view.current.zoom <= 1) setPan({ x: 0, y: 0 });
      // 한 손가락이 남아 있으면 그 손가락으로 이동 계속(옆 사진으로 넘어가지 않게 swipe는 시작 안 함)
      const rest = [...pointers.current.entries()][0];
      if (rest && view.current.zoom > 1) {
        gesture.current = { kind: 'pan', id: rest[0], start: rest[1], startPan: view.current.pan };
      } else {
        gesture.current = null;
        setDragging(false);
      }
      return;
    }

    if (g?.kind === 'swipe' && g.id === e.pointerId) {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      const moved = Math.hypot(dx, dy);
      if (e.pointerType !== 'mouse' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) prev();
        else next();
      } else if (e.pointerType !== 'mouse' && moved < 10 && Date.now() - g.t < 300) {
        handleTap(p);
      }
    } else if (g?.kind === 'pan' && e.pointerType !== 'mouse') {
      const moved = Math.hypot(p.x - g.start.x, p.y - g.start.y);
      if (moved < 10) handleTap(p);
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    }
  }

  /** 두 번 탭: 2배 확대 ↔ 맞춤 */
  function handleTap(p: Pt) {
    const now = Date.now();
    const last = lastTap.current;
    if (last && now - last.t < 300 && Math.hypot(p.x - last.p.x, p.y - last.p.y) < 30) {
      lastTap.current = null;
      if (view.current.zoom > 1) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else zoomAt(2, p);
    } else lastTap.current = { t: now, p };
  }

  async function download() {
    const photo = photos[idx];
    setDownloading(true);
    try {
      const resp = await fetch(photo.url, { mode: 'cors' });
      const blob = await resp.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = photo.name || `${title || 'photo'}_${idx + 1}.jpg`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      alert('다운로드 실패: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDownloading(false);
    }
  }

  const current = photos[idx];
  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-label="사진 뷰어"
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000', color: '#fff', display: 'flex', flexDirection: 'column', touchAction: 'none' }}
    >
      <div style={{ padding: '6px 10px', background: '#0f172a', borderBottom: '1px solid #1e293b', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <span style={pill}>
          {idx + 1} / {photos.length}
        </span>
        <Btn onClick={() => zoomAt(zoom / 1.2, { x: 0, y: 0 })}>−</Btn>
        <span style={{ ...pill, minWidth: 52 }} title="휠·두 손가락으로도 확대/축소">
          {Math.round(zoom * 100)}%
        </span>
        <Btn onClick={() => zoomAt(zoom * 1.2, { x: 0, y: 0 })}>+</Btn>
        <Btn onClick={() => setRotation((r) => (r + 90) % 360)}>🔄 회전</Btn>
        <Btn onClick={reset}>📐 맞춤</Btn>
        <Btn onClick={() => setSharp((s) => !s)} active={sharp}>
          ✨ 선명하게
        </Btn>
        <Btn onClick={download} disabled={downloading}>
          {downloading ? '⏳' : '💾'} 다운로드
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn onClick={onClose}>✕ 닫기</Btn>
      </div>

      <div
        ref={areaRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          // 터치 두 번 탭은 handleTap이 처리 — 여기선 마우스 더블클릭만
          if (lastPointerType.current !== 'mouse' || (e.target as HTMLElement).closest('button')) return;
          if (zoom > 1) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else zoomAt(2, toLocal(e.clientX, e.clientY));
        }}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          touchAction: 'none',
          cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
      >
        {photos.length > 1 && idx > 0 && (
          <button type="button" onClick={prev} style={{ ...navBtn, left: 10 }} aria-label="이전 사진">
            ◀
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.url}
          src={current.url}
          alt={`사진 ${idx + 1}`}
          draggable={false}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
            transition: dragging || pointers.current.size > 1 ? 'none' : 'transform 0.15s',
            filter: sharp ? 'contrast(1.15) saturate(1.1) brightness(1.03)' : 'none',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
        {photos.length > 1 && idx < photos.length - 1 && (
          <button type="button" onClick={next} style={{ ...navBtn, right: 10 }} aria-label="다음 사진">
            ▶
          </button>
        )}
      </div>

      {photos.length > 1 && (
        <div ref={thumbRef} style={{ display: 'flex', gap: 4, padding: '5px 8px', background: '#0f172a', borderTop: '1px solid #1e293b', overflowX: 'auto', flexShrink: 0, touchAction: 'pan-x' }}>
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => goTo(i)}
              style={{ flexShrink: 0, padding: 0, background: 'none', border: `2px solid ${i === idx ? '#2563eb' : 'transparent'}`, borderRadius: 3, cursor: 'pointer' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: 'cover', display: 'block', borderRadius: 2, opacity: i === idx ? 1 : 0.6 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const pill: React.CSSProperties = {
  padding: '6px 10px',
  background: '#1e293b',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 700,
  textAlign: 'center',
};

const navBtn: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 2,
  padding: '14px 10px',
  background: 'rgba(0,0,0,0.5)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 24,
  cursor: 'pointer',
  lineHeight: 1,
};

function Btn({ onClick, children, active, disabled }: { onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 10px',
        background: active ? '#2563eb' : '#334155',
        color: '#fff',
        border: 'none',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
