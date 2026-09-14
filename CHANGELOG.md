# Changelog

All notable changes to the Yello desktop client are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Tracks the Yello API changes of 2026-09-11.

### Added

- **Resend code.** Both code screens — verifying a registration and resetting a
  password — offer "Resend code", backed by `POST /auth/resend-otp`. The button
  waits out the server's one-minute cooldown so it cannot be pressed into a
  silent no-op, and the confirmation is worded not to confirm the address.
- **Editing a post's photos.** The editor removes existing images (undoable
  until Save) and appends new ones through the same staging flow the composer
  uses; `PUT /posts/{id}` is sent as JSON unless there are files to add. The
  server's ten-image cap is what the picker is offered.
- **Who reacted.** The reaction count opens a dialog with a tab per reaction
  type (counts from `/summary`) and the people behind it, newest first, from
  the new `GET /reactions/{targetType}/{targetId}`. Each row carries the
  server's word on the viewer's friendship with that person, so it can offer
  Add friend / Accept / Friends without a call per row.

### Changed

- **Password reset is now email → code → new password.** `/forgot-password`
  emails a six-digit code; the same screen checks it; `/reset-password` takes
  only the new password. There is nothing to paste: the reset token the API
  mints for a correct code is held in the main process and spent there, so it
  never enters the renderer — the same rule the access token follows.
- **One reaction call.** `PUT` and `DELETE /reactions/…` are gone; the client
  sends `POST` with the type the button represents and the server adds, changes
  or removes. To clear a reaction the heart sends back whatever the viewer
  held, not always `LIKE`, since a different type would change it instead.
- **Comments arrive nested.** The list endpoint pages top-level comments newest
  first with their replies underneath, so a thread is never cut across pages.
  The store still holds a flat list; the page is flattened on load and a new
  top-level comment now leads rather than trails.
- Post cards read `isOwner` from the server to decide whether to show edit and
  delete, and author names everywhere use the `fullName` the API now sends on
  every author summary.

## [0.2.0] - 2026-09-07

The first tagged release, so this section covers the whole client rather than
only what changed since 0.1.0 — that version was never published.

Installers are attached to the release: `.AppImage` and `.deb` for Linux, `.dmg`
and `.zip` for macOS (Apple Silicon and Intel), and an `.exe` installer for
Windows. macOS and Windows builds are unsigned for now, so both will warn on
first launch.

### Added

- **Downloadable builds for every platform.** A tagged release now builds on
  Linux, macOS and Windows runners and attaches each platform's installers to
  the release. The release stays a draft until all three finish, so it is never
  downloadable while a platform is missing. This also gives `electron-updater` a
  feed: the app checks the same GitHub release it was built from.
- **Photo previews before posting.** Attaching now stages the images in the main
  process and shows a thumbnail tray in the composer, with per-photo removal, so
  a post is only published when you press Post. Previously the picker closing
  posted immediately, with no chance to look at what had been chosen.
- **Dialogs for the actions that need confirming.** Repost (with the quoted post
  visible while you write), delete, and share are modals built on the native
  `<dialog>` element — focus trapping, Esc and focus restore come from the
  platform. Share shows the link and copies it on request, rather than copying
  silently on click.
- **Comments.** A thread under every post: comment, reply (`parentCommentId`),
  react to a comment, and delete — the last allowed for the comment's author and
  the post's author, as the server permits.
- **Post actions.** Edit text and visibility, delete, quote-repost, and copy a
  share link. The link is fetched and written to the clipboard in the main
  process, so the renderer never chooses what gets copied and needs no clipboard
  permission.
- **Friends.** A `/friends` screen with the accepted list and the requests
  waiting on an answer, plus send/accept/decline/unfriend from anyone's profile.
  The sidebar badges how many requests are pending.
- **Other people's profiles** at `/users/:userId`, backed by `GET /users/{id}`
  and their timeline. Author names and avatars link to them from posts,
  comments, notifications and the friends list.
- **Single-post page** at `/posts/:postId`, where a repost notification lands.
- **Password recovery**: `/forgot-password` and `/reset-password`, wording the
  first so it cannot be read as confirming whether an address is registered.
- **Composer**: a visibility picker (public / friends / only me) and image
  attachment, both of which the create endpoint already accepted.
- **Reaction breakdown**: the reaction count expands into per-type counts, read
  fresh from the reaction summary endpoint.

### Fixed

- Liking a post from a profile timeline did nothing. Reactions were applied
  through the feed store, which does not hold profile posts; post mutations now
  take a sink naming the list they belong to.

### Removed

- The read-only `posts:share-link` IPC channel, superseded by the copy channel —
  `PostResponse` already carries a `shareUrl`, so a separate read had no caller.

- Electron + React shell built on the "Luminous Minimalist" design system
  extracted from Stitch project `5967079738026567667`.
- Live integration with the Yello API (`https://dev.yello-api.cachewraith.com`):
  login, registration with OTP verification, silent token refresh, the
  cursor-paginated feed, post creation and reactions.
- Frameless window with a custom 72px title bar, keychain-backed "remember me",
  route-level code splitting and a default-deny permission policy.
- Profile tab: banner-and-identity header, inline editing of display name,
  username and bio, avatar upload through the OS file picker, and the user's own
  paginated timeline.
- Messages screen, running on local sample data — the API has no messaging
  endpoints yet, and the screen says so.
- Full coverage of the Yello API: all 35 documented endpoints are now reachable
  through the main-process client and the preload bridge. New since the initial
  integration are password reset (`forgot-password`, `reset-password`), public
  user profiles, single-post read/edit/delete, reposts and share links, the
  whole comments surface, reactions on comments as well as posts plus the
  reaction summary, all six friendship routes, and all four notification routes.
- Post creation accepts images: up to ten, chosen through the OS picker in the
  main process so the renderer never names a path.

### Security

- All HTTP runs in the main process. The renderer never receives an access or
  refresh token, so an XSS payload has no credential to steal.
- Refresh tokens are persisted only through Electron `safeStorage` (OS keychain),
  never in `localStorage` or a plaintext file, and only when the user opts in.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on every
  window, plus `app.enableSandbox()`.
- Strict CSP in production: `default-src 'none'`, no `unsafe-inline`, no
  `unsafe-eval`. The API host is allowed for images only.
- IPC channels are allowlisted, the sender frame is validated on every call, and
  every payload crossing the boundary is parsed with zod in both directions.
- Every id that becomes a URL path segment is percent-encoded in one place
  (`electron/api/endpoints.ts`), and `targetType` is a closed enum, so a crafted
  id from the renderer cannot address a route of its choosing.
- Authorisation is never re-implemented client-side: post visibility, comment
  moderation rights and notification ownership are the server's decisions, and
  its `POST_NOT_VISIBLE` / `ACCESS_DENIED` / `404` answers pass straight through.
- Password-reset tokens and passwords are never logged, and `forgot-password`
  reports the same acknowledgement whether or not the address is registered.

## Release checklist

Run before cutting any release:

```sh
npm run lint          # zero errors, zero warnings
npm run typecheck     # tsc --noEmit
npm run audit:prod    # npm audit --omit=dev --audit-level=high
npm run build         # renderer + main bundles
npm run package       # electron-builder artifacts
```

`npm run audit:prod` is the gate that matters for shipped code: it audits only
the dependencies that end up inside the asar. Run the unfiltered `npm audit` as
well and triage anything it reports in the build toolchain. Electron and
electron-builder are pinned to exact versions — bump them deliberately, read the
release notes for security fixes, and re-run the checklist afterwards.
