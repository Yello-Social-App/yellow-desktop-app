import { MessagesSquare, SquarePen, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { RowSkeleton } from '@/components/ui/Skeleton';
import {
  useActiveConversation,
  useConversationRows,
  useOpenConversation,
} from '@/features/messages/hooks';
import { useMessagesStore } from '@/features/messages/store';

import { ConversationList } from './components/ConversationList';
import { MessageThread } from './components/MessageThread';
import { NewChatDialog } from './components/NewChatDialog';

/**
 * Two-pane chat: conversations on the left, the active thread on the right.
 * The open conversation is the URL, so a link from a profile or the right
 * rail lands directly in it.
 */
export default function MessagesPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { rows, status, error, hasMore, isLoadingMore, loadMore } = useConversationRows();
  const active = useActiveConversation();
  const clearError = useMessagesStore((state) => state.clearError);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);

  useOpenConversation(conversationId);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="border-outline-variant flex w-[340px] shrink-0 flex-col border-r">
        <header className="glass border-outline-variant px-lg flex h-14 shrink-0 items-center justify-between border-b">
          <h1 className="font-heading text-h1 text-on-surface">Messages</h1>
          <IconButton
            label="New message"
            tone="brand"
            aria-haspopup="dialog"
            icon={<SquarePen className="size-5" />}
            onClick={() => {
              setIsNewChatOpen(true);
            }}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {(status === 'loading' || status === 'idle') && (
            <div aria-busy>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </div>
          )}

          {status === 'error' && (
            <p
              role="alert"
              className="text-on-error-container bg-error-container/40 m-md gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
            >
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {error ?? 'Conversations could not be loaded.'}
            </p>
          )}

          {status === 'ready' && rows.length === 0 && (
            <EmptyState
              icon={<MessagesSquare className="size-6" />}
              title="No conversations"
              description="Message a friend from their profile, or start one here."
              action={
                <Button
                  leadingIcon={<SquarePen className="size-4" />}
                  onClick={() => {
                    setIsNewChatOpen(true);
                  }}
                >
                  New message
                </Button>
              }
            />
          )}

          {status === 'ready' && rows.length > 0 && (
            <>
              <ConversationList rows={rows} activeId={active?.conversation.id ?? null} />
              {hasMore && (
                <div className="py-md flex justify-center">
                  <Button variant="ghost" size="sm" isLoading={isLoadingMore} onClick={loadMore}>
                    Older conversations
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {active === null ? (
        <div className="p-lg flex flex-1 items-center justify-center">
          <EmptyState
            icon={<MessagesSquare className="size-6" />}
            title="Your messages"
            description="Pick a conversation on the left, or start a new one."
            action={
              <Button
                leadingIcon={<SquarePen className="size-4" />}
                onClick={() => {
                  setIsNewChatOpen(true);
                }}
              >
                New message
              </Button>
            }
          />
        </div>
      ) : (
        <MessageThread row={active} />
      )}

      {status === 'ready' && error !== null && (
        <div className="fixed right-6 bottom-6 z-20">
          <p
            role="alert"
            className="bg-error-container text-on-error-container shadow-floating gap-sm px-md py-sm flex items-center rounded-xl text-[14px]"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {error}
            <Button size="sm" variant="ghost" onClick={clearError}>
              Dismiss
            </Button>
          </p>
        </div>
      )}

      {isNewChatOpen && (
        <NewChatDialog
          isOpen
          onClose={() => {
            setIsNewChatOpen(false);
          }}
        />
      )}
    </div>
  );
}
