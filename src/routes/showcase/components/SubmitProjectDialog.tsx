import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useShowcaseStore } from '@/features/showcase/store';
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_EMOJIS,
  PROJECT_NAME_MAX,
  PROJECT_TAGLINE_MAX,
  PROJECT_TECH_MAX,
  PROJECT_TECH_NAME_MAX,
  httpsUrlOrNull,
  type ProjectEmoji,
} from '@/features/showcase/types';

interface SubmitProjectDialogProps {
  onClose: () => void;
}

type Field = 'name' | 'tagline' | 'description' | 'emoji' | 'tech' | 'repoUrl' | 'liveUrl';

const FIELDS: readonly Field[] = [
  'name',
  'tagline',
  'description',
  'emoji',
  'tech',
  'repoUrl',
  'liveUrl',
];

/** Splits the comma list; the server also dedupes, keeping the first spelling. */
function parseTech(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (item === '' || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

/**
 * The server's messages per field. A tech item's error arrives under
 * `tech.<index>`, which is folded into the one tech field.
 */
function pickFieldErrors(fields: Record<string, string[]>): Partial<Record<Field, string>> {
  const picked: Partial<Record<Field, string>> = {};
  for (const [key, messages] of Object.entries(fields)) {
    const field = FIELDS.find((name) => key === name || key.startsWith(`${name}.`));
    const message = messages[0];
    if (field !== undefined && message !== undefined && picked[field] === undefined) {
      picked[field] = message;
    }
  }
  return picked;
}

export function SubmitProjectDialog({ onClose }: SubmitProjectDialogProps) {
  const publish = useShowcaseStore((state) => state.publish);
  const navigate = useNavigate();
  const ids = {
    name: useId(),
    tagline: useId(),
    description: useId(),
    tech: useId(),
    repo: useId(),
    live: useId(),
  };
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [tech, setTech] = useState('');
  const [repo, setRepo] = useState('');
  const [live, setLive] = useState('');
  const [emoji, setEmoji] = useState<ProjectEmoji>(PROJECT_EMOJIS[0]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});

  const techItems = parseTech(tech);
  // Checked as the user types, so the button never offers a request the server
  // would refuse for a reason the form already knows.
  const localErrors: Partial<Record<Field, string>> = {
    ...(techItems.length > PROJECT_TECH_MAX
      ? { tech: `Up to ${String(PROJECT_TECH_MAX)} technologies.` }
      : techItems.some((item) => item.length > PROJECT_TECH_NAME_MAX)
        ? { tech: `Each name is at most ${String(PROJECT_TECH_NAME_MAX)} characters.` }
        : {}),
    ...(repo.trim() !== '' && httpsUrlOrNull(repo) === null
      ? { repoUrl: 'Use a full https:// link.' }
      : {}),
    ...(live.trim() !== '' && httpsUrlOrNull(live) === null
      ? { liveUrl: 'Use a full https:// link.' }
      : {}),
  };
  const errors = { ...serverErrors, ...localErrors };

  const canSubmit =
    name.trim() !== '' &&
    tagline.trim() !== '' &&
    Object.keys(localErrors).length === 0 &&
    !isSending;

  const send = async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }
    setIsSending(true);
    setError(null);
    setServerErrors({});

    const repoUrl = repo.trim() === '' ? null : httpsUrlOrNull(repo);
    const liveUrl = live.trim() === '' ? null : httpsUrlOrNull(live);
    const result = await publish({
      name: name.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      emoji,
      tech: techItems,
      ...(repoUrl === null ? {} : { repoUrl }),
      ...(liveUrl === null ? {} : { liveUrl }),
    });

    setIsSending(false);
    if (!result.ok) {
      setServerErrors(pickFieldErrors(result.error.fieldErrors ?? {}));
      // Covers the daily cap too: the server's wording names the limit.
      setError(result.error.message);
      return;
    }

    onClose();
    void navigate(`/showcase/${encodeURIComponent(result.data.id)}`);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Show your project"
      description="What did you build, and where can people see it?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            isLoading={isSending}
            onClick={() => {
              void send();
            }}
          >
            Publish
          </Button>
        </>
      }
    >
      <div className="gap-md flex max-h-[60vh] flex-col overflow-y-auto pr-1">
        {error !== null && (
          <p role="alert" className="text-error text-[14px]">
            {error}
          </p>
        )}
        <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
          {PROJECT_EMOJIS.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={choice === emoji}
              onClick={() => {
                setEmoji(choice);
              }}
              className={
                choice === emoji
                  ? 'bg-primary-fixed ring-primary-container grid size-10 place-items-center rounded-xl text-[22px] ring-2'
                  : 'bg-surface-container-high hover:bg-surface-container-highest grid size-10 place-items-center rounded-xl text-[22px]'
              }
            >
              {choice}
            </button>
          ))}
        </div>
        <FormField id={ids.name} label="Name" error={errors.name}>
          <Input
            id={ids.name}
            value={name}
            maxLength={PROJECT_NAME_MAX}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FormField>
        <FormField id={ids.tagline} label="One line" error={errors.tagline}>
          <Input
            id={ids.tagline}
            value={tagline}
            maxLength={PROJECT_TAGLINE_MAX}
            placeholder="What it does, in a sentence"
            onChange={(e) => {
              setTagline(e.target.value);
            }}
          />
        </FormField>
        <FormField id={ids.description} label="About" error={errors.description}>
          <textarea
            id={ids.description}
            value={description}
            rows={4}
            maxLength={PROJECT_DESCRIPTION_MAX}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            className="bg-surface-container-low border-outline-variant focus:border-primary-container focus:ring-primary-container/20 text-on-surface w-full resize-y rounded-xl border px-4 py-3 text-[15px] focus:ring-2 focus:outline-none"
          />
        </FormField>
        <FormField
          id={ids.tech}
          label="Tech"
          hint={`Comma-separated, up to ${String(PROJECT_TECH_MAX)}`}
          error={errors.tech}
        >
          <Input
            id={ids.tech}
            value={tech}
            placeholder="React, Go, Postgres"
            onChange={(e) => {
              setTech(e.target.value);
            }}
          />
        </FormField>
        <FormField id={ids.repo} label="Repository" error={errors.repoUrl}>
          <Input
            id={ids.repo}
            value={repo}
            type="url"
            placeholder="https://github.com/…"
            onChange={(e) => {
              setRepo(e.target.value);
            }}
          />
        </FormField>
        <FormField id={ids.live} label="Live site" error={errors.liveUrl}>
          <Input
            id={ids.live}
            value={live}
            type="url"
            placeholder="https://…"
            onChange={(e) => {
              setLive(e.target.value);
            }}
          />
        </FormField>
      </div>
    </Modal>
  );
}
