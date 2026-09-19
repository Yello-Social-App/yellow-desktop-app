/**
 * The remembered accounts, and their refresh tokens.
 *
 * This is the single-account vault grown a dimension. Everything that protected
 * one refresh token protects all of them: the whole file is encrypted through
 * Electron's safeStorage with an OS-managed key, written 0600, and never
 * reachable from the renderer — no IPC channel returns a token, only a profile
 * (OWASP A02/A04).
 *
 * What genuinely changed is the blast radius, and it is worth naming rather
 * than glossing: one compromised vault now exposes every remembered account
 * instead of one. Three things hold that down — only accounts the user asked to
 * remember are stored at all, the list is capped, and signing out of an account
 * erases its token immediately rather than leaving it to age out.
 *
 * Tokens rotate on every refresh, so the stored copy is rewritten whenever the
 * active account gets a new pair. A stale token here is not a security problem
 * but it is a correctness one: it would make the next switch to that account
 * fail and look like a revoked session.
 */
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, safeStorage } from 'electron';
import { z } from 'zod';

import { createLogger } from '../../shared/logger';

const log = createLogger('api.accounts');

const VAULT_FILE_NAME = 'accounts.vault';
/** The single-account file this replaced; read once, then removed. */
const LEGACY_VAULT_FILE_NAME = 'session.vault';
/** Owner read/write only. */
const VAULT_FILE_MODE = 0o600;

/**
 * How many accounts may be remembered at once.
 *
 * A cap rather than an unbounded list because every entry is a live credential:
 * the number of accounts one stolen vault yields should be a number the user
 * could plausibly name. Past the cap the least recently used is evicted, and
 * its token is erased with it.
 */
export const MAX_REMEMBERED_ACCOUNTS = 5;

const storedAccountSchema = z.object({
  userId: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  fullName: z.string().max(200).optional(),
  avatarUrl: z.string().max(2048).optional(),
  refreshToken: z.string().min(1).max(4096),
  lastUsedAt: z.number().int().nonnegative(),
});

const vaultSchema = z.object({
  version: z.literal(1),
  activeUserId: z.string().min(1).max(64).nullable(),
  accounts: z.array(storedAccountSchema).max(MAX_REMEMBERED_ACCOUNTS),
});

/** The legacy shape: one bare refresh token, no idea whose it was. */
const legacyVaultSchema = z.object({ refreshToken: z.string().min(1).max(4096) });

type StoredAccount = z.infer<typeof storedAccountSchema>;
type Vault = z.infer<typeof vaultSchema>;

/** What the renderer is allowed to know: who, never how to become them. */
export interface AccountProfile {
  userId: string;
  username: string;
  fullName?: string | undefined;
  avatarUrl?: string | undefined;
}

/** The switcher's view of a profile: enough to recognise a face, never a token. */
export function accountProfileOf(user: {
  id: string;
  username: string;
  fullName?: string | undefined;
  avatarUrl?: string | undefined;
}): AccountProfile {
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
  };
}

const EMPTY_VAULT: Vault = { version: 1, activeUserId: null, accounts: [] };

let vault: Vault = EMPTY_VAULT;
let isLoaded = false;

/**
 * A refresh token recovered from the legacy vault before we know whose it is.
 * A cold start exchanges it, and the profile that comes back is what finally
 * names the account — at which point it is written properly and this is dropped.
 */
let orphanedLegacyToken: string | null = null;

function vaultPath(): string {
  return path.join(app.getPath('userData'), VAULT_FILE_NAME);
}

function legacyVaultPath(): string {
  return path.join(app.getPath('userData'), LEGACY_VAULT_FILE_NAME);
}

/**
 * Writes are serialized through one chain.
 *
 * Two rotations landing together would otherwise interleave a read-modify-write
 * and lose one account's token — which reads to the user as "that account
 * randomly signed itself out".
 */
let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(): Promise<void> {
  writeChain = writeChain.then(persist, persist);
  return writeChain;
}

async function persist(): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    return;
  }
  try {
    const ciphertext = safeStorage.encryptString(JSON.stringify(vault));
    await writeFile(vaultPath(), ciphertext, { mode: VAULT_FILE_MODE });
    // writeFile's mode only applies when it creates the file; enforce it either way.
    await chmod(vaultPath(), VAULT_FILE_MODE);
  } catch {
    // A vault that cannot be written costs persistence, not the session.
    log.warn('vault_write_failed', {});
  }
}

export function isSecureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** Reads the vault from disk once, migrating the single-account file if present. */
export async function loadVault(): Promise<void> {
  if (isLoaded) {
    return;
  }
  isLoaded = true;

  let ciphertext: Buffer;
  try {
    ciphertext = await readFile(vaultPath());
  } catch {
    // No vault yet is the normal first run, not an error. Try the old one.
    await adoptLegacyVault();
    return;
  }

  let plaintext: string;
  try {
    plaintext = safeStorage.decryptString(ciphertext);
  } catch {
    // A key the OS will no longer give us back: the tokens are unrecoverable.
    log.warn('vault_undecryptable', {});
    await rm(vaultPath(), { force: true });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    log.warn('vault_unparseable', {});
    await rm(vaultPath(), { force: true });
    return;
  }

  // Decrypted bytes are still untrusted input: parse before use (A08).
  const result = vaultSchema.safeParse(parsed);
  if (!result.success) {
    log.warn('vault_shape_rejected', {});
    await rm(vaultPath(), { force: true });
    return;
  }

  vault = result.data;
  log.info('vault_loaded', { accounts: vault.accounts.length });
}

/** Picks up a token written by the previous single-account build. */
async function adoptLegacyVault(): Promise<void> {
  let ciphertext: Buffer;
  try {
    ciphertext = await readFile(legacyVaultPath());
  } catch {
    return;
  }

  try {
    const plaintext = safeStorage.decryptString(ciphertext);
    const parsed = legacyVaultSchema.safeParse(JSON.parse(plaintext) as unknown);
    if (parsed.success) {
      orphanedLegacyToken = parsed.data.refreshToken;
      log.info('legacy_vault_adopted', {});
    }
  } catch {
    log.warn('legacy_vault_undecryptable', {});
  }

  // Either way it is spent: the new vault is the only one written from here.
  await rm(legacyVaultPath(), { force: true });
}

/** The refresh token to try on a cold start, if any account was remembered. */
export function startupRefreshToken(): string | null {
  if (orphanedLegacyToken !== null) {
    return orphanedLegacyToken;
  }
  const active = vault.accounts.find((account) => account.userId === vault.activeUserId);
  return active?.refreshToken ?? null;
}

export function activeAccountId(): string | null {
  return vault.activeUserId;
}

/** Everyone remembered, most recently used first. Never includes a token. */
export function listAccounts(): AccountProfile[] {
  return [...vault.accounts]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map(({ userId, username, fullName, avatarUrl }) => ({
      userId,
      username,
      fullName,
      avatarUrl,
    }));
}

export function hasAccount(userId: string): boolean {
  return vault.accounts.some((account) => account.userId === userId);
}

/** The stored token for one account, for the main process's own use only. */
export function refreshTokenFor(userId: string): string | null {
  return vault.accounts.find((account) => account.userId === userId)?.refreshToken ?? null;
}

/**
 * Records an account as remembered and makes it the active one, evicting the
 * least recently used if the list is full.
 */
export async function rememberAccount(
  profile: AccountProfile,
  refreshToken: string,
): Promise<void> {
  const entry: StoredAccount = {
    userId: profile.userId,
    username: profile.username,
    ...(profile.fullName === undefined ? {} : { fullName: profile.fullName }),
    ...(profile.avatarUrl === undefined ? {} : { avatarUrl: profile.avatarUrl }),
    refreshToken,
    lastUsedAt: Date.now(),
  };

  const others = vault.accounts.filter((account) => account.userId !== profile.userId);
  // Oldest first, so the slice keeps the most recently used.
  others.sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  vault = {
    version: 1,
    activeUserId: profile.userId,
    accounts: [entry, ...others].slice(0, MAX_REMEMBERED_ACCOUNTS),
  };
  orphanedLegacyToken = null;
  await enqueueWrite();
  log.info('account_remembered', { accounts: vault.accounts.length });
}

/**
 * Marks an account active without touching its token, and refreshes its
 * profile snapshot so the switcher does not show a stale name or avatar.
 *
 * The snapshot is replaced, not merged: the profile passed in is always a
 * fresh server read, so a name or avatar it lacks has been cleared, and
 * keeping the old one would show a photo the user just removed.
 */
export async function markAccountActive(profile: AccountProfile): Promise<void> {
  vault = {
    ...vault,
    activeUserId: profile.userId,
    accounts: vault.accounts.map((account) =>
      account.userId === profile.userId
        ? {
            userId: account.userId,
            username: profile.username,
            ...(profile.fullName === undefined ? {} : { fullName: profile.fullName }),
            ...(profile.avatarUrl === undefined ? {} : { avatarUrl: profile.avatarUrl }),
            refreshToken: account.refreshToken,
            lastUsedAt: Date.now(),
          }
        : account,
    ),
  };
  await enqueueWrite();
}

/**
 * Replaces the active account's stored token after a rotation.
 *
 * Called on every refresh. A no-op when nothing is remembered, which is the
 * case for a session the user chose not to persist.
 */
export function noteActiveRefreshToken(refreshToken: string): void {
  const { activeUserId } = vault;
  if (activeUserId === null) {
    return;
  }
  const current = vault.accounts.find((account) => account.userId === activeUserId);
  if (current === undefined || current.refreshToken === refreshToken) {
    return;
  }

  vault = {
    ...vault,
    accounts: vault.accounts.map((account) =>
      account.userId === activeUserId ? { ...account, refreshToken } : account,
    ),
  };
  void enqueueWrite();
}

/** Erases one account's token and entry. Used by sign-out and by "forget". */
export async function forgetAccount(userId: string): Promise<void> {
  const accounts = vault.accounts.filter((account) => account.userId !== userId);
  vault = {
    version: 1,
    activeUserId: vault.activeUserId === userId ? null : vault.activeUserId,
    accounts,
  };
  if (accounts.length === 0) {
    await rm(vaultPath(), { force: true });
    writeChain = Promise.resolve();
  } else {
    await enqueueWrite();
  }
  log.info('account_forgotten', { remaining: accounts.length });
}

/** Erases every stored credential. */
export async function forgetAllAccounts(): Promise<void> {
  vault = EMPTY_VAULT;
  orphanedLegacyToken = null;
  await rm(vaultPath(), { force: true });
  writeChain = Promise.resolve();
  log.info('all_accounts_forgotten', {});
}

/** Detaches the active marker without erasing anything, for a plain sign-out. */
export async function clearActiveAccount(): Promise<void> {
  if (vault.activeUserId === null) {
    return;
  }
  vault = { ...vault, activeUserId: null };
  await enqueueWrite();
}
