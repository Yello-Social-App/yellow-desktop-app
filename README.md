# Yello — desktop client

An Electron + React desktop client for the Yello social API: a home feed you can
post to, comments and replies, reactions, reposts, friends, notifications,
profiles you can browse and edit, and account creation with email verification.

Every endpoint the API exposes is reachable from the interface — see
[API coverage](#api-coverage).

The interface is built from the design system attached to Stitch project
`5967079738026567667` ("Luminous Minimalist"), and the tokens in
`src/styles/globals.css` are that system's values verbatim.

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

| Target  | Command                                       |
| ------- | --------------------------------------------- |
| `local` | `npm run dev:local`                           |
| `dev`   | `npm run dev` (default)                       |
| `prod`  | `npm run dev:prod`, or `npm run package:prod` |

Any other server can be given as a full URL, which wins over the target name:

```sh
YELLO_API_BASE_URL=https://staging.example.com npm run dev
```

HTTPS is required unless the host is loopback. A packaged build bakes in the
target that was set when it was built (`YELLO_API_TARGET`), defaulting to `dev`.

### Signing in

There are no seeded accounts — this talks to the real service. Register in the
app, then enter the six-digit code emailed to you. The account stays
`PENDING_VERIFICATION` until that code is accepted. Note the API's password rule:
**12 characters minimum**.

## Why HTTP lives in the main process

Two reasons, and the second is the important one:

1. The API's CORS allowlist is `http://localhost:3000`. A renderer request from
   `app://bundle` is refused before it leaves the machine.
2. Keeping the client in main means the renderer is never handed an access or
   refresh token. There is no IPC channel that returns one, so an XSS payload in
   the renderer has no credential to exfiltrate.

The renderer asks for _data_; the main process decides what a request needs.

## Architecture

```
electron/
  api/          HTTP client, token store, endpoints, response envelope
  ipc/          channel allowlist, the guarded registrar, one handler per area
  security/     CSP, permission + navigation policy, trusted origins
src/
  features/     auth, feed, comments, friends, notifications, profile
                (all API-backed); messages (local sample data)
  routes/       auth, feed, friends, messages, notifications, profile, settings
  components/   ui/ (presentational only), layout/
shared/         ipc-types.ts — the main <-> renderer contract; logger.ts
```

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

`/profile` is the signed-in user's own page, in the shape X and Substack use: a
banner strip, the avatar overlapping it, display name, `@handle`, bio, joined
date and post count, then their timeline below.

Everything on it is live:

| Action                           | Endpoint                       |
| -------------------------------- | ------------------------------ |
| Edit display name, username, bio | `PUT /api/v1/users/me`         |
| Change profile photo             | `PUT /api/v1/users/me/avatar`  |
| Own timeline, paged              | `GET /api/v1/users/{id}/posts` |

Someone else's profile lives at `/users/:userId` and adds `GET /api/v1/users/{id}`
plus the friendship controls. Author names and avatars link to it from posts,
comments, notifications and the friends list.

The edit form sends only the fields that actually changed, since every field on
that endpoint is optional.

**Avatar upload is driven from the main process.** The renderer cannot name a
file: it asks for an upload, and main opens the OS picker, reads the bytes and
checks type and size (JPEG/PNG/GIF, 5 MB cap) before anything is sent. A
renderer-supplied path never reaches the filesystem. WebP is rejected on
purpose — the server decodes uploads to validate them and the JVM has no WebP
decoder, so it would fail server-side anyway.

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

A successful edit writes the fresh profile back into the auth store, so the
sidebar, top bar and composer all repaint from one source.

## API coverage

All 36 endpoints are wired through the main process and reachable from a screen.

| Area          | Endpoints                                                                                 | Where                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Auth          | register, verify-otp, resend-otp, login, refresh, logout, forgot-password, reset-password | `/login`, `/register`, `/verify`, `/forgot-password`, `/reset-password` |
| Users         | `GET`/`PUT /users/me`, `PUT /users/me/avatar`, `GET /users/{id}`, `GET /users/{id}/posts` | `/profile`, `/users/:userId`                                            |
| Posts         | create (text, visibility, images), get, update (incl. images), delete, repost, share-link | composer, post card, `/posts/:postId`                                   |
| Feed          | `GET /feed` (cursor-paged)                                                                | `/feed`                                                                 |
| Comments      | create (incl. replies via `parentCommentId`), list (replies nested), delete               | the thread under a post card                                            |
| Reactions     | toggle, summary, who-reacted — for both `POST` and `COMMENT` targets                      | like buttons; the reactions dialog                                      |
| Friends       | send request, accept, decline, list, pending requests, unfriend                           | `/friends`, and the button on a profile                                 |
| Notifications | list (incl. `unreadOnly`), unread-count, mark read, mark all read                         | `/notifications`, sidebar badge                                         |

Two things the API cannot answer, and how the client copes:

- **Outgoing friend requests** are not listable, and there is no
  "relationship with user X" endpoint. A request sent in this session is
  remembered locally, and a `FRIENDSHIP_EXISTS` rejection is read as the same
  state — enough to keep the button honest, with the server still deciding.
- **A comment id cannot be resolved back to its post**, so a `COMMENT`
  notification stays on the notifications list rather than deep-linking. A
  `REPOST` notification does link, because its target is a post.

## Known gaps

- **Messages are sample data.** The API has no messaging endpoints; the screen
  is labelled accordingly.
- **Search is client-side**, over what is already loaded. The API has no search
  endpoint, so there is no way to find a user you have not seen in a post.
- **WebP avatars and post images are rejected** on purpose — the server decodes
  uploads to validate them and the JVM has no WebP decoder.
- **Virtualization**: the timeline is windowing-ready — uniform keyed rows, a
  fixed `FEED_ROW_HEIGHT_PX`, and `content-visibility` for off-screen rows — but
  does not use `react-window`. That library sets inline `style` attributes on
  every row, which the strict CSP rejects. Past `VIRTUALIZATION_THRESHOLD` rows,
  either add `style-src-attr 'unsafe-inline'` or use a windowing library that
  writes classes rather than inline styles.
