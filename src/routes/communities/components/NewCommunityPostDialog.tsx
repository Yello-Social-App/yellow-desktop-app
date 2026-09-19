import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useMembership } from '@/features/communities/hooks';
import { useCommunitiesStore } from '@/features/communities/store';
import {
  COMMUNITY_POST_BODY_MAX,
  COMMUNITY_POST_TITLE_MAX,
  type Community,
} from '@/features/communities/types';
import { cn } from '@/lib/cn';

interface NewCommunityPostDialogProps {
  community: Community;
  onClose: () => void;
}

/** The server's refusal for a caller who has not joined. */
const MEMBERSHIP_REQUIRED = 'COMMUNITY_MEMBERSHIP_REQUIRED';

type Field = 'title' | 'body' | 'tag';

export function NewCommunityPostDialog({ community, onClose }: NewCommunityPostDialogProps) {
  const publish = useCommunitiesStore((state) => state.publish);
  const loadCommunity = useCommunitiesStore((state) => state.loadCommunity);
  const membership = useMembership(community.slug);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tag, setTag] = useState(community.tags[0] ?? '');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const titleId = useId();
  const bodyId = useId();

  const hasTags = community.tags.length > 0;
  const canPost = community.isMember && hasTags && title.trim() !== '' && tag !== '' && !isSending;

  const post = async (): Promise<void> => {
    if (!canPost) {
      return;
    }
    setIsSending(true);
    setError(null);
    setFieldErrors({});

    const result = await publish({
      slug: community.slug,
      title: title.trim(),
      body: body.trim(),
      tag,
    });

    setIsSending(false);
    if (result.ok) {
      onClose();
      return;
    }

    const { apiCode, fieldErrors: fields, message } = result.error;
    if (apiCode === MEMBERSHIP_REQUIRED) {
      // Left elsewhere since this copy was read: refresh it, and the join
      // prompt takes over from the Post button.
      setError(`Join c/${community.slug} to post here.`);
      void loadCommunity(community.slug);
      return;
    }
    if (fields !== undefined) {
      setFieldErrors({
        ...(fields.title?.[0] === undefined ? {} : { title: fields.title[0] }),
        ...(fields.body?.[0] === undefined ? {} : { body: fields.body[0] }),
        ...(fields.tag?.[0] === undefined ? {} : { tag: fields.tag[0] }),
      });
    }
    setError(message);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Post to c/${community.slug}`}
      description={community.rules[0]}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {community.isMember ? (
            <Button
              disabled={!canPost}
              isLoading={isSending}
              onClick={() => {
                void post();
              }}
            >
              Post
            </Button>
          ) : (
            <Button
              isLoading={membership.isBusy}
              onClick={() => {
                setError(null);
                membership.toggle(true);
              }}
            >
              Join to post
            </Button>
          )}
        </>
      }
    >
      <div className="gap-md flex flex-col">
        {!community.isMember && (
          <p className="bg-info-fixed text-on-info-fixed rounded-xl px-4 py-3 text-[14px]">
            Only members can start a thread in c/{community.slug}.
          </p>
        )}
        {!hasTags && (
          <p className="text-on-surface-variant text-[14px]">
            This community has no post tags yet, so nothing can be posted to it.
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-error text-[14px]">
            {error}
          </p>
        )}
        <FormField id={titleId} label="Title" error={fieldErrors.title}>
          <Input
            id={titleId}
            value={title}
            maxLength={COMMUNITY_POST_TITLE_MAX}
            placeholder="A clear, specific title"
            autoFocus
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </FormField>
        <FormField id={bodyId} label="Body" error={fieldErrors.body}>
          <textarea
            id={bodyId}
            value={body}
            rows={5}
            maxLength={COMMUNITY_POST_BODY_MAX}
            placeholder="Details, links, code…"
            onChange={(event) => {
              setBody(event.target.value);
            }}
            className="bg-surface-container-low border-outline-variant focus:border-primary-container focus:ring-primary-container/20 text-on-surface w-full resize-y rounded-xl border px-4 py-3 text-[15px] focus:ring-2 focus:outline-none"
          />
        </FormField>
        {hasTags && (
          <div className="flex flex-col gap-1">
            <div role="radiogroup" aria-label="Tag" className="flex flex-wrap gap-1.5">
              {community.tags.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={option === tag}
                  onClick={() => {
                    setTag(option);
                  }}
                  className={cn(
                    'transition-tone rounded-full px-3 py-1 text-[12px] font-semibold',
                    option === tag
                      ? 'bg-info-fixed text-on-info-fixed'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            {fieldErrors.tag !== undefined && (
              <p role="alert" className="text-error text-[13px]">
                {fieldErrors.tag}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
