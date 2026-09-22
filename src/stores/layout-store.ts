/**
 * Which shape the app frame is in.
 *
 *   - `expanded` — "quiet rails": a 240px labelled nav rail and a 320px context
 *     rail with the identity card, recent chats and trending projects;
 *   - `compact` — a 72px icon rail (labels in tooltips) and one context panel
 *     with a Chats / Trending switch, which gives the reading column room.
 *
 * Two variants of one frame, sharing every data source, so this is a plain
 * value the rails branch on rather than two shells. Stored in localStorage as a
 * per-machine convenience, like the theme — it is not account data, and it is
 * read and written inside a try/catch because storage can be absent or refused.
 */
import { create } from 'zustand';

export type RailMode = 'expanded' | 'compact';
export type CompactPanelTab = 'chats' | 'trending';

const STORAGE_KEY = 'yello.rails';

function readStoredMode(): RailMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'compact' ? 'compact' : 'expanded';
  } catch {
    return 'expanded';
  }
}

interface LayoutState {
  railMode: RailMode;
  /** The compact panel's switch; kept here so it survives a route change. */
  panelTab: CompactPanelTab;
  toggleRails: () => void;
  setPanelTab: (tab: CompactPanelTab) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  railMode: readStoredMode(),
  panelTab: 'chats',

  toggleRails: () => {
    const railMode: RailMode = get().railMode === 'expanded' ? 'compact' : 'expanded';
    try {
      localStorage.setItem(STORAGE_KEY, railMode);
    } catch {
      // Not persisting is fine; the session still gets the choice.
    }
    set({ railMode });
  },

  setPanelTab: (panelTab) => {
    set({ panelTab });
  },
}));
