import { CornerUpLeft, FileText, LoaderCircle, Paperclip, Pencil, Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { useComposer } from '@/features/messages/hooks';
import {
  composeMessageSchema,
  describeMessage,
  MESSAGE_MAX_LENGTH,
} from '@/features/messages/types';
import { CHAT_MESSAGE_MAX_ATTACHMENTS } from '@shared/ipc-types';
import { readLocalFiles } from '@/features/messages/local-files';
import { formatBytes } from '@/lib/format';
import { displayName } from '@/lib/user-display';

/**
 * The composer pinned to the bottom of the thread. Enter sends; Shift+Enter
 * breaks; Escape leaves a reply or an edit; Up in an empty box edits your
 * newest line; pasting an image attaches it (dropping a file anywhere on the
 * thread does too — see useFileDrop).
 *
 * It has three modes that share one box — new line, reply, edit — and the
 * store owns which one is active, because the thread's hover bar is what
 * starts a reply or an edit. Editing is text only: the service fixes files and
 * the reply target once sent, so attaching is off while an edit is open.
 */
export function MessageComposer() {
  const composer = useComposer();
  const { send, saveEdit, isSending, hasConversation, onInput, editing, replyingTo, attachments } =
    composer;
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftBeforeEdit = useRef('');
  const editingId = editing?.id ?? null;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 160))}px`;
  }, [body]);

  // Entering an edit swaps the draft for the line's text; leaving it puts the
  // draft back, so starting an edit never costs what you were typing.
  const editingBody = editing?.body;
  useEffect(() => {
    if (editingId === null || editingBody === undefined) {
      return;
    }
    setBody((current) => {
      draftBeforeEdit.current = current;
      return editingBody;
    });
    setError(null);
    textareaRef.current?.focus();
    return () => {
      setBody(draftBeforeEdit.current);
    };
    // Keyed on the id: a fan-out that rewrites the line must not reset the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const replyingToId = replyingTo?.message.id ?? null;
  useEffect(() => {
    if (replyingToId !== null) {
      textareaRef.current?.focus();
    }
  }, [replyingToId]);

  /**
   * Pasting an image attaches it, as picking one would. Text wins when the
   * clipboard carries both: an office app copies a picture of the selection
   * alongside its text, and pasting a spreadsheet cell should paste the cell.
   * The bytes are only read here; the main process decides whether they are
   * an image before anything is uploaded.
   */
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (images.length === 0 || event.clipboardData.getData('text/plain') !== '') {
      return;
    }
    event.preventDefault();
    if (editing !== null) {
      setError('Files cannot be added to a sent message. Send it as a new one.');
      return;
    }
    void readLocalFiles(images).then(({ files, problem }) => {
      setError(problem);
      if (files.length > 0) {
        composer.addLocalFiles('paste', files);
      }
    });
  };

  const submit = (): void => {
    const parsed = composeMessageSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That message is not valid.');
      return;
    }
    const text = parsed.data.body;

    if (editing !== null) {
      if (text === '') {
        setError('An edit needs some text. To remove the line, unsend it.');
        return;
      }
      setError(null);
      void saveEdit(text);
      return;
    }

    if (text === '' && attachments.length === 0) {
      setError('Type a message or attach a file before sending.');
      return;
    }
    setError(null);
    // Cleared at once: the line is already drawn in the thread, optimistically.
    setBody('');
    void send(text);
    textareaRef.current?.focus();
  };

  const canSubmit =
    !isSending &&
    !composer.isAttaching &&
    (body.trim() !== '' || (editing === null && attachments.length > 0));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="border-outline-variant px-lg shrink-0 border-t py-3"
    >
      {(editing !== null || replyingTo !== null) && (
        <div className="bg-surface-container-low border-outline-variant mb-2 flex items-center gap-2 rounded-2xl border py-1.5 pr-1.5 pl-3">
          {editing !== null ? (
            <Pencil aria-hidden className="text-primary size-4 shrink-0" />
          ) : (
            <CornerUpLeft aria-hidden className="text-primary size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            <span className="text-on-surface block text-[12px] font-semibold">
              {editing !== null
                ? 'Editing message'
                : `Replying to ${
                    replyingTo === null
                      ? ''
                      : replyingTo.isOwn
                        ? 'yourself'
                        : replyingTo.sender === undefined
                          ? '…'
                          : displayName(replyingTo.sender)
                  }`}
            </span>
            {replyingTo !== null && editing === null && (
              <span className="text-on-surface-variant block truncate text-[12px]">
                {describeMessage(replyingTo.message)}
              </span>
            )}
          </span>
          <IconButton
            label={editing !== null ? 'Cancel edit' : 'Cancel reply'}
            size="sm"
            icon={<X className="size-4" />}
            onClick={composer.cancel}
          />
        </div>
      )}

      {editing === null && (attachments.length > 0 || composer.isAttaching) && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attached files">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="bg-surface-container-low border-outline-variant relative flex items-center gap-2 overflow-hidden rounded-xl border"
            >
              {attachment.kind === 'IMAGE' && attachment.url !== null ? (
                <img
                  src={attachment.url}
                  alt={attachment.fileName}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="size-16 object-cover"
                />
              ) : (
                <span className="flex max-w-48 items-center gap-2 py-2 pr-8 pl-3">
                  <FileText aria-hidden className="text-on-surface-variant size-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="text-on-surface block truncate text-[13px]">
                      {attachment.fileName}
                    </span>
                    <span className="text-on-surface-variant block text-[11px]">
                      {formatBytes(attachment.sizeBytes)}
                    </span>
                  </span>
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${attachment.fileName}`}
                onClick={() => {
                  composer.dropAttachment(attachment.id);
                }}
                className="bg-surface-container-highest/90 text-on-surface absolute top-1 right-1 flex size-5 items-center justify-center rounded-full"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
          {composer.isAttaching && (
            <li className="bg-surface-container-low border-outline-variant text-on-surface-variant flex h-16 items-center gap-2 rounded-xl border px-3 text-[13px]">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              Uploading…
            </li>
          )}
        </ul>
      )}

      <div className="bg-surface-container-low border-outline-variant focus-within:border-primary-container focus-within:ring-primary-container/20 transition-tone flex items-end gap-1 rounded-3xl border py-1.5 pr-1.5 pl-1.5 focus-within:ring-2">
        <IconButton
          label="Attach files"
          icon={<Paperclip className="size-4" />}
          disabled={
            !hasConversation ||
            editing !== null ||
            composer.isAttaching ||
            attachments.length >= CHAT_MESSAGE_MAX_ATTACHMENTS
          }
          onClick={composer.attach}
          className="disabled:opacity-40"
        />
        <label className="sr-only" htmlFor="message-composer">
          Write a message
        </label>
        <textarea
          id="message-composer"
          ref={textareaRef}
          value={body}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          disabled={!hasConversation}
          placeholder={
            editing !== null ? 'Edit your message' : 'Start a new message, or paste an image'
          }
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
            onInput();
          }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === 'Escape' && (editing !== null || replyingTo !== null)) {
              event.preventDefault();
              composer.cancel();
              return;
            }
            if (event.key === 'ArrowUp' && body === '' && editing === null) {
              if (composer.editLatest()) {
                event.preventDefault();
              }
            }
          }}
          className="text-on-surface placeholder:text-outline max-h-40 min-h-8 w-full flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-relaxed focus:outline-none"
        />
        <IconButton
          label={editing !== null ? 'Save edit' : 'Send message'}
          type="submit"
          icon={<Send className="size-4" />}
          disabled={!canSubmit}
          className="bg-primary-container text-on-primary-container disabled:bg-surface-container-high disabled:text-on-surface-variant hover:brightness-110 disabled:opacity-100"
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-error mt-xs ml-md text-[13px]">
          {error}
        </p>
      )}
    </form>
  );
}
