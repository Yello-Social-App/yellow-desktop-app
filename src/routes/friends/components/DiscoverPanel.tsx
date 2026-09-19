import { Compass } from 'lucide-react';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { SampleBadge } from '@/components/ui/SampleBadge';
import { useSuggestions } from '@/features/people/hooks';

import { DirectoryRow } from './DirectoryRow';
import { SuggestionCard } from './SuggestionCard';

function SectionHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
}) {
  return (
    <div className="px-lg">
      <div className="gap-sm flex items-center">
        <h2 className="font-heading text-h2 text-on-surface">{title}</h2>
        {badge}
      </div>
      <p className="text-on-surface-variant mt-0.5 text-[13px]">{description}</p>
    </div>
  );
}

/**
 * The Discover tab: friends of friends as cards, then people from joined
 * communities as rows. Runs on sample data until a suggestions endpoint exists.
 */
export function DiscoverPanel() {
  const { mutual, community } = useSuggestions();

  if (mutual.length === 0 && community.length === 0) {
    return (
      <EmptyState
        icon={<Compass className="size-6" />}
        title="No suggestions right now"
        description="As you add friends and join communities, people you might know show up here."
      />
    );
  }

  return (
    <div className="pb-lg flex flex-col">
      {mutual.length > 0 && (
        <section className="@container pt-5">
          <SectionHeader
            title="People you may know"
            description="Friends of your friends, most mutual connections first."
            badge={<SampleBadge />}
          />
          <ul className="stagger px-lg mt-3 grid grid-cols-2 gap-3 @xl:grid-cols-3">
            {mutual.map((person) => (
              <li key={person.user.id} className="animate-fade-up">
                <SuggestionCard person={person} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {community.length > 0 && (
        <section className="pt-7">
          <SectionHeader
            title="From your communities"
            description="People active in the communities you have joined."
            badge={mutual.length === 0 ? <SampleBadge /> : undefined}
          />
          <ul className="stagger divide-hairline mt-2 flex flex-col">
            {community.map((person) => (
              <li key={person.user.id} className="animate-fade-up">
                <DirectoryRow person={person} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
