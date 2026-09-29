import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useCallsStore } from '@/features/calls/store';
import { cn } from '@/lib/cn';

import { IncomingCall, RejoinCall } from './CallCards';
import { CallPill, CallWindow } from './CallWindow';
import { ScreenSourcePicker } from './ScreenSourcePicker';

/** How long the line after a call stays up. */
const NOTICE_MS = 4000;

function CallNoticeToast() {
  const notice = useCallsStore((state) => state.notice);
  const dismiss = useCallsStore((state) => state.dismissNotice);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(dismiss, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice, dismiss]);

  if (notice === null) {
    return null;
  }
  return (
    <div
      key={notice.id}
      role="status"
      className={cn(
        'animate-voice-toast shadow-floating fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full px-5 py-2.5 text-[14px] font-medium',
        notice.tone === 'error'
          ? 'bg-error-container text-on-error-container'
          : 'bg-inverse-surface text-inverse-on-surface',
      )}
    >
      {notice.text}
    </div>
  );
}

/**
 * Everything a call draws, for the whole app: the incoming-call card, the
 * call itself (full or minimized), the rejoin prompt, the screen picker, and
 * the line after it ends. Mounted once by the app shell, so a call rings and
 * carries on whichever screen is open.
 */
export function CallLayer() {
  const phase = useCallsStore((state) => state.phase);
  const isMinimized = useCallsStore((state) => state.isMinimized);
  const isScreenPickerOpen = useCallsStore((state) => state.isScreenPickerOpen);
  const isInCall = phase === 'outgoing' || phase === 'connecting' || phase === 'active';

  return createPortal(
    <>
      {phase === 'incoming' && <IncomingCall />}
      {phase === 'rejoin' && <RejoinCall />}
      {isInCall && (isMinimized ? <CallPill /> : <CallWindow />)}
      {isInCall && isScreenPickerOpen && <ScreenSourcePicker />}
      <CallNoticeToast />
    </>,
    document.body,
  );
}
