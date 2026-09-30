import type { ScreenSource } from '@shared/ipc-types';
import { AppWindow, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { fetchScreenSources } from '@/features/calls/api';
import { useIsGroupCall } from '@/features/calls/hooks';
import { useCallsStore } from '@/features/calls/store';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; sources: ScreenSource[]; canShareAudio: boolean }
  | { kind: 'failed'; message: string };

function SourceTile({ source, onPick }: { source: ScreenSource; onPick: () => void }) {
  const Icon = source.kind === 'screen' ? Monitor : AppWindow;
  return (
    <button
      type="button"
      onClick={onPick}
      className="group border-outline-variant hover:border-primary focus-visible:border-primary flex flex-col gap-2 rounded-2xl border p-2 text-left transition-colors"
    >
      <span className="bg-surface-container grid aspect-video w-full place-items-center overflow-hidden rounded-xl">
        {source.thumbnailDataUrl === '' ? (
          <Icon className="text-on-surface-variant size-8" />
        ) : (
          <img src={source.thumbnailDataUrl} alt="" className="size-full object-contain" />
        )}
      </span>
      <span className="text-on-surface flex items-center gap-1.5 px-1 text-[13px] font-medium">
        <Icon className="text-on-surface-variant size-3.5 shrink-0" />
        <span className="truncate">{source.name}</span>
      </span>
    </button>
  );
}

/**
 * Which screen or window to share, and whether its sound goes with it. The
 * list comes from the main process, which will hand the call only the one
 * picked here. Sound is off until turned on — a computer's sound carries
 * other apps' alerts too — and offered only where it can be captured.
 */
export function ScreenSourcePicker() {
  const close = useCallsStore((state) => state.closeScreenPicker);
  const shareScreen = useCallsStore((state) => state.shareScreen);
  const isGroup = useIsGroupCall();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [withAudio, setWithAudio] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    void fetchScreenSources().then((result) => {
      if (isCurrent) {
        setLoad(
          result.ok
            ? { kind: 'ready', ...result.data }
            : { kind: 'failed', message: result.error.message },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const screens = load.kind === 'ready' ? load.sources.filter((s) => s.kind === 'screen') : [];
  const windows = load.kind === 'ready' ? load.sources.filter((s) => s.kind === 'window') : [];
  const canShareAudio = load.kind === 'ready' && load.canShareAudio;
  const pick = (source: ScreenSource) => () => {
    void shareScreen(source.id, canShareAudio && withAudio);
  };
  const audience = isGroup ? 'Everyone in the call' : 'The other person';
  const sound = canShareAudio ? '' : ' Sound is not shared.';

  return (
    <Modal
      isOpen
      onClose={close}
      title="Share your screen"
      description={`${audience} will see what you pick.${sound}`}
      footer={
        <>
          {canShareAudio && (
            <label className="text-on-surface mr-auto flex items-center gap-2 text-[13px]">
              <Switch
                size="sm"
                checked={withAudio}
                onChange={setWithAudio}
                label="Share your computer's sound"
              />
              Share sound
            </label>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </>
      }
    >
      {load.kind === 'loading' && (
        <div className="flex justify-center py-8">
          <Spinner label="Finding screens…" />
        </div>
      )}
      {load.kind === 'failed' && <InlineAlert message={load.message} />}
      {load.kind === 'ready' && load.sources.length === 0 && (
        <p className="text-on-surface-variant py-6 text-center text-[14px]">
          Nothing to share was found.
        </p>
      )}
      {load.kind === 'ready' && (
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {screens.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-on-surface-variant text-[12px] font-semibold tracking-wide uppercase">
                Screens
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {screens.map((source) => (
                  <SourceTile key={source.id} source={source} onPick={pick(source)} />
                ))}
              </div>
            </section>
          )}
          {windows.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-on-surface-variant text-[12px] font-semibold tracking-wide uppercase">
                Windows
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {windows.map((source) => (
                  <SourceTile key={source.id} source={source} onPick={pick(source)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
