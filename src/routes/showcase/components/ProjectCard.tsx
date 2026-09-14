import { Eye, Heart, Star } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { useShowcaseStore } from '@/features/showcase/store';
import type { Project } from '@/features/showcase/types';
import { cn } from '@/lib/cn';
import { coverClass } from '@/mocks/people';
import { displayName, initialsOf } from '@/lib/user-display';

import { formatCount } from '@/lib/format';

interface ProjectCardProps {
  project: Project;
  /** The wide, hero-shaped variant for the featured strip. */
  featured?: boolean;
}

/** A project tile: cover, name and tagline, tech chips, author, numbers. */
export const ProjectCard = memo(function ProjectCard({
  project,
  featured = false,
}: ProjectCardProps) {
  const toggleLike = useShowcaseStore((state) => state.toggleLike);

  return (
    <article
      className={cn(
        'bg-surface-container-lowest border-outline-variant hover:border-outline/40 group/card transition-tone flex flex-col overflow-hidden rounded-2xl border',
        featured && 'w-[300px] shrink-0',
      )}
    >
      <Link
        to={`/showcase/${project.id}`}
        className={cn(
          'relative grid place-items-center overflow-hidden',
          featured ? 'h-36' : 'h-32',
          coverClass(project.id),
        )}
      >
        <span className="text-[48px] drop-shadow-lg transition-transform duration-500 group-hover/card:scale-110">
          {project.emoji}
        </span>
        {project.featured && (
          <span className="absolute top-2 left-2 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
            Featured
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="min-w-0">
          <Link
            to={`/showcase/${project.id}`}
            className="text-on-surface block truncate text-[16px] font-bold hover:underline"
          >
            {project.name}
          </Link>
          <p className="text-on-surface-variant line-clamp-2 text-[13px]">{project.tagline}</p>
        </div>

        <div className="flex flex-wrap gap-1">
          {project.tech.slice(0, 3).map((tech) => (
            <span
              key={tech}
              className="bg-violet-fixed text-on-violet-fixed rounded-full px-2 py-0.5 text-[11px] font-semibold"
            >
              {tech}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Avatar
            initials={initialsOf(project.author)}
            name={displayName(project.author)}
            imageUrl={project.author.avatarUrl}
            size="xs"
          />
          <span className="text-on-surface-variant truncate text-[12px]">
            {displayName(project.author)}
          </span>
          <span className="text-on-surface-variant ml-auto flex items-center gap-2 text-[12px] tabular-nums">
            <span className="flex items-center gap-0.5" title="GitHub stars">
              <Star aria-hidden className="size-3.5" />
              {formatCount(project.stars)}
            </span>
            <span className="flex items-center gap-0.5" title="Views">
              <Eye aria-hidden className="size-3.5" />
              {formatCount(project.views)}
            </span>
            <button
              type="button"
              aria-pressed={project.viewerLiked}
              aria-label={project.viewerLiked ? 'Unlike' : 'Like'}
              onClick={() => {
                toggleLike(project.id);
              }}
              className={cn(
                'transition-tone flex items-center gap-0.5 rounded-full px-1.5 py-0.5',
                project.viewerLiked
                  ? 'text-secondary'
                  : 'hover:bg-secondary-fixed hover:text-secondary',
              )}
            >
              <Heart
                aria-hidden
                className={cn('size-3.5', project.viewerLiked && 'fill-current')}
              />
              {formatCount(project.likes)}
            </button>
          </span>
        </div>
      </div>
    </article>
  );
});
