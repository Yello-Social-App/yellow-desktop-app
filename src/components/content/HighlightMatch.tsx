import { normalizeQuery } from '@/features/people/search';

interface HighlightMatchProps {
  text: string;
  query: string;
}

/**
 * The first case-insensitive occurrence of the query, in the brand yellow.
 *
 * Built from React text nodes, never markup, so a name that looks like HTML
 * stays text (A05). Where lower-casing changes the string's length (some
 * non-Latin letters do), indexes would drift, so the text is left plain.
 */
export function HighlightMatch({ text, query }: HighlightMatchProps) {
  const needle = normalizeQuery(query);
  const haystack = text.toLowerCase();
  const start = needle === '' || haystack.length !== text.length ? -1 : haystack.indexOf(needle);

  if (start < 0) {
    return <>{text}</>;
  }

  const end = start + needle.length;
  return (
    <>
      {text.slice(0, start)}
      <mark className="text-primary bg-transparent">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
