import { Check, ChevronDown, ChevronsUpDown, LogOut, Plus, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Popover } from '@/components/ui/Popover';
import { Spinner } from '@/components/ui/Spinner';
import { useAccountsStore } from '@/features/auth/accounts-store';
import { useCurrentUser } from '@/features/auth/hooks';
import { useFriendList } from '@/features/friends/hooks';
import { cn } from '@/lib/cn';
import { displayName, handleOf, initialsOf } from '@/lib/user-display';

import { SignOutDialog } from './SignOutDialog';

/**
 * The signed-in identity at the foot of the nav rail, and the accounts behind it.
 *
 * Only accounts the user asked to be remembered appear here, because only those
 * have a stored credential to resume from — an account signed into without
 * "Remember me" leaves nothing behind on purpose, and listing it would offer a
 * switch that cannot happen.
 *
 * Switching is one click and no password. What makes that safe to offer is that
 * the credential never leaves the main process: this component sends a user id
 * and receives a profile, and could not authenticate as anyone even if the page
 * were fully compromised (OWASP A01/A02).
 */
interface AccountMenuProps {
  /**
   * `row` is the labelled rail's foot: avatar, name, handle, opening upward.
   * `pill` is the compact top bar's: your friend count and avatar, opening
   * downward from the bar's right edge.
   */
  variant?: 'row' | 'pill';
}

export function AccountMenu({ variant = 'row' }: AccountMenuProps) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);
  const friendCount = useFriendList('friends').total;

  const accounts = useAccountsStore((state) => state.accounts);
  const status = useAccountsStore((state) => state.status);
  const canRemember = useAccountsStore((state) => state.canRemember);
  const maxAccounts = useAccountsStore((state) => state.maxAccounts);
  const switchingTo = useAccountsStore((state) => state.switchingTo);
  const error = useAccountsStore((state) => state.error);
  const load = useAccountsStore((state) => state.load);
  const switchTo = useAccountsStore((state) => state.switchTo);
  const forget = useAccountsStore((state) => state.forget);
  const beginAddAccount = useAccountsStore((state) => state.beginAddAccount);

  // The list is read when the menu is first opened rather than at startup: it
  // touches the vault, and most sessions never open this.
  useEffect(() => {
    if (isOpen && status === 'idle') {
      void load();
    }
  }, [isOpen, status, load]);

  if (user === null) {
    return null;
  }

  const others = accounts.filter((account) => !account.isActive);
  const isFull = accounts.length >= maxAccounts;

  return (
    <>
      <Popover
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
        }}
        // The rail sits at the bottom of the window, so the panel opens upward.
        side={variant === 'pill' ? 'below' : 'above'}
        align={variant === 'pill' ? 'right' : 'left'}
        label="Accounts"
        panelClassName="w-[248px] max-h-[60vh]"
        trigger={
          variant === 'pill' ? (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              aria-label={`Accounts — signed in as ${displayName(user)}`}
              onClick={() => {
                setIsOpen((previous) => !previous);
              }}
              className={cn(
                'border-outline-strong bg-surface-container-lowest hover:bg-surface-container-low transition-tone flex h-[38px] items-center gap-[9px] rounded-[10px] border pr-1.5 pl-2',
                isOpen && 'bg-surface-container-low',
              )}
            >
              <span className="text-outline text-[12.5px]">
                <strong className="text-on-surface font-mono font-medium">{friendCount}</strong>{' '}
                {friendCount === 1 ? 'friend' : 'friends'}
              </span>
              <span aria-hidden className="bg-outline-strong h-4 w-px" />
              <Avatar
                initials={initialsOf(user)}
                name={displayName(user)}
                imageUrl={user.avatarUrl}
                size="xs"
              />
              <ChevronDown aria-hidden className="text-outline size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              onClick={() => {
                setIsOpen((previous) => !previous);
              }}
              className={cn(
                'hover:bg-surface-container-low transition-tone flex h-[52px] w-full items-center gap-2.5 rounded-xl px-2.5 text-left',
                isOpen && 'bg-surface-container-low',
              )}
            >
              <Avatar
                initials={initialsOf(user)}
                name={displayName(user)}
                imageUrl={user.avatarUrl}
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="text-on-surface block truncate text-[13.5px] font-semibold">
                  {displayName(user)}
                </span>
                <span className="text-outline block truncate text-[12px]">{handleOf(user)}</span>
              </span>
              <ChevronsUpDown aria-hidden className="text-outline size-3.5 shrink-0" />
            </button>
          )
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === 'loading' && accounts.length === 0 && (
            <div className="px-md py-md">
              <Spinner label="Loading accounts" />
            </div>
          )}

          <ul className="flex flex-col">
            {accounts.map((account) => {
              const isSwitching = switchingTo === account.userId;
              return (
                <li key={account.userId} className="group/account relative">
                  <button
                    type="button"
                    disabled={account.isActive || switchingTo !== null}
                    onClick={() => {
                      void switchTo(account.userId);
                    }}
                    className={cn(
                      'gap-sm px-md py-sm flex w-full items-center text-left',
                      account.isActive
                        ? 'bg-primary-fixed/10 cursor-default'
                        : 'hover:bg-surface-container-low transition-tone',
                      switchingTo !== null && !isSwitching && 'opacity-50',
                    )}
                  >
                    <Avatar
                      initials={initialsOf(account)}
                      name={displayName(account)}
                      imageUrl={account.avatarUrl}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-on-surface block truncate text-[14px] font-semibold">
                        {displayName(account)}
                      </span>
                      <span className="text-on-surface-variant block truncate text-[12px]">
                        {handleOf(account)}
                      </span>
                    </span>
                    {isSwitching ? (
                      <Spinner label="" className="shrink-0" />
                    ) : (
                      account.isActive && (
                        <Check aria-label="Signed in" className="text-primary size-4 shrink-0" />
                      )
                    )}
                  </button>

                  {!account.isActive && switchingTo === null && (
                    <span className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity group-hover/account:opacity-100 focus-within:opacity-100">
                      <IconButton
                        label={`Remove ${displayName(account)} from this device`}
                        size="sm"
                        tone="danger"
                        icon={<X className="size-3.5" />}
                        onClick={() => {
                          void forget(account.userId);
                        }}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {others.length === 0 && status === 'ready' && (
            <p className="text-on-surface-variant px-md pt-xs pb-sm text-[12px]">
              {canRemember
                ? 'Add another account to switch between them without signing in each time.'
                : 'This desktop has no keychain available, so accounts cannot be kept signed in here.'}
            </p>
          )}

          {!canRemember && others.length > 0 && (
            <p className="text-on-surface-variant gap-xs px-md py-sm flex items-start text-[12px]">
              <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Sessions cannot be saved on this desktop, so these will not survive a restart.
            </p>
          )}

          {error !== null && (
            <p
              role="alert"
              className="text-on-error-container bg-error-container/40 px-md py-sm text-[12px]"
            >
              {error}
            </p>
          )}
        </div>

        <div className="border-outline-variant flex flex-col border-t">
          <button
            type="button"
            disabled={isFull || switchingTo !== null}
            title={
              isFull ? `You can keep ${String(maxAccounts)} accounts signed in here` : undefined
            }
            onClick={() => {
              setIsOpen(false);
              beginAddAccount();
              void navigate('/login');
            }}
            className="text-on-surface hover:bg-surface-container-low transition-tone gap-sm px-md py-sm flex items-center text-[14px] font-semibold disabled:opacity-50"
          >
            <Plus aria-hidden className="size-4" />
            Add another account
          </button>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setIsSignOutOpen(true);
            }}
            className="text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-tone gap-sm px-md py-sm flex items-center text-[14px]"
          >
            <LogOut aria-hidden className="size-4" />
            Sign out {handleOf(user)}
          </button>
        </div>
      </Popover>

      {isSignOutOpen && (
        <SignOutDialog
          isOpen
          onClose={() => {
            setIsSignOutOpen(false);
          }}
        />
      )}
    </>
  );
}
