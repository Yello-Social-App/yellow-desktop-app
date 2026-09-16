/**
 * The accounts this device remembers, and the act of moving between them.
 *
 * The store holds profiles — a name, a handle, an avatar — and never a
 * credential. Switching is asked for by user id; the main process decides
 * whether that id is one it holds a token for, and the renderer has no way to
 * influence that answer (OWASP A01/A02).
 *
 * The one thing worth understanding here is why a successful switch reloads the
 * window. See `applySwitch`.
 */
import type { AccountSummary } from '@shared/ipc-types';
import { create } from 'zustand';

import { ipc } from '@/lib/ipc';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth.accounts');

export type AccountsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AccountsState {
  accounts: AccountSummary[];
  status: AccountsStatus;
  /** Whether the OS keychain can hold a credential at all on this machine. */
  canRemember: boolean;
  maxAccounts: number;
  /** The account a switch is in flight for, so its row can show it. */
  switchingTo: string | null;
  /**
   * The user is signing into an additional account: the sign-in screens are
   * reachable even though a session is already live.
   */
  isAddingAccount: boolean;
  error: string | null;

  load: () => Promise<void>;
  switchTo: (userId: string) => Promise<boolean>;
  forget: (userId: string) => Promise<void>;
  beginAddAccount: () => void;
  cancelAddAccount: () => void;
  /** A sign-in finished while adding: the new account is now the active one. */
  completeAddAccount: () => void;
  clearError: () => void;
}

/**
 * Starts the app again as the account that was just adopted.
 *
 * Every feature store in this renderer is scoped to one account — the feed, the
 * conversations, the notification inbox, the resolved user directory — and none
 * of them were built to be emptied. Switching without clearing them shows the
 * new account the previous one's posts and direct messages until each store
 * happens to refetch, which is a data leak between two people who may share
 * nothing but a laptop.
 *
 * Reloading is blunt, and chosen deliberately over adding a `reset()` to every
 * store: the reset approach is correct only while nobody forgets to wire up the
 * next store, and the failure mode of forgetting is showing someone another
 * account's private messages. A reload cannot be forgotten. The route is sent
 * home first because the current one may name a resource — a conversation, a
 * post — that the new account cannot see.
 */
function applySwitch(): void {
  window.location.hash = '#/feed';
  window.location.reload();
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  status: 'idle',
  canRemember: true,
  maxAccounts: 5,
  switchingTo: null,
  isAddingAccount: false,
  error: null,

  load: async () => {
    set((state) => ({ status: state.status === 'ready' ? 'ready' : 'loading' }));

    const result = await ipc.listAccounts();
    if (!result.ok) {
      set({ status: 'error', error: result.error.message });
      return;
    }

    set({
      accounts: result.data.accounts,
      canRemember: result.data.canRemember,
      maxAccounts: result.data.maxAccounts,
      status: 'ready',
      error: null,
    });
  },

  switchTo: async (userId) => {
    if (get().switchingTo !== null) {
      return false;
    }
    set({ switchingTo: userId, error: null });

    const result = await ipc.switchAccount({ userId });

    if (!result.ok) {
      // The main process keeps the current session on a failed switch, so there
      // is nothing to recover here beyond saying what happened and re-reading
      // the list — an expired account will have been dropped from it.
      set({ switchingTo: null, error: result.error.message });
      void get().load();
      return false;
    }

    log.info('account_switched', {});
    applySwitch();
    return true;
  },

  forget: async (userId) => {
    const result = await ipc.forgetAccount({ userId });
    if (!result.ok) {
      set({ error: result.error.message });
      return;
    }
    set((state) => ({
      accounts: state.accounts.filter((account) => account.userId !== userId),
      error: null,
    }));
    log.info('account_removed', {});
  },

  beginAddAccount: () => {
    set({ isAddingAccount: true, error: null });
  },

  cancelAddAccount: () => {
    set({ isAddingAccount: false });
  },

  completeAddAccount: () => {
    set({ isAddingAccount: false });
    // Signing in as someone else is a switch by another name, and leaves the
    // same stale per-account state behind. Same remedy.
    applySwitch();
  },

  clearError: () => {
    set({ error: null });
  },
}));
