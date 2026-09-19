import { LayoutGrid, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProjectList, useProjectTech } from '@/features/showcase/hooks';
import { useShowcaseStore } from '@/features/showcase/store';
import type { ShowcaseSort } from '@/features/showcase/types';
import { cn } from '@/lib/cn';

import { ProjectCard } from './components/ProjectCard';
import { SubmitProjectDialog } from './components/SubmitProjectDialog';

const SORTS: readonly { value: ShowcaseSort; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'newest', label: 'Newest' },
  { value: 'stars', label: 'Most starred' },
];

const FEATURED_STRIP_SIZE = 10;

/** The showcase: a featured strip, then the grid with sort and tech filters. */
export default function ShowcasePage() {
  const [sort, setSort] = useState<ShowcaseSort>('trending');
  const [tech, setTech] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const techs = useProjectTech();
  const featured = useProjectList({ sort: 'trending', featured: true, size: FEATURED_STRIP_SIZE });
  const grid = useProjectList({ sort, tech });
  const error = useShowcaseStore((state) => state.error);
  const clearError = useShowcaseStore((state) => state.clearError);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <div className="flex items-center gap-3 px-5 py-3">
          <h1 className="font-heading text-h1 text-on-surface">Showcase</h1>
          <Button
            size="sm"
            leadingIcon={<Plus className="size-4" />}
            className="ml-auto"
            onClick={() => {
              setIsSubmitting(true);
            }}
          >
            Show your project
          </Button>
        </div>
      </header>

      {error !== null && (
        <InlineAlert message={error} actionLabel="Dismiss" onAction={clearError} />
      )}

      {featured.projects.length > 0 && tech === undefined && (
        <section className="border-outline-variant border-b py-4">
          <h2 className="text-on-surface-variant flex items-center gap-1.5 px-5 pb-3 text-[11px] font-semibold tracking-wider uppercase">
            <Sparkles aria-hidden className="text-primary size-3.5" />
            Featured this week
          </h2>
          <ul className="flex gap-3 overflow-x-auto px-5 pb-1">
            {featured.projects.map((project) => (
              <li key={project.id}>
                <ProjectCard project={project} featured />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <div
          role="radiogroup"
          aria-label="Sort"
          className="bg-surface-container-low flex rounded-full p-0.5"
        >
          {SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={sort === option.value}
              onClick={() => {
                setSort(option.value);
              }}
              className={cn(
                'transition-tone rounded-full px-3 py-1.5 text-[13px] font-semibold',
                sort === option.value
                  ? 'bg-surface-container-lowest text-on-surface shadow-floating'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {techs.map((item) => (
            <button
              key={item.name}
              type="button"
              aria-pressed={tech === item.name}
              title={`${String(item.projectCount)} projects`}
              onClick={() => {
                setTech(tech === item.name ? undefined : item.name);
              }}
              className={cn(
                'transition-tone rounded-full px-2.5 py-1 text-[12px] font-semibold',
                tech === item.name
                  ? 'bg-violet text-on-violet'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface',
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      {grid.projects.length === 0 && (grid.status === 'loading' || grid.status === 'idle') ? (
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2" aria-busy>
          <Skeleton className="h-60 rounded-2xl" />
          <Skeleton className="h-60 rounded-2xl" />
        </div>
      ) : grid.projects.length === 0 && grid.status === 'error' ? (
        <InlineAlert
          message={grid.error ?? 'Projects could not be loaded.'}
          actionLabel="Retry"
          onAction={grid.reload}
        />
      ) : grid.projects.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="size-6" />}
          title={tech === undefined ? 'No projects yet' : `No ${tech} projects yet`}
          description="Built something? Be the first to show it."
        />
      ) : (
        <>
          <ul className="stagger grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            {grid.projects.map((project) => (
              <li key={project.id} className="animate-fade-up">
                <ProjectCard project={project} />
              </li>
            ))}
          </ul>
          {grid.error !== null && (
            <InlineAlert message={grid.error} actionLabel="Retry" onAction={grid.loadMore} />
          )}
          {grid.hasMore && grid.error === null && (
            <div className="pb-lg flex justify-center">
              <Button variant="secondary" isLoading={grid.isLoadingMore} onClick={grid.loadMore}>
                {grid.isLoadingMore ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          )}
        </>
      )}

      {isSubmitting && (
        <SubmitProjectDialog
          onClose={() => {
            setIsSubmitting(false);
          }}
        />
      )}
    </div>
  );
}
