import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';

interface CallVideoProps {
  track: LocalVideoTrack | RemoteVideoTrack;
  /** The self view reads as a mirror, as every camera app draws it. */
  isMirrored?: boolean;
  /** `contain` for a shared screen, whose edges matter; `cover` for a face. */
  fit?: 'cover' | 'contain';
  className?: string;
}

/**
 * One video track in a `<video>`. LiveKit attaches the stream itself (and
 * pauses delivery of a remote track nobody is drawing); the element is muted
 * because a call's sound plays from the room's own audio elements.
 */
export function CallVideo({ track, isMirrored = false, fit = 'cover', className }: CallVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        'size-full',
        fit === 'cover' ? 'object-cover' : 'object-contain',
        isMirrored && '-scale-x-100',
        className,
      )}
    />
  );
}
