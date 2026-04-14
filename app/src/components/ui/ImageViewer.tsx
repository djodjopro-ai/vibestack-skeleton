import { useEffect, useRef, useState, useCallback } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface ImageViewerProps {
  src: string | null;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

export default function ImageViewer({ src, onClose }: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!src) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
      else if (e.key === "-" || e.key === "_") setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
      else if (e.key === "0") { setZoom(1); setOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return;
    draggingRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    setOffset({ x: e.clientX - draggingRef.current.x, y: e.clientY - draggingRef.current.y });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={onClose}
    >
      <div
        className="absolute top-4 right-4 flex items-center gap-2 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
          disabled={zoom <= MIN_ZOOM}
          className="rounded-lg bg-white/10 hover:bg-white/20 text-white p-2 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Zoom out (-)"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="text-white text-xs font-mono min-w-[48px] text-center select-none">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
          disabled={zoom >= MAX_ZOOM}
          className="rounded-lg bg-white/10 hover:bg-white/20 text-white p-2 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Zoom in (+)"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
          className="rounded-lg bg-white/10 hover:bg-white/20 text-white p-2"
          title="Reset (0)"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-white/10 hover:bg-white/20 text-white p-2"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className="w-full h-full flex items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: zoom > 1 ? (draggingRef.current ? "grabbing" : "grab") : "default" }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setZoom((z) => (z === 1 ? 2 : 1));
            if (zoom !== 1) setOffset({ x: 0, y: 0 });
          }}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transition: draggingRef.current ? "none" : "transform 0.15s ease-out",
            maxWidth: "95vw",
            maxHeight: "95vh",
            userSelect: "none",
            transformOrigin: "center center",
          }}
        />
      </div>
    </div>
  );
}
