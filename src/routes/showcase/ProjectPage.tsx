import { ArrowLeft, ExternalLink, Eye, GitBranch, Heart, Star } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { LinkPreviewCard } from '@/components/content/LinkPreviewCard';
import { RichText } from '@/components/content/RichText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Spinner } from '@/components/ui/Spinner';
import { useProject, useProjectLike } from '@/features/showcase/hooks';
import { useShowcaseStore } from '@/features/showcase/store';
import type { Project } from '@/features/showcase/types';
import { cn } from '@/lib/cn';
import { extractLinks } from '@/lib/links';
import { coverClass } from '@/mocks/people';
import { calendarDay } from '@/lib/relative-time';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

import { formatCount } from '@/lib/format';

/** One project, in full. */
export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, lookup, reload } = useProject(projectId);

  if (lookup.status === 'missing') {
    return (
      <EmptyState
        icon={<Star className="size-6" />}
        title="Project not found"
        description="It may have been removed."
        action={
          <Link to="/showcase" className="text-primary hover:underline">
            Back to the showcase
          </Link>
        }
      />
    );
  }

  if (project === undefined) {
    return lookup.status === 'error' ? (
      <InlineAlert
        message={lookup.error ?? 'This project could not be loaded.'}
        actionLabel="Retry"
        onAction={reload}
      />
    ) : (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return <ProjectView project={project} />;
}

function ProjectView({ project }: { project: Project }) {
  const like = useProjectLike(project.id);
  const error = useShowcaseStore((state) => state.error);
  const clearError = useShowcaseStore((state) => state.clearError);

  const [descriptionLink] = extractLinks(project.description);

  const external = (href: string, label: string, icon: React.ReactNode) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-tone flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold"
    >
      {icon}
      {label}
      <ExternalLink aria-hidden className="text-on-surface-variant size-3.5" />
    </a>
  );

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
        <Link
          to="/showcase"
          aria-label="Back"
          className="hover:bg-surface-container-high transition-tone text-on-surface grid size-9 place-items-center rounded-full"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-heading text-h1 text-on-surface truncate">{project.name}</h1>
      </header>

      {error !== null && (
        <InlineAlert message={error} actionLabel="Dismiss" onAction={clearError} />
      )}

      <div className={cn('grid h-52 place-items-center', coverClass(project.id))}>
        <span className="text-[84px] drop-shadow-2xl">{project.emoji}</span>
      </div>

      <div className="flex flex-col gap-5 px-6 py-5">
        <div>
          <h2 className="text-on-surface text-[26px] font-extrabold tracking-tight">
            {project.name}
          </h2>
          <p className="text-on-surface-variant text-[16px]">{project.tagline}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {project.repoUrl !== undefined &&
            external(project.repoUrl, 'Repository', <GitBranch className="size-4" />)}
          {project.liveUrl !== undefined &&
            external(project.liveUrl, 'Live site', <ExternalLink className="size-4" />)}
          <Button
            variant={project.isLiked ? 'secondary' : 'primary'}
            leadingIcon={<Heart className={cn('size-4', project.isLiked && 'fill-current')} />}
            disabled={like.isBusy}
            onClick={like.toggle}
            className={project.isLiked ? 'text-secondary' : ''}
          >
            {project.isLiked ? 'Liked' : 'Like'} · {formatCount(project.likeCount)}
          </Button>
          <span className="text-on-surface-variant ml-auto flex items-center gap-3 text-[13px] tabular-nums">
            {project.starCount !== null && (
              <span className="flex items-center gap-1" title="GitHub stars">
                <Star aria-hidden className="size-4" />
                {formatCount(project.starCount)}
              </span>
            )}
            <span className="flex items-center gap-1" title="Views">
              <Eye aria-hidden className="size-4" />
              {formatCount(project.viewCount)}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {project.tech.map((tech) => (
            <span
              key={tech}
              className="bg-violet-fixed text-on-violet-fixed rounded-full px-3 py-1 text-[12px] font-semibold"
            >
              {tech}
            </span>
          ))}
        </div>

        <section className="bg-surface-container-lowest border-outline-variant rounded-2xl border p-5">
          <h3 className="text-on-surface-variant mb-2 text-[11px] font-semibold tracking-wider uppercase">
            About
          </h3>
          <p className="text-on-surface text-[15px] leading-relaxed whitespace-pre-wrap">
            <RichText
              text={project.description === '' ? 'No description yet.' : project.description}
            />
          </p>
          {descriptionLink !== undefined && (
            <div className="mt-3">
              <LinkPreviewCard url={descriptionLink} size="lg" />
            </div>
          )}
        </section>

        <section className="bg-surface-container-lowest border-outline-variant flex items-center gap-3 rounded-2xl border p-4">
          <Avatar
            initials={initialsOf(project.author)}
            name={displayName(project.author)}
            imageUrl={project.author.avatarUrl}
          />
          <span className="min-w-0 flex-1">
            <span className="text-on-surface block text-[15px] font-bold">
              {displayName(project.author)}
            </span>
            <span className="text-on-surface-variant block text-[13px]">
              {handleOf(project.author)} · published {calendarDay(project.createdAt)}
            </span>
          </span>
        </section>
      </div>
    </div>
  );
}
