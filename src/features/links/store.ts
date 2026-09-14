/**
 * Link previews, cached per URL for the session so a post that scrolls in
 * and out — or appears on the feed and a profile — unfurls once.
 */
import type { LinkPreview } from '@shared/ipc-types';
import { create } from 'zustand';

import { ipc } from '@/lib/ipc';

export type PreviewEntry =
  { status: 'loading' } | { status: 'ready'; preview: LinkPreview } | { status: 'none' };

interface LinksState {
  byUrl: Record<string, PreviewEntry>;
  load: (url: string) => void;
}

export const useLinksStore = create<LinksState>((set, get) => ({
  byUrl: {},

  load: (url) => {
    if (get().byUrl[url] !== undefined) {
      return;
    }
    set((state) => ({ byUrl: { ...state.byUrl, [url]: { status: 'loading' } } }));

    void ipc.linkPreview({ url }).then((result) => {
      const entry: PreviewEntry =
        result.ok && result.data.preview !== null
          ? { status: 'ready', preview: result.data.preview }
          : { status: 'none' };
      set((state) => ({ byUrl: { ...state.byUrl, [url]: entry } }));
    });
  },
}));
