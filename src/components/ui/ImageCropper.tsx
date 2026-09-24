import { ZoomIn, ZoomOut } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { cn } from '@/lib/cn';
import {
  areaOf,
  centredView,
  clampView,
  MAX_ZOOM,
  MIN_ZOOM,
  scaleOf,
  zoomAround,
  type CropArea,
  type CropFrame,
  type CropView,
} from '@/lib/crop';

interface ImageCropperProps {
  src: string;
  /** Round for avatars; the crop itself is always square. */
  shape?: 'circle' | 'square';
  /** The area in view, whenever it changes; null until the image has loaded. */
  onAreaChange: (area: CropArea | null) => void;
}

/** Zoom factor per wheel pixel: one notch (~100px) is about 20%. */
const WHEEL_ZOOM_RATE = 0.002;
const KEY_PAN_PX = 10;
const KEY_ZOOM_STEP = 0.1;

/**
 * A square crop picker: drag the photo to position it, zoom with the slider,
 * the scroll wheel, or + and −; the arrow keys move it too.
 *
 * The image is placed with a CSS transform written through its ref — a CSSOM
 * write, which the strict CSP allows where an inline `style` attribute would
 * not be. Remount it (a `key`) to start over on a new `src`.
 */
export function ImageCropper({ src, shape = 'circle', onAreaChange }: ImageCropperProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; from: CropView } | null>(
    null,
  );
  const [frame, setFrame] = useState<CropFrame | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  const [failed, setFailed] = useState(false);
  const hintId = useId();

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image === null || frame === null || view === null) {
      return;
    }
    const scale = scaleOf(frame, view.zoom);
    image.style.transform = `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(scale)})`;
  }, [frame, view]);

  useEffect(() => {
    onAreaChange(frame === null || view === null ? null : areaOf(frame, view));
  }, [frame, view, onAreaChange]);

  // A native listener, because React's wheel handler is passive and could not
  // stop the dialog scrolling underneath.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null || frame === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      setView((current) =>
        current === null
          ? current
          : zoomAround(
              frame,
              current,
              current.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
              event.clientX - bounds.left,
              event.clientY - bounds.top,
            ),
      );
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
    };
  }, [frame]);

  const zoomFromCentre = (zoom: number): void => {
    if (frame === null) {
      return;
    }
    const centre = frame.viewport / 2;
    setView((current) =>
      current === null ? current : zoomAround(frame, current, zoom, centre, centre),
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (view === null || event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: view,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId || frame === null) {
      return;
    }
    setView(
      clampView(frame, {
        ...current.from,
        x: current.from.x + event.clientX - current.startX,
        y: current.from.y + event.clientY - current.startY,
      }),
    );
  };

  const endDrag = (): void => {
    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (frame === null || view === null) {
      return;
    }
    const step = event.shiftKey ? KEY_PAN_PX * 4 : KEY_PAN_PX;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      setView(clampView(frame, { ...view, x: view.x + move[0], y: view.y + move[1] }));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomFromCentre(view.zoom + KEY_ZOOM_STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomFromCentre(view.zoom - KEY_ZOOM_STEP);
    }
  };

  if (failed) {
    return (
      <p role="alert" className="text-error text-[13px]">
        This photo could not be shown. Try another one.
      </p>
    );
  }

  return (
    <div className="gap-md flex flex-col items-center">
      <div
        ref={viewportRef}
        tabIndex={0}
        role="group"
        aria-label="Photo crop"
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={cn(
          'bg-surface-container-high relative size-72 shrink-0 touch-none overflow-hidden rounded-2xl select-none',
          'focus-visible:ring-primary cursor-grab outline-none focus-visible:ring-2 active:cursor-grabbing',
        )}
      >
        <img
          ref={imageRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            const viewport = viewportRef.current?.clientWidth ?? 0;
            if (viewport === 0 || image.naturalWidth === 0 || image.naturalHeight === 0) {
              setFailed(true);
              return;
            }
            const loaded = {
              imageWidth: image.naturalWidth,
              imageHeight: image.naturalHeight,
              viewport,
            };
            setFrame(loaded);
            setView(centredView(loaded));
          }}
          onError={() => {
            setFailed(true);
          }}
          className={cn(
            'pointer-events-none absolute top-0 left-0 max-w-none origin-top-left',
            view === null && 'opacity-0',
          )}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 ring-2 ring-white/80 ring-inset',
            shape === 'circle' && 'rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.5)]',
          )}
        />
      </div>

      <p id={hintId} className="sr-only">
        Drag, or use the arrow keys, to move the photo. Use the slider, the scroll wheel, or plus
        and minus to zoom.
      </p>

      <div className="text-on-surface-variant flex w-72 items-center gap-2">
        <ZoomOut aria-hidden className="size-4 shrink-0" />
        <input
          type="range"
          aria-label="Zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={view?.zoom ?? MIN_ZOOM}
          disabled={view === null}
          onChange={(event) => {
            zoomFromCentre(Number(event.target.value));
          }}
          className="accent-primary-container w-full cursor-pointer"
        />
        <ZoomIn aria-hidden className="size-4 shrink-0" />
      </div>
    </div>
  );
}
