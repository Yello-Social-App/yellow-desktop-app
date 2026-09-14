import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SampleBadge } from '@/components/ui/SampleBadge';
import { useCurrentUser } from '@/features/auth/hooks';
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

export function NewCommunityPostDialog({ community, onClose }: NewCommunityPostDialogProps) {
  const user = useCurrentUser();
  const publish = useCommunitiesStore((state) => state.publish);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tag, setTag] = useState(community.tags[0] ?? 'general');
  const titleId = useId();
  const bodyId = useId();

  const post = (): void => {
    if (user === null || title.trim() === '') {
      return;
    }
    publish({
      communitySlug: community.slug,
      title: title.trim(),
      body: body.trim(),
      tag,
      author: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
    });
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Post to c/${community.slug}`}
      description={community.rules[0]}
      footer={
        <>
          <span className="mr-auto self-center">
            <SampleBadge />
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={title.trim() === ''} onClick={post}>
            Post
          </Button>
        </>
      }
    >
      <div className="gap-md flex flex-col">
        <FormField id={titleId} label="Title">
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
        <FormField id={bodyId} label="Body">
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
      </div>
    </Modal>
  );
}
