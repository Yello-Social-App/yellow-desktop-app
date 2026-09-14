import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
}

/** A placeholder block with a slow sheen, sized by the caller. */
export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden className={cn('skeleton block', className)} />;
}

/** The shape of a post row, for the feed while it loads. */
export function PostSkeleton() {
  return (
    <div className="gap-md p-lg flex">
      <Skeleton className="size-10 rounded-full" />
      <div className="gap-sm flex flex-1 flex-col">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

/** The shape of a person row, for lists while they load. */
export function RowSkeleton() {
  return (
    <div className="gap-md px-lg py-md flex items-center">
      <Skeleton className="size-10 rounded-full" />
      <div className="gap-xs flex flex-1 flex-col">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}
