import { Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { SampleBadge } from '@/components/ui/SampleBadge';
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

/** The showcase: a featured strip, then the grid with sort and tech filters. */
export default function ShowcasePage() {
  const projects = useShowcaseStore((state) => state.projects);
  const [sort, setSort] = useState<ShowcaseSort>('trending');
  const [tech, setTech] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const techs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      for (const item of project.tech) {
        counts.set(item, (counts.get(item) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);
  }, [projects]);

  const sorted = useMemo(() => {
    const filtered = tech === null ? projects : projects.filter((p) => p.tech.includes(tech));
    return [...filtered].sort((a, b) => {
      if (sort === 'newest') {
        return b.createdAt.localeCompare(a.createdAt);
      }
      if (sort === 'stars') {
        return b.stars - a.stars;
      }
      return b.likes + b.views / 50 - (a.likes + a.views / 50);
    });
  }, [projects, sort, tech]);

  const featured = projects.filter((p) => p.featured);

  return (
    <div className="flex w-full flex-col">
      <header className="glass border-outline-variant sticky top-0 z-10 border-b">
        <div className="flex items-center gap-3 px-5 py-3">
          <h1 className="font-heading text-h1 text-on-surface">Showcase</h1>
          <SampleBadge />
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

      {featured.length > 0 && tech === null && (
        <section className="border-outline-variant border-b py-4">
          <h2 className="text-on-surface-variant flex items-center gap-1.5 px-5 pb-3 text-[11px] font-semibold tracking-wider uppercase">
            <Sparkles aria-hidden className="text-primary size-3.5" />
            Featured this week
          </h2>
          <ul className="flex gap-3 overflow-x-auto px-5 pb-1">
            {featured.map((project) => (
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
              key={item}
              type="button"
              aria-pressed={tech === item}
              onClick={() => {
                setTech(tech === item ? null : item);
              }}
              className={cn(
                'transition-tone rounded-full px-2.5 py-1 text-[12px] font-semibold',
                tech === item
                  ? 'bg-violet text-on-violet'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface',
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <ul className="stagger grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        {sorted.map((project) => (
          <li key={project.id} className="animate-fade-up">
            <ProjectCard project={project} />
          </li>
        ))}
      </ul>

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
