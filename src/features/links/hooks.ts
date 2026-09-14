import { useEffect } from 'react';

import { useLinksStore, type PreviewEntry } from './store';

/** The preview for a URL, loading it on first ask. `undefined` URL: nothing. */
export function useLinkPreview(url: string | undefined): PreviewEntry | undefined {
  const entry = useLinksStore((state) => (url === undefined ? undefined : state.byUrl[url]));
  const load = useLinksStore((state) => state.load);

  useEffect(() => {
    if (url !== undefined) {
      load(url);
    }
  }, [url, load]);

  return entry;
}
