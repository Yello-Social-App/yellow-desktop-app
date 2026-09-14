import { AtSign, Camera } from 'lucide-react';
import { useId, useState } from 'react';
import type { User } from '@shared/ipc-types';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import type { ProfileMutation, StagedAvatar } from '@/features/profile/hooks';
import {
  editProfileSchema,
  PROFILE_LIMITS,
  type EditProfileValues,
} from '@/features/profile/types';
import { useZodForm } from '@/hooks/use-zod-form';
import { displayName, initialsOf } from '@/lib/user-display';

import { ProfileErrorNotice } from './ProfileErrorNotice';

interface EditProfileFormProps {
  user: User;
  mutations: ProfileMutation;
  onDone: () => void;
}

/** Inline editor for the three fields `PUT /users/me` accepts. */
export function EditProfileForm({ user, mutations, onDone }: EditProfileFormProps) {
  const ids = { fullName: useId(), username: useId(), bio: useId() };
  const [staged, setStaged] = useState<StagedAvatar | null>(null);
  const form = useZodForm<EditProfileValues, EditProfileValues>(editProfileSchema, {
    fullName: user.fullName ?? '',
    username: user.username,
    bio: user.bio ?? '',
  });

  const handleChangePhoto = (): void => {
    void mutations.pickAvatar().then((result) => {
      if (result !== null) {
        setStaged(result);
      }
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validated = form.validate();
    if (!validated.ok) {
      return;
    }

    void mutations.save(validated.data, staged?.token).then((saved) => {
      if (saved) {
        onDone();
      }
    });
  };

  const bioRemaining = PROFILE_LIMITS.bioMax - form.values.bio.length;

  return (
    <Card elevation="floating" className="p-lg">
      <form className="gap-md flex flex-col" onSubmit={handleSubmit} noValidate>
        <h2 className="font-heading text-h3 text-on-surface">Edit profile</h2>

        <div className="gap-md flex items-center">
          <Avatar
            initials={initialsOf(user)}
            name={displayName(user)}
            imageUrl={staged?.previewDataUrl ?? user.avatarUrl}
            size="lg"
          />
          <div className="gap-xs flex flex-col">
            <Button
              variant="secondary"
              leadingIcon={<Camera className="size-4" />}
              isLoading={mutations.isPicking}
              onClick={handleChangePhoto}
            >
              Change photo
            </Button>
            <p className="font-small text-small text-on-surface-variant">
              {staged !== null
                ? 'New photo ready — save to apply.'
                : 'JPEG, PNG or GIF, up to 5 MB.'}
            </p>
          </div>
        </div>

        <div className="gap-md grid grid-cols-1 md:grid-cols-2">
          <FormField id={ids.fullName} label="Display name" error={form.errors.fullName}>
            <Input
              id={ids.fullName}
              value={form.values.fullName}
              placeholder="Your name"
              isInvalid={form.errors.fullName !== undefined}
              onChange={(event) => {
                form.setField('fullName', event.target.value);
              }}
            />
          </FormField>

          <FormField id={ids.username} label="Username" error={form.errors.username}>
            <Input
              id={ids.username}
              value={form.values.username}
              leadingIcon={<AtSign className="size-5" />}
              isInvalid={form.errors.username !== undefined}
              onChange={(event) => {
                form.setField('username', event.target.value);
              }}
            />
          </FormField>
        </div>

        <FormField
          id={ids.bio}
          label="Bio"
          error={form.errors.bio}
          hint={`${bioRemaining} characters left`}
        >
          <textarea
            id={ids.bio}
            rows={4}
            maxLength={PROFILE_LIMITS.bioMax}
            value={form.values.bio}
            placeholder="Tell people what you write about."
            onChange={(event) => {
              form.setField('bio', event.target.value);
            }}
            className="bg-surface-container-low border-outline-variant font-body text-body text-on-surface placeholder:text-outline-variant focus:border-primary-container focus:ring-primary-container/20 px-md transition-tone w-full resize-none rounded-lg border py-3 focus:ring-2 focus:outline-none"
          />
        </FormField>

        {mutations.error !== null && <ProfileErrorNotice error={mutations.error} />}

        <div className="gap-sm flex justify-end">
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" isLoading={mutations.isSaving}>
            {mutations.isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
