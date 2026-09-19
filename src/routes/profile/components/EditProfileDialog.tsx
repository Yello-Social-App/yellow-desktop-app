import { Camera, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { discardProfileImages, stageProfileImage } from '@/features/profile/api';
import { useSaveProfile } from '@/features/profile/hooks';
import { displayName, initialsOf } from '@/lib/user-display';
import {
  PROFILE_BIO_MAX,
  PROFILE_FULL_NAME_MAX,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
  type StagedImage,
  type UpdateProfileRequest,
  type User,
} from '@shared/ipc-types';

interface EditProfileDialogProps {
  user: User;
  onClose: () => void;
  /** After a successful save, before closing. */
  onSaved?: () => void;
}

type Field = 'username' | 'fullName' | 'bio' | 'avatar' | 'cover';

const FIELDS: readonly Field[] = ['username', 'fullName', 'bio', 'avatar', 'cover'];

/** What happens to one image on save. */
type ImageEdit = { kind: 'keep' } | { kind: 'replace'; image: StagedImage } | { kind: 'remove' };

const KEEP: ImageEdit = { kind: 'keep' };

/** Codes that are about the username, whatever field the server filed them under. */
const USERNAME_CODES = new Set(['USERNAME_ALREADY_USED', 'USERNAME_CHANGE_COOLDOWN']);

function pickFieldErrors(fields: Record<string, string[]>): Partial<Record<Field, string>> {
  const picked: Partial<Record<Field, string>> = {};
  for (const [key, messages] of Object.entries(fields)) {
    const field = FIELDS.find((name) => key === name);
    const message = messages[0];
    if (field !== undefined && message !== undefined && picked[field] === undefined) {
      picked[field] = message;
    }
  }
  return picked;
}

function previewOf(edit: ImageEdit, current: string | undefined): string | undefined {
  if (edit.kind === 'replace') {
    return edit.image.previewDataUrl;
  }
  return edit.kind === 'remove' ? undefined : current;
}

/** `null` clears a field on the server; an empty box means cleared. */
function clearable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Editing your own profile: photo, cover, username, name and bio.
 *
 * Only what changed is sent, so an untouched username never spends the
 * once-a-week change the server allows. Photos are staged in the main process
 * and previewed here from a thumbnail; whatever was picked but not saved is
 * released when the dialog closes.
 */
export function EditProfileDialog({ user, onClose, onSaved }: EditProfileDialogProps) {
  const save = useSaveProfile();
  const ids = { username: useId(), fullName: useId(), bio: useId() };
  const [username, setUsername] = useState(user.username);
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<ImageEdit>(KEEP);
  const [cover, setCover] = useState<ImageEdit>(KEEP);
  const [isPicking, setIsPicking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});

  // Tokens staged by this dialog and not yet handed to the server.
  const staged = useRef(new Set<string>());
  useEffect(() => {
    const tokens = staged.current;
    return () => {
      void discardProfileImages([...tokens]);
    };
  }, []);

  const release = (edit: ImageEdit): void => {
    if (edit.kind === 'replace') {
      staged.current.delete(edit.image.token);
      void discardProfileImages([edit.image.token]);
    }
  };

  const pick = async (purpose: 'avatar' | 'cover'): Promise<void> => {
    setIsPicking(true);
    setError(null);
    const result = await stageProfileImage(purpose);
    setIsPicking(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data === null) {
      return;
    }
    staged.current.add(result.data.token);
    const next: ImageEdit = { kind: 'replace', image: result.data };
    if (purpose === 'avatar') {
      release(avatar);
      setAvatar(next);
    } else {
      release(cover);
      setCover(next);
    }
  };

  const remove = (purpose: 'avatar' | 'cover'): void => {
    if (purpose === 'avatar') {
      release(avatar);
      setAvatar({ kind: 'remove' });
    } else {
      release(cover);
      setCover({ kind: 'remove' });
    }
  };

  const trimmedUsername = username.trim();
  const localErrors: Partial<Record<Field, string>> = {
    ...(trimmedUsername.length < USERNAME_MIN_LENGTH
      ? { username: `At least ${String(USERNAME_MIN_LENGTH)} characters.` }
      : !USERNAME_PATTERN.test(trimmedUsername)
        ? { username: 'Letters, numbers, underscores and dots only.' }
        : {}),
  };
  const errors = { ...serverErrors, ...localErrors };

  const request: UpdateProfileRequest = {
    ...(trimmedUsername === user.username ? {} : { username: trimmedUsername }),
    ...(clearable(fullName) === (user.fullName ?? null) ? {} : { fullName: clearable(fullName) }),
    ...(clearable(bio) === (user.bio ?? null) ? {} : { bio: clearable(bio) }),
    ...(avatar.kind === 'replace' ? { avatarToken: avatar.image.token } : {}),
    ...(avatar.kind === 'remove' ? { removeAvatar: true as const } : {}),
    ...(cover.kind === 'replace' ? { coverToken: cover.image.token } : {}),
    ...(cover.kind === 'remove' ? { removeCover: true as const } : {}),
  };
  const hasChanges = Object.keys(request).length > 0;
  const canSave = hasChanges && Object.keys(localErrors).length === 0 && !isSaving && !isPicking;

  const submit = async (): Promise<void> => {
    if (!canSave) {
      return;
    }
    setIsSaving(true);
    setError(null);
    setServerErrors({});

    const result = await save(request);
    setIsSaving(false);

    if (!result.ok) {
      const picked = pickFieldErrors(result.error.fieldErrors ?? {});
      if (result.error.apiCode !== undefined && USERNAME_CODES.has(result.error.apiCode)) {
        picked.username ??= result.error.message;
      }
      setServerErrors(picked);
      // A message that already sits under its field need not repeat above.
      setError(Object.keys(picked).length > 0 ? null : result.error.message);
      return;
    }

    // The server has the photos now and has already let go of the staged copies.
    staged.current.clear();
    onSaved?.();
    onClose();
  };

  const avatarPreview = previewOf(avatar, user.avatarUrl);
  const coverPreview = previewOf(cover, user.coverUrl);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit profile"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            isLoading={isSaving}
            onClick={() => {
              void submit();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="gap-md flex max-h-[65vh] flex-col overflow-y-auto pr-1">
        {error !== null && (
          <p role="alert" className="text-error text-[14px]">
            {error}
          </p>
        )}

        <section aria-label="Photos" className="flex flex-col">
          <div className="bg-surface-container relative h-28 overflow-hidden rounded-xl">
            {coverPreview === undefined ? (
              <div
                aria-hidden
                className="from-primary-fixed-dim via-surface-container to-surface-container-low size-full bg-gradient-to-br"
              />
            ) : (
              <img src={coverPreview} alt="Cover preview" className="size-full object-cover" />
            )}
            <div className="absolute top-2 right-2 flex gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Camera className="size-4" />}
                disabled={isPicking || isSaving}
                onClick={() => {
                  void pick('cover');
                }}
              >
                Change cover
              </Button>
              {coverPreview !== undefined && (
                <IconButton
                  size="sm"
                  tone="danger"
                  label="Remove cover"
                  icon={<Trash2 className="size-4" />}
                  className="bg-surface-container-high"
                  disabled={isPicking || isSaving}
                  onClick={() => {
                    remove('cover');
                  }}
                />
              )}
            </div>
          </div>

          <div className="gap-md px-md -mt-10 flex items-end">
            <div className="ring-surface-container-lowest rounded-full ring-4">
              <Avatar
                initials={initialsOf(user)}
                name={displayName(user)}
                imageUrl={avatarPreview}
                size="xl"
              />
            </div>
            <div className="flex gap-1.5 pb-1">
              <Button
                size="sm"
                variant="outline"
                leadingIcon={<Camera className="size-4" />}
                disabled={isPicking || isSaving}
                onClick={() => {
                  void pick('avatar');
                }}
              >
                Change photo
              </Button>
              {avatarPreview !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPicking || isSaving}
                  onClick={() => {
                    remove('avatar');
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
          {(errors.avatar ?? errors.cover) !== undefined && (
            <p role="alert" className="text-error ml-xs mt-xs text-[13px]">
              {errors.avatar ?? errors.cover}
            </p>
          )}
          <p className="text-on-surface-variant ml-xs mt-xs text-[13px]">
            JPEG, PNG, GIF or WebP, up to 5 MB.
          </p>
        </section>

        <FormField
          id={ids.username}
          label="Username"
          hint="Letters, numbers, _ and . — it can change once every 7 days."
          error={errors.username}
        >
          <Input
            id={ids.username}
            value={username}
            minLength={USERNAME_MIN_LENGTH}
            maxLength={USERNAME_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            isInvalid={errors.username !== undefined}
            leadingIcon={<span className="text-[15px]">@</span>}
            className="pl-9"
            onChange={(event) => {
              setUsername(event.target.value);
              // A fresh attempt: the old "taken" no longer describes it.
              setServerErrors((current) => ({ ...current, username: undefined }));
            }}
          />
        </FormField>

        <FormField id={ids.fullName} label="Name" error={errors.fullName}>
          <Input
            id={ids.fullName}
            value={fullName}
            maxLength={PROFILE_FULL_NAME_MAX}
            placeholder="How you want to be shown"
            isInvalid={errors.fullName !== undefined}
            onChange={(event) => {
              setFullName(event.target.value);
            }}
          />
        </FormField>

        <FormField
          id={ids.bio}
          label="Bio"
          hint={`${String(bio.length)} / ${String(PROFILE_BIO_MAX)}`}
          error={errors.bio}
        >
          <textarea
            id={ids.bio}
            value={bio}
            rows={4}
            maxLength={PROFILE_BIO_MAX}
            placeholder="A line or two about you"
            onChange={(event) => {
              setBio(event.target.value);
            }}
            className="bg-surface-container-low border-outline-variant focus:border-primary-container focus:ring-primary-container/20 text-on-surface w-full resize-y rounded-xl border px-4 py-3 text-[15px] focus:ring-2 focus:outline-none"
          />
        </FormField>
      </div>
    </Modal>
  );
}
