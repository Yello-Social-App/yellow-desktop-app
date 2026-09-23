import { UserCheck, UserPlus, X } from 'lucide-react';
import { memo } from 'react';

import { UserAvatar } from '@/components/people/UserAvatar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { useSampleRelationship } from '@/features/people/hooks';
import { usePeopleStore } from '@/features/people/store';
import type { DirectoryPerson } from '@/features/people/types';
import { displayName, handleOf } from '@/lib/user-display';

import { MutualFriends } from './MutualFriends';

interface SuggestionCardProps {
  person: DirectoryPerson;
}

/**
 * A friend-of-a-friend on the Discover tab. Sending a request keeps the card
 * in place, reading "Requested", so the grid does not jump under the pointer;
 * the X hides it for the session.
 */
export const SuggestionCard = memo(function SuggestionCard({ person }: SuggestionCardProps) {
  const user = person.user;
  const name = displayName(user);
  const control = useSampleRelationship(person);
  const dismiss = usePeopleStore((state) => state.dismissSuggestion);

  return (
    <article className="bg-surface-container-lowest border-outline-variant px-md pb-md relative flex h-full flex-col items-center rounded-2xl border pt-5 text-center">
      <IconButton
        label={`Hide ${name} from suggestions`}
        size="sm"
        icon={<X className="size-4" />}
        className="absolute top-2 right-2"
        onClick={() => {
          dismiss(user.id);
        }}
      />

      <UserAvatar user={user} size="lg" />
      <p className="text-on-surface mt-3 w-full truncate text-[15px] font-bold">{name}</p>
      <p className="text-on-surface-variant w-full truncate text-[13px]">{handleOf(user)}</p>

      <div className="mt-2.5 mb-3.5">
        <MutualFriends friends={person.mutualFriends} />
      </div>

      <div className="mt-auto w-full">
        {control.relationship === 'outgoing' ? (
          <Button
            variant="outline"
            fullWidth
            leadingIcon={<UserCheck className="size-4" />}
            onClick={control.cancelRequest}
            title="Cancel the request"
          >
            Requested
          </Button>
        ) : (
          <Button
            fullWidth
            leadingIcon={<UserPlus className="size-4" />}
            onClick={control.sendRequest}
          >
            Add friend
          </Button>
        )}
      </div>
    </article>
  );
});
