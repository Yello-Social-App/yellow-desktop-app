import { Paperclip, Send } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { useMessageComposer } from '@/features/messages/hooks';
import { composeMessageSchema, MESSAGE_MAX_LENGTH } from '@/features/messages/types';

/** The chat composer pinned to the bottom of the thread. */
export function MessageComposer() {
  const { send, isSending, hasConversation } = useMessageComposer();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = composeMessageSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That message is not valid.');
      return;
    }

    setError(null);
    void send(parsed.data).then((sent) => {
      if (sent) {
        setBody('');
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-outline-variant bg-surface-container-lowest gap-sm px-md py-sm shrink-0 border-t"
    >
      <div className="gap-sm flex items-center">
        <IconButton
          label="Attach a file"
          icon={<Paperclip className="size-5" />}
          disabled
          title="Attachments need the live API"
        />
        <label className="sr-only" htmlFor="message-composer">
          Write a message
        </label>
        <input
          id="message-composer"
          value={body}
          maxLength={MESSAGE_MAX_LENGTH}
          disabled={!hasConversation}
          placeholder="Write a message…"
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
          className="bg-surface-container-low border-outline-variant font-body text-body text-on-surface placeholder:text-outline-variant focus:border-primary-container focus:ring-primary-container/20 px-md transition-tone w-full flex-1 rounded-full border py-2 focus:ring-2 focus:outline-none"
        />
        <IconButton
          label="Send message"
          type="submit"
          icon={<Send className="size-5" />}
          disabled={isSending || body.trim() === ''}
          className="bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary disabled:opacity-40"
        />
      </div>
      {error !== null && (
        <p role="alert" className="font-small text-small text-error mt-xs ml-xs">
          {error}
        </p>
      )}
    </form>
  );
}
