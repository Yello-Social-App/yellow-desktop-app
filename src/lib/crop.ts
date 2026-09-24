/**
 * Square crops of an image, for avatars.
 *
 * The *view* is where the image sits inside a square viewport — a zoom and the
 * offset of its top-left corner, in viewport pixels. The *area* is what that
 * view shows, in the image's own pixels, and is what gets cut. The cropper
 * edits the view; everything else only ever sees the area.
 *
 * Plain functions rather than a class: every step is view in, view out, which
 * is what lets the cropper hold the view in one piece of React state.
 */
import { fail, ok, type Result } from './result';

export interface CropView {
  zoom: number;
  x: number;
  y: number;
}

export interface CropArea {
  x: number;
  y: number;
  size: number;
}

export interface CropFrame {
  imageWidth: number;
  imageHeight: number;
  /** The viewport's edge, in CSS pixels. */
  viewport: number;
}

/** 1 is "the short side fills the viewport"; the image can never be smaller. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** CSS pixels per image pixel at `zoom`. */
export function scaleOf(frame: CropFrame, zoom: number): number {
  return (frame.viewport / Math.min(frame.imageWidth, frame.imageHeight)) * zoom;
}

/** Keeps the image covering the viewport, so no empty edge can be cropped in. */
export function clampView(frame: CropFrame, view: CropView): CropView {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = scaleOf(frame, zoom);
  return {
    zoom,
    x: clamp(view.x, frame.viewport - frame.imageWidth * scale, 0),
    y: clamp(view.y, frame.viewport - frame.imageHeight * scale, 0),
  };
}

/** The whole short side, centred on the long one. */
export function centredView(frame: CropFrame): CropView {
  const scale = scaleOf(frame, MIN_ZOOM);
  return {
    zoom: MIN_ZOOM,
    x: (frame.viewport - frame.imageWidth * scale) / 2,
    y: (frame.viewport - frame.imageHeight * scale) / 2,
  };
}

/** Zooms to `zoom` while the viewport point (`px`, `py`) stays over the same pixel. */
export function zoomAround(
  frame: CropFrame,
  view: CropView,
  zoom: number,
  px: number,
  py: number,
): CropView {
  const ratio = scaleOf(frame, clamp(zoom, MIN_ZOOM, MAX_ZOOM)) / scaleOf(frame, view.zoom);
  return clampView(frame, {
    zoom,
    x: px - (px - view.x) * ratio,
    y: py - (py - view.y) * ratio,
  });
}

export function areaOf(frame: CropFrame, view: CropView): CropArea {
  const scale = scaleOf(frame, view.zoom);
  return { x: -view.x / scale, y: -view.y / scale, size: frame.viewport / scale };
}

/**
 * Cuts `area` out of `src` as a PNG no larger than `maxEdge` square. A small
 * area is kept at its own size rather than blown up to `maxEdge`. An animated
 * GIF comes out as its first frame.
 */
export async function cropToPng(
  src: string,
  area: CropArea,
  maxEdge: number,
): Promise<Result<Uint8Array<ArrayBuffer>, string>> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    return fail('That photo could not be read.');
  }

  const edge = Math.max(1, Math.min(maxEdge, Math.round(area.size)));
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (context === null) {
    return fail('The photo could not be cropped.');
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, area.x, area.y, area.size, area.size, 0, 0, edge, edge);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (blob === null) {
    return fail('The photo could not be cropped.');
  }
  return ok(new Uint8Array(await blob.arrayBuffer()));
}
