import {
  STICKER_EDGE,
  STICKER_NAME_MAX,
  STICKER_PICTURE_MAX_BYTES,
  type Sticker,
  type StickerBackground,
  type StickerDraft,
} from '@shared/ipc-types';
import {
  ClipboardPaste,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  TriangleAlert,
  Wand,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { ImageCropper } from '@/components/ui/ImageCropper';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { isFileDrag } from '@/features/messages/local-files';
import {
  draftFromBytes,
  pasteSource,
  pickSource,
  saveDraft,
  type SourceResult,
} from '@/features/stickers/api';
import { useStickersStore } from '@/features/stickers/store';
import { stickerErrorMessage } from '@/features/stickers/types';
import { cn } from '@/lib/cn';
import { cropToPng, type CropArea } from '@/lib/crop';
import { fail, ok } from '@/lib/result';

import { StickerArt } from './StickerArt';

/**
 * Where the dialog is. A State machine in its plainest spelling — one tagged
 * union, narrowed where it is drawn — because the steps really are
 * exclusive: a picture is being chosen, opened, cropped, uploaded, or shaped
 * into a sticker, and each step draws and allows different things. Booleans
 * for each would admit combinations that mean nothing ("uploading" while
 * "saving"). The picture (`source`) is carried from the crop on, so the last
 * step can go back and crop it again.
 */
type Step =
  | { kind: 'choose'; error: string | null }
  | { kind: 'opening' }
  | { kind: 'crop'; source: string; error: string | null }
  | { kind: 'uploading'; source: string }
  | {
      kind: 'edit';
      source: string;
      draft: StickerDraft;
      background: StickerBackground;
      name: string;
      error: string | null;
      saving: 'save' | 'send' | null;
    };

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PASTE_SHORTCUT =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? '⌘ V' : 'Ctrl V';

/** A dropped or pasted file as a `data:` URL — the one image source the CSP allows. */
function readAsDataUrl(file: File): Promise<SourceResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      resolve(
        typeof result === 'string' && result.startsWith('data:image/')
          ? ok(result)
          : fail({ code: 'IO_ERROR', message: 'That picture could not be read.' }),
      );
    };
    reader.onerror = () => {
      resolve(fail({ code: 'IO_ERROR', message: 'That picture could not be read.' }));
    };
    reader.readAsDataURL(file);
  });
}

interface CreateStickerDialogProps {
  onClose: () => void;
  /** Saved: `andSend` when the person chose Save and send. */
  onSaved: (sticker: Sticker, andSend: boolean) => void;
  /** Whether Save and send is offered: there is a conversation to send it to. */
  canSend: boolean;
  /** A picture dropped on the picker, to start from at once. */
  initialFile?: File | undefined;
}

/**
 * Making a sticker from a picture: choose it, crop it, then — in the two
 * steps the service defines — upload the crop as a draft (which answers it
 * whole and, when removal is on, cut out) and save it with the version chosen.
 *
 * A picture arrives three ways: dropped on the box, picked with Browse (the
 * main process opens the picker), or pasted — with the Paste button, which
 * has the main process read the clipboard, or with the shortcut, which hands
 * over what the page was given. The crop happens here, on a canvas, and what
 * is uploaded is that square at the size the service keeps (`STICKER_EDGE`),
 * never the picture itself — so a 10 MB photo costs a small upload, and the
 * main process checks those bytes again before they go anywhere.
 *
 * Mounted only while open, so every opening starts clean.
 */
export function CreateStickerDialog({
  onClose,
  onSaved,
  canSend,
  initialFile,
}: CreateStickerDialogProps) {
  const [step, setStep] = useState<Step>(() =>
    initialFile === undefined ? { kind: 'choose', error: null } : { kind: 'opening' },
  );
  const [area, setArea] = useState<CropArea | null>(null);
  const adopt = useStickersStore((state) => state.adopt);
  // Answers that arrive after the dialog closed, or after the person moved
  // on, are dropped rather than applied to a step they no longer fit.
  const attempt = useRef(0);
  const isMounted = useRef(true);
  // Set on every mount, not only cleared on unmount: StrictMode mounts,
  // unmounts and mounts again in development, and a flag that is only ever
  // cleared would drop every answer after that, leaving the dialog spinning.
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  /** Opens a picture for cropping, from wherever it came. */
  const open = useCallback(async (read: () => Promise<SourceResult>) => {
    attempt.current += 1;
    const mine = attempt.current;
    setStep({ kind: 'opening' });
    const result = await read();
    if (!isMounted.current || mine !== attempt.current) {
      return;
    }
    if (!result.ok) {
      setStep({ kind: 'choose', error: stickerErrorMessage(result.error) });
      return;
    }
    // Null: the picker was cancelled. Back where they were, no complaint.
    setStep(
      result.data === null
        ? { kind: 'choose', error: null }
        : { kind: 'crop', source: result.data, error: null },
    );
  }, []);

  const takeFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.has(file.type)) {
        setStep({ kind: 'choose', error: 'That file isn’t a picture. Try a PNG, JPG or WebP.' });
        return;
      }
      if (file.size > STICKER_PICTURE_MAX_BYTES) {
        setStep({ kind: 'choose', error: 'That picture is over 10 MB. Try a smaller one.' });
        return;
      }
      void open(() => readAsDataUrl(file));
    },
    [open],
  );

  // A picture dropped on the picker opens as the dialog does.
  const startedFrom = useRef<File | null>(null);
  useEffect(() => {
    if (initialFile !== undefined && startedFrom.current !== initialFile) {
      startedFrom.current = initialFile;
      takeFile(initialFile);
    }
  }, [initialFile, takeFile]);

  // The paste shortcut, wherever focus is in the dialog, while a picture is
  // being chosen. A clipboard that holds no file (some screenshot tools) is
  // read by the main process instead.
  const isChoosing = step.kind === 'choose';
  useEffect(() => {
    if (!isChoosing) {
      return;
    }
    const onPaste = (event: ClipboardEvent): void => {
      const data = event.clipboardData;
      if (data === null) {
        return;
      }
      const file = [...data.files].find((candidate) => candidate.type.startsWith('image/'));
      if (file === undefined && data.getData('text/plain') !== '') {
        return;
      }
      event.preventDefault();
      if (file === undefined) {
        void open(pasteSource);
        return;
      }
      takeFile(file);
    };
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('paste', onPaste);
    };
  }, [isChoosing, open, takeFile]);

  /** Cuts the square out and uploads it as a draft. */
  const upload = async (): Promise<void> => {
    if (step.kind !== 'crop' || area === null) {
      return;
    }
    const { source } = step;
    attempt.current += 1;
    const mine = attempt.current;
    setStep({ kind: 'uploading', source });
    const cropped = await cropToPng(source, area, STICKER_EDGE);
    if (!cropped.ok) {
      if (isMounted.current && mine === attempt.current) {
        setStep({ kind: 'crop', source, error: cropped.error });
      }
      return;
    }
    const result = await draftFromBytes(cropped.data);
    if (!isMounted.current || mine !== attempt.current) {
      return;
    }
    if (!result.ok) {
      setStep({ kind: 'crop', source, error: stickerErrorMessage(result.error) });
      return;
    }
    const draft = result.data;
    setStep({
      kind: 'edit',
      source,
      draft,
      background: draft.cutoutStatus === 'READY' ? 'REMOVED' : 'KEPT',
      name: '',
      error: null,
      saving: null,
    });
  };

  const save = async (andSend: boolean): Promise<void> => {
    if (step.kind !== 'edit' || step.saving !== null) {
      return;
    }
    setStep({ ...step, saving: andSend ? 'send' : 'save', error: null });
    const result = await saveDraft(step.draft.draftId, step.background, step.name.trim());
    if (!isMounted.current) {
      return;
    }
    if (!result.ok) {
      // The draft outlived its hour: the crop is still here to upload again.
      if (result.error.apiReason === 'DRAFT_NOT_FOUND') {
        setStep({ kind: 'crop', source: step.source, error: stickerErrorMessage(result.error) });
        return;
      }
      setStep({ ...step, saving: null, error: stickerErrorMessage(result.error) });
      return;
    }
    adopt(result.data);
    onSaved(result.data, andSend);
  };

  const isCropping = step.kind === 'crop' || step.kind === 'uploading';

  // One dialog for every step: swapping dialogs would close and reopen the
  // native element, and focus would fall out of it in between.
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        step.kind === 'edit'
          ? 'Make it a sticker'
          : isCropping
            ? 'Crop your sticker'
            : 'Create a sticker'
      }
      description={
        step.kind === 'edit'
          ? 'It’s saved to My stickers, so you can send it again any time.'
          : isCropping
            ? 'Drag to move it, zoom to resize it. Zoom all the way out to fit the whole picture.'
            : 'Use a photo or any picture. Next you can crop it and remove its background.'
      }
      {...(step.kind === 'edit'
        ? {
            footer: (
              <EditFooter
                saving={step.saving}
                canSend={canSend}
                onAdjustCrop={() => {
                  // The draft is left to expire; the next Next makes a new one.
                  attempt.current += 1;
                  setStep({ kind: 'crop', source: step.source, error: null });
                }}
                onSave={(andSend) => {
                  void save(andSend);
                }}
              />
            ),
          }
        : step.kind === 'crop' || step.kind === 'uploading'
          ? {
              footer: (
                <>
                  <Button
                    variant="ghost"
                    className="mr-auto"
                    disabled={step.kind === 'uploading'}
                    onClick={() => {
                      attempt.current += 1;
                      setStep({ kind: 'choose', error: null });
                    }}
                  >
                    Change picture
                  </Button>
                  <Button
                    isLoading={step.kind === 'uploading'}
                    disabled={area === null}
                    onClick={() => {
                      void upload();
                    }}
                  >
                    {step.kind === 'uploading' ? 'Preparing…' : 'Next'}
                  </Button>
                </>
              ),
            }
          : {})}
    >
      {step.kind === 'edit' ? (
        <EditBody
          step={step}
          canSend={canSend}
          onChange={(change) => {
            setStep({ ...step, ...change, error: null });
          }}
          onSave={(andSend) => {
            void save(andSend);
          }}
        />
      ) : step.kind === 'crop' || step.kind === 'uploading' ? (
        <>
          <div
            aria-busy={step.kind === 'uploading'}
            className={cn(step.kind === 'uploading' && 'pointer-events-none opacity-60')}
          >
            <ImageCropper
              key={step.source}
              src={step.source}
              shape="square"
              allowFit
              onAreaChange={setArea}
            />
          </div>
          {step.kind === 'crop' && step.error !== null && (
            <p role="alert" className="text-error flex items-center gap-2 text-[13px]">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {step.error}
            </p>
          )}
        </>
      ) : (
        <DropZone
          busyLabel={step.kind === 'opening' ? 'Opening your picture…' : null}
          error={step.kind === 'choose' ? step.error : null}
          onFile={takeFile}
          onBrowse={() => {
            void open(pickSource);
          }}
          onPaste={() => {
            void open(pasteSource);
          }}
        />
      )}
    </Modal>
  );
}

interface DropZoneProps {
  /** What is happening while the zone is busy; null when it is waiting for a picture. */
  busyLabel: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onBrowse: () => void;
  onPaste: () => void;
}

/**
 * The box a picture is dropped on, with the two other ways in beside the
 * words. The enter/leave pair fires for every child crossed, so a depth count
 * decides whether a drag is still over it.
 */
function DropZone({ busyLabel, error, onFile, onBrowse, onPaste }: DropZoneProps) {
  const isUploading = busyLabel !== null;
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const stop = (event: DragEvent): boolean => {
    if (!isFileDrag(event.dataTransfer)) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const tone = isOver ? 'over' : error !== null ? 'error' : 'idle';

  return (
    <div
      aria-busy={isUploading}
      onDragEnter={(event) => {
        if (stop(event) && !isUploading) {
          depth.current += 1;
          setIsOver(true);
        }
      }}
      onDragOver={(event) => {
        if (stop(event)) {
          event.dataTransfer.dropEffect = isUploading ? 'none' : 'copy';
        }
      }}
      onDragLeave={(event) => {
        if (stop(event)) {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) {
            setIsOver(false);
          }
        }
      }}
      onDrop={(event) => {
        if (!stop(event)) {
          return;
        }
        depth.current = 0;
        setIsOver(false);
        const [file] = event.dataTransfer.files;
        if (file !== undefined && !isUploading) {
          onFile(file);
        }
      }}
      className={cn(
        'transition-tone flex h-64 flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] p-6 text-center',
        tone === 'over' && 'border-primary-container bg-primary-fixed border-solid',
        tone === 'error' && 'border-error bg-surface-container-low border-dashed',
        tone === 'idle' && 'border-outline-strong bg-surface-container-low border-dashed',
      )}
    >
      <span
        className={cn(
          'transition-tone mb-1.5 flex size-13 items-center justify-center rounded-full',
          tone === 'over' && 'bg-primary-container text-on-primary-container',
          tone === 'error' && 'bg-error-container text-error',
          tone === 'idle' && 'bg-surface-container-high text-on-surface-variant',
        )}
      >
        {isUploading ? (
          <LoaderCircle aria-hidden className="text-primary size-6 animate-spin" />
        ) : tone === 'error' ? (
          <TriangleAlert aria-hidden className="size-6" />
        ) : (
          <ImagePlus aria-hidden className="size-6" />
        )}
      </span>

      <p className="font-heading text-h3 text-on-surface" role="status">
        {busyLabel ??
          (tone === 'over'
            ? 'Drop to use this picture'
            : error === null
              ? 'Drop a picture here'
              : 'That didn’t work')}
      </p>
      <p
        role={error === null ? undefined : 'alert'}
        className="text-body-sm text-on-surface-variant max-w-copy"
      >
        {error ?? 'PNG, JPG or WebP, up to 5 MB'}
      </p>

      <div className={cn('mt-3.5 flex gap-2', (isUploading || isOver) && 'invisible')}>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<FolderOpen aria-hidden className="size-4" />}
          onClick={onBrowse}
          disabled={isUploading}
        >
          Browse files
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<ClipboardPaste aria-hidden className="size-4" />}
          onClick={onPaste}
          disabled={isUploading}
          aria-keyshortcuts={PASTE_SHORTCUT === '⌘ V' ? 'Meta+V' : 'Control+V'}
        >
          Paste
          <kbd className="border-outline-strong bg-surface-container-low text-on-surface-variant rounded border px-1 font-mono text-[11px]">
            {PASTE_SHORTCUT}
          </kbd>
        </Button>
      </div>
    </div>
  );
}

type EditState = Extract<Step, { kind: 'edit' }>;

interface EditBodyProps {
  step: EditState;
  canSend: boolean;
  onChange: (change: Partial<Pick<EditState, 'background' | 'name'>>) => void;
  onSave: (andSend: boolean) => void;
}

/** The picture as it will look, the background choice, and a name. */
function EditBody({ step, canSend, onChange, onSave }: EditBodyProps) {
  const nameId = useId();
  const { draft, background, name, error, saving } = step;
  const canRemove = draft.cutoutStatus === 'READY' && draft.cutout !== null;
  const isSaving = saving !== null;

  return (
    <>
      <div
        className={cn(
          'border-outline-variant flex h-66 items-center justify-center rounded-2xl border',
          background === 'REMOVED' && draft.cutout !== null
            ? 'transparency-grid'
            : 'bg-surface-container-low',
        )}
      >
        {background === 'REMOVED' && draft.cutout !== null ? (
          <StickerArt
            image={draft.cutout}
            background="REMOVED"
            size="preview"
            alt="Your sticker with the background removed"
          />
        ) : (
          <StickerArt
            image={draft.original}
            background="KEPT"
            size="preview"
            alt="Your sticker with its background"
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-label text-label text-on-surface">Background</span>
        <SegmentedControl
          label="Background"
          value={background}
          onChange={(value) => {
            onChange({ background: value });
          }}
          options={[
            { value: 'REMOVED', label: 'Remove background', disabled: !canRemove || isSaving },
            { value: 'KEPT', label: 'Keep background', disabled: isSaving },
          ]}
        />
        {!canRemove && (
          <p className="text-on-surface-variant flex items-start gap-2 text-[13px]">
            <Wand aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Background removal isn’t available for this picture yet, so the background stays.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="font-label text-label text-on-surface">
          Name <span className="text-outline font-normal">(optional)</span>
        </label>
        <Input
          id={nameId}
          value={name}
          maxLength={STICKER_NAME_MAX}
          placeholder="Mochi with his stick"
          disabled={isSaving}
          onChange={(event) => {
            onChange({ name: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSave(canSend);
            }
          }}
        />
        <span className="text-outline text-[12px]">Helps you find it in search.</span>
      </div>

      {error !== null && (
        <p role="alert" className="text-error flex items-center gap-2 text-[13px]">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      )}
    </>
  );
}

interface EditFooterProps {
  saving: EditState['saving'];
  canSend: boolean;
  onAdjustCrop: () => void;
  onSave: (andSend: boolean) => void;
}

/**
 * One filled button: Save and send when there is a conversation to send to,
 * which is why the dialog was opened from the composer; Save otherwise.
 */
function EditFooter({ saving, canSend, onAdjustCrop, onSave }: EditFooterProps) {
  const isSaving = saving !== null;
  return (
    <>
      <Button variant="ghost" className="mr-auto" onClick={onAdjustCrop} disabled={isSaving}>
        Adjust crop
      </Button>
      <Button
        variant={canSend ? 'secondary' : 'primary'}
        onClick={() => {
          onSave(false);
        }}
        isLoading={saving === 'save'}
        disabled={isSaving}
      >
        Save
      </Button>
      {canSend && (
        <Button
          onClick={() => {
            onSave(true);
          }}
          isLoading={saving === 'send'}
          disabled={isSaving}
        >
          Save and send
        </Button>
      )}
    </>
  );
}
