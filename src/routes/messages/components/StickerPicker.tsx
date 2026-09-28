import { STICKER_LIBRARY_MAX, STICKER_NAME_MAX, type Sticker } from '@shared/ipc-types';
import {
  ImagePlus,
  Pencil,
  Plus,
  Search,
  Send,
  Sticker as StickerIcon,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Popover } from '@/components/ui/Popover';
import { isFileDrag } from '@/features/messages/local-files';
import { useStickersStore } from '@/features/stickers/store';
import { matchesQuery, uniqueById } from '@/features/stickers/types';
import { cn } from '@/lib/cn';

import { CreateStickerDialog } from './CreateStickerDialog';
import { StickerArt } from './StickerArt';

/** A tab: Recent, the viewer's library, or one pack by id. */
type StickerTab = 'recent' | 'mine' | `pack:${string}`;

/**
 * What is open around the sticker button. One at a time, and held here
 * rather than in the panel: the dialogs are portalled to the body, and the
 * popover closes on any click outside itself — so a dialog kept inside the
 * panel would unmount the moment it was clicked.
 */
type Surface =
  | { kind: 'closed' }
  | { kind: 'picker' }
  | { kind: 'create'; file?: File }
  | { kind: 'rename'; sticker: Sticker }
  | { kind: 'delete'; sticker: Sticker };

interface StickerButtonProps {
  disabled: boolean;
  /** Whether a conversation is open to send to. */
  canSend: boolean;
  onSend: (sticker: Sticker) => void;
}

/**
 * The composer's sticker button, and everything it opens: the picker, the
 * sticker maker, and renaming or deleting one of your own.
 */
export function StickerButton({ disabled, canSend, onSend }: StickerButtonProps) {
  const [surface, setSurface] = useState<Surface>({ kind: 'closed' });
  const [tab, setTab] = useState<StickerTab | null>(null);
  const close = (): void => {
    setSurface({ kind: 'closed' });
  };

  return (
    <>
      <Popover
        isOpen={surface.kind === 'picker'}
        onClose={close}
        side="above"
        align="right"
        label="Stickers"
        trigger={
          <IconButton
            label="Stickers"
            icon={<StickerIcon className="size-[18px]" />}
            disabled={disabled}
            isActive={surface.kind === 'picker'}
            aria-haspopup="dialog"
            aria-expanded={surface.kind === 'picker'}
            onClick={() => {
              setSurface(surface.kind === 'picker' ? { kind: 'closed' } : { kind: 'picker' });
            }}
            className="size-10 disabled:opacity-40"
          />
        }
      >
        {surface.kind === 'picker' && (
          <StickerPanel
            tab={tab}
            onTab={setTab}
            onSend={(sticker) => {
              close();
              onSend(sticker);
            }}
            onCreate={(file) => {
              setSurface(file === undefined ? { kind: 'create' } : { kind: 'create', file });
            }}
            onRename={(sticker) => {
              setSurface({ kind: 'rename', sticker });
            }}
            onDelete={(sticker) => {
              setSurface({ kind: 'delete', sticker });
            }}
          />
        )}
      </Popover>

      {surface.kind === 'create' && (
        <CreateStickerDialog
          canSend={canSend}
          initialFile={surface.file}
          onClose={close}
          onSaved={(sticker, andSend) => {
            if (andSend) {
              close();
              onSend(sticker);
              return;
            }
            // Back to the picker, on the tab where the new one now is first.
            setTab('mine');
            setSurface({ kind: 'picker' });
          }}
        />
      )}
      {surface.kind === 'rename' && (
        <RenameStickerDialog
          sticker={surface.sticker}
          onDone={() => {
            setSurface({ kind: 'picker' });
          }}
        />
      )}
      {surface.kind === 'delete' && (
        <DeleteStickerDialog
          sticker={surface.sticker}
          onDone={() => {
            setSurface({ kind: 'picker' });
          }}
        />
      )}
    </>
  );
}

interface StickerPanelProps {
  tab: StickerTab | null;
  onTab: (tab: StickerTab) => void;
  onSend: (sticker: Sticker) => void;
  onCreate: (file?: File) => void;
  onRename: (sticker: Sticker) => void;
  onDelete: (sticker: Sticker) => void;
}

interface MenuAt {
  sticker: Sticker;
  x: number;
  y: number;
}

/**
 * The picker: search, one tab per set, and a grid. Clicking a sticker sends
 * it. A picture dragged onto the panel opens the sticker maker with it —
 * the thread's own drop, which attaches files, is not given the event.
 */
function StickerPanel({ tab, onTab, onSend, onCreate, onRename, onDelete }: StickerPanelProps) {
  const status = useStickersStore((state) => state.status);
  const error = useStickersStore((state) => state.error);
  const mine = useStickersStore((state) => state.mine);
  const recent = useStickersStore((state) => state.recent);
  const packs = useStickersStore((state) => state.packs);
  const ensureLoaded = useStickersStore((state) => state.ensureLoaded);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchId = useId();

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  // Recent first when there is something in it; a first-timer lands on their
  // own (empty) library, where making one is offered.
  const activeTab: StickerTab = tab ?? (recent.length > 0 ? 'recent' : 'mine');
  const tabs: { id: StickerTab; label: string }[] = [
    { id: 'recent', label: 'Recent' },
    { id: 'mine', label: 'My stickers' },
    ...packs.map((pack) => ({ id: `pack:${pack.id}` as const, label: pack.name })),
  ];
  const mineIds = useMemo(() => new Set(mine.map((item) => item.id)), [mine]);

  const trimmed = query.trim();
  const isSearching = trimmed !== '';
  const shown = useMemo((): Sticker[] => {
    if (isSearching) {
      return uniqueById([...mine, ...packs.flatMap((pack) => pack.stickers)]).filter((item) =>
        matchesQuery(item, trimmed),
      );
    }
    if (activeTab === 'recent') {
      return recent;
    }
    if (activeTab === 'mine') {
      return mine;
    }
    const packId = activeTab.slice('pack:'.length);
    return packs.find((pack) => pack.id === packId)?.stickers ?? [];
  }, [isSearching, trimmed, activeTab, mine, recent, packs]);

  const heading = isSearching
    ? 'Results'
    : activeTab === 'recent'
      ? 'Recently sent'
      : activeTab === 'mine'
        ? `My stickers · ${String(mine.length)} of ${String(STICKER_LIBRARY_MAX)}`
        : (tabs.find((item) => item.id === activeTab)?.label ?? '');

  const drag = {
    onDragEnter: (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      depth.current += 1;
      setIsOver(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setIsOver(false);
      }
    },
    onDrop: (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      depth.current = 0;
      setIsOver(false);
      const [file] = event.dataTransfer.files;
      if (file !== undefined) {
        onCreate(file);
      }
    },
  };

  const openMenu = (sticker: Sticker, event: MouseEvent): void => {
    const panel = panelRef.current?.getBoundingClientRect();
    if (panel === undefined) {
      return;
    }
    event.preventDefault();
    setMenu({
      sticker,
      x: Math.min(event.clientX - panel.left, panel.width - MENU_WIDTH_PX - 8),
      y: Math.min(event.clientY - panel.top, panel.height - MENU_HEIGHT_PX - 8),
    });
  };

  return (
    <div
      ref={panelRef}
      className="relative flex h-[448px] w-[368px] flex-col"
      onPointerDown={(event) => {
        if (menu !== null && !(event.target as Element).closest('[role="menu"]')) {
          setMenu(null);
        }
      }}
      {...drag}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <label htmlFor={searchId} className="sr-only">
          Search stickers
        </label>
        <Input
          id={searchId}
          value={query}
          placeholder="Search stickers"
          leadingIcon={<Search className="size-4" />}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="h-10 text-[14px]"
        />
        <IconButton
          label="Create a sticker"
          icon={<ImagePlus className="size-[18px]" />}
          onClick={() => {
            onCreate();
          }}
          className="border-outline-strong size-10 border"
        />
      </div>

      <div
        role="tablist"
        aria-label="Sticker sets"
        className="border-outline-variant flex gap-1 overflow-x-auto border-b px-3 pb-2"
      >
        {tabs.map((item) => {
          const isActive = !isSearching && item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setQuery('');
                onTab(item.id);
              }}
              className={cn(
                'font-label transition-tone h-[30px] shrink-0 rounded-full px-3 text-[13px] whitespace-nowrap',
                isActive
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={heading} className="min-h-0 flex-1 overflow-y-auto p-3">
        {(status === 'idle' || status === 'loading') && mine.length === 0 ? (
          <TileSkeletons />
        ) : status === 'error' && mine.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p role="alert" className="text-on-surface-variant text-[13px]">
              {error ?? 'Your stickers could not be loaded.'}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void ensureLoaded();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between px-1 pb-2">
              <span className="font-label text-outline text-[11px] tracking-[0.06em] uppercase">
                {heading}
              </span>
              {activeTab === 'mine' && !isSearching && mine.length > 0 && (
                <span className="text-outline text-[12px]">Drop a picture to make one</span>
              )}
            </div>

            {shown.length === 0 ? (
              <EmptyTab
                kind={isSearching ? 'search' : activeTab === 'recent' ? 'recent' : 'mine'}
                query={trimmed}
                onCreate={() => {
                  onCreate();
                }}
              />
            ) : (
              <ul className="grid grid-cols-4 gap-1">
                {activeTab === 'mine' && !isSearching && (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        onCreate();
                      }}
                      className="border-outline-strong text-on-surface-variant hover:border-primary-container hover:bg-primary-fixed hover:text-on-surface transition-tone font-label flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed text-[11px]"
                    >
                      <Plus aria-hidden className="size-5" />
                      Create
                    </button>
                  </li>
                )}
                {shown.map((sticker) => (
                  <li key={sticker.id}>
                    <StickerTile
                      sticker={sticker}
                      onSend={onSend}
                      onMenu={
                        mineIds.has(sticker.id)
                          ? (event) => {
                              openMenu(sticker, event);
                            }
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {isOver && (
        <div className="bg-primary-fixed border-primary-container animate-fade-in pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-xl border-[1.5px]">
          <span className="bg-primary-container text-on-primary-container flex size-13 items-center justify-center rounded-full">
            <ImagePlus aria-hidden className="size-6" />
          </span>
          <span className="font-heading text-h3 text-on-surface">Drop to make a sticker</span>
        </div>
      )}

      {menu !== null && (
        <StickerMenu
          at={menu}
          onSend={() => {
            setMenu(null);
            onSend(menu.sticker);
          }}
          onRename={() => {
            setMenu(null);
            onRename(menu.sticker);
          }}
          onDelete={() => {
            setMenu(null);
            onDelete(menu.sticker);
          }}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

interface StickerTileProps {
  sticker: Sticker;
  onSend: (sticker: Sticker) => void;
  /** Only your own stickers have a menu. */
  onMenu: ((event: MouseEvent) => void) | undefined;
}

/**
 * One sticker; a click sends it. Its link may lapse while the picker is open,
 * so a failed load asks the store for a fresh copy — once per tile.
 */
function StickerTile({ sticker, onSend, onMenu }: StickerTileProps) {
  const refresh = useStickersStore((state) => state.ensureLoaded);
  const hasRetried = useRef(false);
  const label = sticker.name === '' ? 'Sticker' : sticker.name;

  return (
    <button
      type="button"
      title={sticker.name === '' ? undefined : sticker.name}
      aria-label={`Send ${label}`}
      onClick={() => {
        onSend(sticker);
      }}
      onContextMenu={onMenu}
      className="hover:bg-surface-container-high transition-tone flex aspect-square w-full items-center justify-center rounded-xl active:scale-[0.94]"
    >
      <StickerArt
        image={sticker.image}
        background={sticker.background}
        size="tile"
        alt=""
        onError={() => {
          if (!hasRetried.current) {
            hasRetried.current = true;
            useStickersStore.setState({ loadedAt: null });
            void refresh();
          }
        }}
      />
    </button>
  );
}

const MENU_WIDTH_PX = 184;
const MENU_HEIGHT_PX = 132;

interface StickerMenuProps {
  at: MenuAt;
  onSend: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Right-click on one of your own: send, rename, delete. Arrow keys move, Escape closes. */
function StickerMenu({ at, onSend, onRename, onDelete, onClose }: StickerMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      // Only the menu: the picker it sits in stays open.
      event.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
      onClose();
    }
  };

  const itemClass =
    'hover:bg-surface-container focus-visible:bg-surface-container text-on-surface flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[14px] outline-none';
  const iconClass = 'text-on-surface-variant size-4';

  return (
    <div
      ref={listRef}
      role="menu"
      aria-label={at.sticker.name === '' ? 'Sticker' : at.sticker.name}
      onKeyDown={move}
      // Set through the CSSOM, which the CSP allows (unlike a style attribute
      // in markup); the pointer's spot cannot be a class.
      style={{ left: at.x, top: at.y }}
      className="bg-surface-container-lowest border-outline-strong shadow-floating absolute z-10 flex w-[184px] flex-col gap-0.5 rounded-xl border p-1.5"
    >
      <button type="button" role="menuitem" onClick={onSend} className={itemClass}>
        <Send aria-hidden className={iconClass} />
        Send
      </button>
      <button type="button" role="menuitem" onClick={onRename} className={itemClass}>
        <Pencil aria-hidden className={iconClass} />
        Rename
      </button>
      <div className="bg-outline-variant my-1 h-px" />
      <button type="button" role="menuitem" onClick={onDelete} className={itemClass}>
        <Trash2 aria-hidden className={iconClass} />
        Delete…
      </button>
    </div>
  );
}

/** Twelve grey squares where the grid will be, so it does not jump in. */
function TileSkeletons() {
  return (
    <div aria-busy aria-label="Loading stickers" className="grid grid-cols-4 gap-3 px-1 pt-7">
      {Array.from({ length: 12 }, (_, index) => (
        <span key={index} className="skeleton aspect-square rounded-xl" />
      ))}
    </div>
  );
}

interface EmptyTabProps {
  kind: 'search' | 'recent' | 'mine';
  query: string;
  onCreate: () => void;
}

function EmptyTab({ kind, query, onCreate }: EmptyTabProps) {
  const copy = {
    search: {
      title: `No stickers match “${query}”`,
      body: 'Try another word, or make your own.',
    },
    recent: {
      title: 'Nothing sent yet',
      body: 'Stickers you send show up here, so the favourites are one click away.',
    },
    mine: {
      title: 'Make your first sticker',
      body: 'Turn any photo into a sticker. Drop it here, paste it, or pick a file.',
    },
  }[kind];

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="bg-surface-container-high text-on-surface-variant mb-1 flex size-13 items-center justify-center rounded-full">
        {kind === 'search' ? (
          <Search aria-hidden className="size-6" />
        ) : (
          <StickerIcon aria-hidden className="size-6" />
        )}
      </span>
      <p className="font-heading text-h3 text-on-surface">{copy.title}</p>
      <p className="text-on-surface-variant text-[13px]">{copy.body}</p>
      {kind !== 'recent' && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onCreate}>
          Create a sticker
        </Button>
      )}
    </div>
  );
}

interface ManageDialogProps {
  sticker: Sticker;
  /** Closed, whether or not anything changed: back to the picker. */
  onDone: () => void;
}

function RenameStickerDialog({ sticker, onDone }: ManageDialogProps) {
  const rename = useStickersStore((state) => state.rename);
  const [name, setName] = useState(sticker.name);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const nameId = useId();

  const submit = async (): Promise<void> => {
    setIsSaving(true);
    const result = await rename(sticker.id, name.trim());
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
  };

  return (
    <Modal
      isOpen
      size="sm"
      onClose={onDone}
      title="Rename sticker"
      description="Only you see its name. It helps you find it in search."
      footer={
        <>
          <Button variant="ghost" onClick={onDone} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            isLoading={isSaving}
            onClick={() => {
              void submit();
            }}
          >
            Save name
          </Button>
        </>
      }
    >
      <form
        className="flex items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          // The dialog is portalled, but React still bubbles this submit up
          // the component tree — into the composer's own form, which sends.
          event.stopPropagation();
          void submit();
        }}
      >
        <StickerArt image={sticker.image} background={sticker.background} size="tile" alt="" />
        <label htmlFor={nameId} className="sr-only">
          Name
        </label>
        <Input
          id={nameId}
          value={name}
          maxLength={STICKER_NAME_MAX}
          placeholder="No name"
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </form>
      {error !== null && (
        <p role="alert" className="text-error text-[13px]">
          {error}
        </p>
      )}
    </Modal>
  );
}

function DeleteStickerDialog({ sticker, onDone }: ManageDialogProps) {
  const remove = useStickersStore((state) => state.remove);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <Modal
      isOpen
      size="sm"
      onClose={onDone}
      title="Delete this sticker?"
      description="It leaves My stickers. Messages that already have it keep showing it."
      footer={
        <>
          <Button variant="ghost" onClick={onDone} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isLoading={isDeleting}
            onClick={() => {
              setIsDeleting(true);
              void remove(sticker.id).then((result) => {
                setIsDeleting(false);
                if (result.ok) {
                  onDone();
                } else {
                  setError(result.error);
                }
              });
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="flex justify-center">
        <StickerArt image={sticker.image} background={sticker.background} size="message" alt="" />
      </div>
      {error !== null && (
        <p role="alert" className="text-error text-[13px]">
          {error}
        </p>
      )}
    </Modal>
  );
}
