import { memo } from 'react';

import { displayLink, segmentLinks } from '@/lib/links';

interface RichTextProps {
  text: string;
  className?: string;
}

/**
 * User text with its links made clickable.
 *
 * Links open with `target="_blank"`, which the main process's window-open
 * handler turns into `shell.openExternal` for web URLs and refuses for
 * anything else — the renderer never navigates and never opens a window.
 * `rel` cuts the opener relationship as well, belt and braces.
 */
export const RichText = memo(function RichText({ text, className }: RichTextProps) {
  const segments = segmentLinks(text);

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.kind === 'link' ? (
          <a
            key={`${String(index)}:${segment.value}`}
            href={segment.value}
            target="_blank"
            rel="noopener noreferrer"
            title={segment.value}
            className="text-primary break-all hover:underline"
            onClick={(event) => {
              // A card's own click handler must not also fire.
              event.stopPropagation();
            }}
          >
            {displayLink(segment.value)}
          </a>
        ) : (
          <span key={`${String(index)}:${segment.value}`}>{segment.value}</span>
        ),
      )}
    </span>
  );
});
