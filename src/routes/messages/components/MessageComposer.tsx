import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { useComposer } from '@/features/messages/hooks';
import { composeMessageSchema, MESSAGE_MAX_LENGTH } from '@/features/messages/types';

/** The composer pinned to the bottom of the thread. Enter sends; Shift+Enter breaks. */
export function MessageComposer() {
  const { send, isSending, hasConversation, onInput } = useComposer();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 160))}px`;
  }, [body]);

  const submit = (): void => {
    const parsed = composeMessageSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That message is not valid.');
      return;
    }
    setError(null);
    // Cleared at once: the line is already drawn in the thread, optimistically.
    setBody('');
    void send(parsed.data.body);
    textareaRef.current?.focus();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="border-outline-variant px-lg shrink-0 border-t py-3"
    >
      <div className="bg-surface-container-low border-outline-variant focus-within:border-primary-container focus-within:ring-primary-container/20 transition-tone flex items-end gap-2 rounded-3xl border py-1.5 pr-1.5 pl-4 focus-within:ring-2">
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
          placeholder="Start a new message"
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
            onInput();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="text-on-surface placeholder:text-outline max-h-40 min-h-8 w-full flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed focus:outline-none"
        />
        <IconButton
          label="Send message"
          type="submit"
          icon={<Send className="size-4" />}
          disabled={isSending || body.trim() === ''}
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
