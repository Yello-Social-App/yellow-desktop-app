/**
 * App-update state for the Settings screen.
 *
 * The main process owns the state and pushes every change, so this only
 * mirrors it: one read on mount, then the pushes. Only Settings shows it, so
 * it is local state rather than a store.
 */
import type { UpdateState } from '@shared/ipc-types';
import { useCallback, useEffect, useState } from 'react';

import { ipc, onUpdateEvent } from '@/lib/ipc';

export interface AppUpdates {
  state: UpdateState | null;
  check: () => void;
  /** Download, verify, install and restart — one click. */
  updateNow: () => void;
  install: () => void;
  setAutoCheck: (enabled: boolean) => void;
  openReleaseNotes: () => void;
}

export function useAppUpdates(): AppUpdates {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const detach = onUpdateEvent((event) => {
      setState(event.data);
    });
    void ipc.updateState().then((result) => {
      if (!cancelled && result.ok) {
        setState(result.data);
      }
    });
    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  /** Every action answers with the state it left; the push agrees with it. */
  const adopt = useCallback((pending: ReturnType<typeof ipc.updateState>) => {
    void pending.then((result) => {
      if (result.ok) {
        setState(result.data);
      }
    });
  }, []);

  return {
    state,
    check: () => {
      adopt(ipc.checkForUpdates());
    },
    updateNow: () => {
      adopt(ipc.updateNow());
    },
    install: () => {
      adopt(ipc.installUpdate());
    },
    setAutoCheck: (enabled) => {
      adopt(ipc.setUpdateAutoCheck({ enabled }));
    },
    openReleaseNotes: () => {
      void ipc.openReleaseNotes();
    },
  };
}
