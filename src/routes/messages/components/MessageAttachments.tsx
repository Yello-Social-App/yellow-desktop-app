import type { ChatAttachment } from '@shared/ipc-types';
import { Download, FileText, ImageOff } from 'lucide-react';
import { useState } from 'react';

import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';

interface MessageAttachmentsProps {
  attachments: readonly ChatAttachment[];
  isMine: boolean;
  /** Re-sign an expired link; the store decides whether it really expired. */
  onExpired: (attachment: ChatAttachment) => void;
  onSave: (attachmentId: string) => void;
}

/**
 * Images inline, files as a chip with a save button.
 *
 * The split follows the service, not the file name: it sniffs the bytes and
 * marks JPEG/PNG/GIF/WebP as IMAGE, everything else (an SVG, a PDF, an HTML
 * page) as FILE with a forced download. So only IMAGE is ever put in an
 * `<img>`, and a FILE is never opened by this app — it is saved, by the main
 * process, to where the user chose.
 */
export function MessageAttachments({
  attachments,
  isMine,
  onExpired,
  onSave,
}: MessageAttachmentsProps) {
  const [viewing, setViewing] = useState<number | null>(null);
  const images = attachments.filter((a) => a.kind === 'IMAGE');
  const files = attachments.filter((a) => a.kind === 'FILE');

  return (
    <div className={cn('flex flex-col gap-1', isMine ? 'items-end' : 'items-start')}>
      {images.length > 0 && (
        <div
          className={cn(
            'grid max-w-[320px] gap-1 overflow-hidden rounded-2xl',
            images.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
          )}
        >
          {images.map((image, index) => (
            <ChatImage
              key={image.id}
              image={image}
              isSingle={images.length === 1}
              onOpen={() => {
                setViewing(index);
              }}
              onExpired={onExpired}
            />
          ))}
        </div>
      )}

      {files.map((file) => (
        <div
          key={file.id}
          className="bg-surface-container-high border-outline-variant flex max-w-[320px] items-center gap-2 rounded-2xl border py-2 pr-2 pl-3"
        >
          <FileText aria-hidden className="text-on-surface-variant size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="text-on-surface block truncate text-[14px] font-medium">
              {file.fileName}
            </span>
            <span className="text-on-surface-variant block text-[12px]">
              {formatBytes(file.sizeBytes)}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Save ${file.fileName}`}
            title="Save"
            disabled={file.url === null}
            onClick={() => {
              onSave(file.id);
            }}
            className="text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface transition-tone flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
          >
            <Download aria-hidden className="size-4" />
          </button>
        </div>
      ))}

      {viewing !== null && (
        <ImageLightbox
          images={images
            .filter((image) => image.url !== null)
            .map((image) => ({ url: image.url ?? '', alt: image.fileName }))}
          initialIndex={viewing}
          onClose={() => {
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

interface ChatImageProps {
  image: ChatAttachment;
  isSingle: boolean;
  onOpen: () => void;
  onExpired: (attachment: ChatAttachment) => void;
}

/**
 * One inline image. Its link is presigned for an hour; when it fails to load
 * the store is asked to re-sign it, and the new `url` re-renders this in place.
 * A link that fails while still valid (CSP, a removed file) shows a placeholder
 * rather than asking again forever.
 */
function ChatImage({ image, isSingle, onOpen, onExpired }: ChatImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const isBroken = image.url === null || failedUrl === image.url;

  if (isBroken) {
    return (
      <span
        className={cn(
          'bg-surface-container text-on-surface-variant flex items-center justify-center gap-2 text-[12px]',
          isSingle ? 'h-40 w-64' : 'aspect-square',
        )}
      >
        <ImageOff aria-hidden className="size-4" />
        Image unavailable
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${image.fileName}`}
      className="bg-surface-container block overflow-hidden"
    >
      <img
        src={image.url ?? undefined}
        alt={image.fileName}
        loading="lazy"
        referrerPolicy="no-referrer"
        // Dragging an attachment out of the thread must not read as a drop
        // back into it and upload it a second time.
        draggable={false}
        onError={() => {
          setFailedUrl(image.url);
          onExpired(image);
        }}
        className={cn(
          'block object-cover transition-transform hover:scale-[1.02]',
          isSingle ? 'max-h-80 w-auto max-w-[320px]' : 'aspect-square w-full',
        )}
      />
    </button>
  );
}
