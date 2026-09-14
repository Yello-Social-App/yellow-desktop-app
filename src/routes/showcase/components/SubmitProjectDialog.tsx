import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SampleBadge } from '@/components/ui/SampleBadge';
import { useCurrentUser } from '@/features/auth/hooks';
import { useShowcaseStore } from '@/features/showcase/store';
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  PROJECT_TAGLINE_MAX,
  PROJECT_TECH_MAX,
} from '@/features/showcase/types';

interface SubmitProjectDialogProps {
  onClose: () => void;
}

const EMOJI_CHOICES = ['🚀', '🧩', '🗺️', '🧾', '🤖', '🎨', '📱', '🛠️', '📚', '🎮'];

function optionalUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function SubmitProjectDialog({ onClose }: SubmitProjectDialogProps) {
  const user = useCurrentUser();
  const submit = useShowcaseStore((state) => state.submit);
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
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0] ?? '🚀');

  const canSubmit = name.trim() !== '' && tagline.trim() !== '';

  const send = (): void => {
    if (user === null || !canSubmit) {
      return;
    }
    const id = submit({
      name: name.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      emoji,
      tech: tech
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '')
        .slice(0, PROJECT_TECH_MAX),
      repoUrl: optionalUrl(repo),
      liveUrl: optionalUrl(live),
      author: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
    });
    onClose();
    void navigate(`/showcase/${id}`);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Show your project"
      description="What did you build, and where can people see it?"
      footer={
        <>
          <span className="mr-auto self-center">
            <SampleBadge />
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={send}>
            Publish
          </Button>
        </>
      }
    >
      <div className="gap-md flex max-h-[60vh] flex-col overflow-y-auto pr-1">
        <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
          {EMOJI_CHOICES.map((choice) => (
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
        <FormField id={ids.name} label="Name">
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
        <FormField id={ids.tagline} label="One line">
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
        <FormField id={ids.description} label="About">
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
        <FormField id={ids.tech} label="Tech" hint="Comma-separated, up to six">
          <Input
            id={ids.tech}
            value={tech}
            placeholder="React, Go, Postgres"
            onChange={(e) => {
              setTech(e.target.value);
            }}
          />
        </FormField>
        <FormField id={ids.repo} label="Repository">
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
        <FormField id={ids.live} label="Live site">
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
