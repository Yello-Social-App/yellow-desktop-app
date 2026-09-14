# Yello — desktop client

An Electron + React desktop client for the Yello social API and its chat
service: a home feed you can post to, comments and replies, reactions, reposts,
friends and blocks, profiles, real-time direct and group messages, and account
creation with email verification.

Every endpoint the two services expose is reachable from the interface — see
[API coverage](#api-coverage).

The interface is a dark-first timeline layout — a slim frosted top bar, a
navigation rail, a centred column with hairline dividers, and a context rail —
with Yello yellow as its one accent. A light palette is available from
Settings; the tokens live in `src/styles/globals.css`.

## Installing it

Every tagged release carries installers for all three platforms — Linux
(`.AppImage`, `.deb`), macOS (`.dmg`, `.zip`; Apple Silicon and Intel) and
Windows (`.exe`) — on the
[releases page](https://github.com/hushstack/yellow-desktop-app/releases).

They are unsigned, so macOS Gatekeeper and Windows SmartScreen will both warn on
first launch until signing certificates are added to the release workflow.

## Running it from source

```sh
npm install
npm run dev        # Vite dev server + Electron, restarts main on change
```

Other scripts:

| Script                               | What it does                                           |
| ------------------------------------ | ------------------------------------------------------ |
| `npm run build`                      | Typecheck, build the renderer, bundle main and preload |
| `npm start`                          | Build, then run the packaged-path app (`app://bundle`) |
| `npm run package`                    | Build and produce installers with electron-builder     |
| `npm run lint` / `npm run typecheck` | The two gates the pre-commit hook runs                 |
| `npm run audit:prod`                 | Audit only the dependencies that ship                  |

### Pointing at a different API

The base URL is a **main-process** setting, not a `VITE_*` one. The known
servers are named in `API_TARGETS` in `electron/config.ts`:

| Target  | Server                              | Command                            |
| ------- | ----------------------------------- | ---------------------------------- |
| `prod`  | `https://api.yello.cachewraith.com` | `npm run dev` (default), `package` |
| `local` | `http://localhost:8080`             | `npm run dev:local`                |

Any other server can be given as a full URL, which wins over the target name:

```sh
YELLO_API_BASE_URL=https://staging.example.com npm run dev
```

The chat service (yello-chat) sits behind the same origin under `/ws` in every
deployment. Only a bare local run of the two services on different ports needs
`YELLO_CHAT_BASE_URL=http://localhost:3000`.

HTTPS is required unless the host is loopback. A packaged build bakes in the
target that was set when it was built (`YELLO_API_TARGET`), defaulting to `prod`.

### Signing in

There are no seeded accounts — this talks to the real service. Register in the
app, then enter the six-digit code emailed to you. The account stays
`PENDING_VERIFICATION` until that code is accepted. Note the API's password rule:
**12 characters minimum**.

## Why HTTP lives in the main process

Two reasons, and the second is the important one:

1. The API's CORS allowlist names browser origins only. A renderer request from
   `app://bundle` is refused before it leaves the machine — and the chat
   socket's origin allowlist would refuse it the same way, while a native
   client that sends no `Origin` is admitted.
2. Keeping the client in main means the renderer is never handed an access or
   refresh token. There is no IPC channel that returns one, so an XSS payload in
   the renderer has no credential to exfiltrate.

The renderer asks for _data_; the main process decides what a request needs.

## Architecture

```
electron/
  api/          HTTP client (both services), token store, endpoints, envelope
  chat/         the live WebSocket: auth, re-auth, reconnect, request/reply
  ipc/          channel allowlist, the guarded registrar, one handler per area
  security/     CSP, permission + navigation policy, trusted origins
src/
  features/     auth, feed, comments, friends, messages, profile, users
  routes/       auth, feed, friends, messages, profile, settings
  components/   ui/ (presentational only), layout/
shared/         ipc-types.ts — the main <-> renderer contract; logger.ts
```

### Real-time chat

The chat service (`/ws/*` over HTTP, `wss://…/ws` for live frames) is a
separate service with its own conventions — bare JSON, `{ code, message }`
errors, keyset paging — so `apiRequest` takes a `service` option that decides
the origin and the unwrapping, and everything else (auth, refresh, retry) is
shared.

The socket is owned by the main process (`electron/chat/socket.ts`): it
authenticates with the access token by sending an `auth` frame first, re-sends
one shortly before the token expires so a thread never blinks, reconnects with
backoff, and correlates `message.send` with its `message.sent` by `ref`. Frames
are parsed against `chatEventSchema` before being pushed to the renderer over
the one main → renderer channel (`chat:event`); the renderer parses them again.

Sends go over the socket when it is up and fall back to `POST …/messages` when
it is not; `clientId` is the idempotency key on both, so a retry after a
timeout yields the original message, not a duplicate. Chat rows carry user ids
only, so `src/features/users` resolves and caches them via `GET /users/{id}`.

### Where post actions live

A post card appears on three screens — the home feed, a profile timeline and a
post's own page — and each keeps its posts somewhere different: the feed in a
zustand store, the others in local state. So the mutations live in
`src/features/feed/post-actions.ts` and take a _sink_ saying where an updated,
deleted or new post should land. The card gets one set of buttons that work
wherever it is rendered, rather than a store the other two screens cannot use.

`shared/ipc-types.ts` is the single source of truth for the boundary. Every
payload has a zod schema, and both sides parse before they trust: the main
process validates requests because a renderer is untrusted, and the renderer
validates responses because a network payload is untrusted.

## Security posture

| Control                                                        | Where                                     |
| -------------------------------------------------------------- | ----------------------------------------- |
| `contextIsolation`, `sandbox`, no `nodeIntegration`            | `electron/main.ts`                        |
| Strict CSP, no `unsafe-inline` / `unsafe-eval`                 | `electron/security/csp.ts`                |
| Default-deny permissions, blocked navigation and popups        | `electron/security/permissions.ts`        |
| Allowlisted IPC channels + sender-frame validation             | `electron/ipc/channels.ts`, `register.ts` |
| Tokens in main-process memory; refresh token via `safeStorage` | `electron/api/token-store.ts`             |
| HTTPS enforced, one refresh-and-retry on 401                   | `electron/api/http-client.ts`             |
| Structured logging with key redaction                          | `shared/logger.ts`                        |

The renderer is served over a custom `app://bundle` scheme rather than `file://`,
which gives it a real origin for CSP and sender checks, and keeps asset
resolution inside the bundle directory.

## The profile tab

`/profile` is the signed-in user's own page: a banner strip, the avatar
overlapping it, display name, `@handle`, bio, joined date, post and friend
counts, then their timeline below. The API has no profile edit or avatar
upload, so nothing on it is editable.

Someone else's profile lives at `/users/:userId` and adds `GET /v1/users/{id}` —
which carries the viewer's `friendStatus` — plus the relationship controls
(add, cancel, accept/decline, unfriend, block/unblock) and a Message button.
Author names and avatars link to it from posts, comments and the friends list.

## Links in posts and comments

Web links (`http(s)://…`) in posts, comments and chat are clickable. The
renderer never navigates: an anchor opens with `target="_blank"`, and the
window-open handler in `electron/security/permissions.ts` turns that into
`shell.openExternal` for web URLs and refuses everything else.

A post's first link (when it carries no photos) and a comment's first link get
a preview card. `electron/links/unfurl.ts` reads the page's Open Graph tags —
or YouTube's oEmbed — from the main process, treating the fetch as the SSRF
risk it is: web URLs only, hosts must resolve to public addresses (checked
again on every redirect), bodies are capped and time-limited, and the image is
decoded and re-encoded by `nativeImage` into a small JPEG `data:` URL, so the
strict CSP `img-src` stays closed and the renderer never loads from an
arbitrary host. Answers are cached for an hour.

## Attaching photos to a post

Same two-step shape as the avatar, for the same reason plus one more: you should
see what you picked before it is published.

1. **Stage** — `feed:stage-images` opens the OS picker in main, validates each
   file, keeps the bytes there, and returns a token and a downscaled `data:`
   thumbnail per image. Nothing has been uploaded.
2. **Publish** — `feed:create-post` takes those tokens and attaches the original
   bytes to the multipart body.

Thumbnails are scaled to a 320px longest edge before they cross IPC: ten 5 MB
originals would otherwise be about 66 MB of base64 sent to be drawn at 96px.
The upload still carries the untouched file.

Removing a thumbnail, or leaving the page mid-draft, sends the tokens to
`feed:discard-images` so the bytes are freed. The staging map is hard-capped at
ten and **refuses** past it rather than evicting: everything in it is something
the composer is showing, so dropping the oldest would invalidate a photo the
user can still see attached and fail the post at publish time.

## API coverage

Every endpoint of the Yello API (`/v1`, 34) and the chat service (`/ws`, 6) is
wired through the main process and reachable from a screen.

| Area      | Endpoints                                                                                     | Where                                                                   |
| --------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Auth      | register, verify-otp, resend-otp, login, refresh, logout, forgot-password, reset-password     | `/login`, `/register`, `/verify`, `/forgot-password`, `/reset-password` |
| Users     | `GET /users/me`, `GET /users/{id}`, `GET /users/{id}/posts`, block / unblock                 | `/profile`, `/users/:userId`                                            |
| Posts     | create (text, visibility, images), get, update (incl. images), delete, repost                 | composer, post card, `/posts/:postId`                                   |
| Feed      | `GET /feed` (cursor-paged)                                                                    | `/feed`                                                                 |
| Comments  | create (incl. replies via `parentCommentId`), list (replies nested), update, delete           | the thread under a post card                                            |
| Reactions | toggle, summary, who-reacted — for both `POST` and `COMMENT` targets                          | like buttons; the reactions dialog                                      |
| Friends   | send, cancel, accept, decline, unfriend; friends, requests (received / sent), blocked          | `/friends`, the right rail, and the buttons on a profile                |
| Chat      | conversations (list, create, get), messages (history, send), read marker; live socket frames  | `/messages`, `/messages/:conversationId`, the right rail                |

A post's share link is the `shareUrl` on the post itself; copying it goes
through the main process, which re-reads the post so the clipboard only ever
receives a URL the server produced.

## Known gaps

- **No notifications.** The API has no notification endpoints; the sidebar
  counts requests waiting and unread messages instead.
- **Search is client-side**, over what is already loaded. The API has no search
  endpoint, so there is no way to find a user you have not seen in a post.
- **Virtualization**: the timeline is windowing-ready — uniform keyed rows, a
  fixed `FEED_ROW_HEIGHT_PX`, and `content-visibility` for off-screen rows — but
  does not use `react-window`. That library sets inline `style` attributes on
  every row, which the strict CSP rejects. Past `VIRTUALIZATION_THRESHOLD` rows,
  either add `style-src-attr 'unsafe-inline'` or use a windowing library that
  writes classes rather than inline styles.
