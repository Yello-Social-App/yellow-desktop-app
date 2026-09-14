import { FlaskConical } from 'lucide-react';

/** Marks a surface that runs on sample data until its endpoint exists. */
export function SampleBadge() {
  return (
    <span
      title="Sample data — this feature has no API yet, so what you do here stays on this machine for the session."
      className="bg-violet-fixed text-on-violet-fixed inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-semibold tracking-wide uppercase"
    >
      <FlaskConical aria-hidden className="size-3" />
      Preview
    </span>
  );
}
