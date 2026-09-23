# Changelog

All notable changes to the Yello desktop client are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-09-24

Stories are real now: post text or photos, reply from the viewer, and see a
ring on anyone who has one. Settings is redesigned, with new appearance
controls.

### Added

- **Stories are live.** The rings on Home show your friends' real stories,
  and what you post is kept, instead of being sample data that disappeared
  when you restarted. A ring starts at the first story you haven't watched,
  and turns grey once you've seen them all.
- **Photo stories.** Add to your story with a photo and an optional caption,
  as well as with text on a backdrop. Choose whether your friends or everyone
  can see it.
- **Reply to a story.** Replying from the viewer sends a direct message, which
  shows a small preview of the story in the chat. The preview reads "Story
  unavailable" once the story has expired or been deleted.
- **Seen by.** Your own stories show how many people watched them, and who.
  You can delete one from the viewer.
- **Story archive.** Settings → Story archive lists every story you've posted,
  including expired ones, which only you can see.
- **Story rings everywhere.** Anyone with a story you can watch has a ring
  around their profile photo across the app: posts, comments, chats, friends,
  search and notifications. Click the ring on their profile to watch.
- **Appearance settings.** Choose an accent colour, compact or comfortable
  spacing, text size, whether the activity sidebar shows, and reduced motion,
  with a live preview. Reset to defaults puts them all back.
- **Find a setting.** Settings has a search box that finds the pane holding a
  control.
- **Jump to latest.** Scrolled up in a chat, a button takes you back to the
  newest message and counts what arrived meanwhile.

### Changed

- **Settings redesign.** Settings is grouped into Preferences, Account, Your
  activity and About, and uses the full window width like Messages.
- **Unblocking asks first.** Unblock buttons confirm before acting, since
  unblocking lets the person see your profile and message you again.

### Fixed

- Switching chats kept the previous scroll position instead of opening on the
  newest message, and late-loading images could push it out of view.

## [0.8.0] - 2026-09-23

Save posts to read later, change your password from Settings, and see clearly
when a chat or profile is blocked.

### Added

- **Save posts.** Every post has a bookmark button. Saved posts are private:
  the author isn't told, and nobody else can see your list.
- **Saved.** A new Saved item in the sidebar lists what you've saved, most
  recent first. Removing a save there takes the post off the list straight
  away.
- **Change password.** Settings → Change password asks for your current
  password, emails you a 6-digit code, then sets the new one. You stay signed
  in on this device; every other device and browser is signed out and needs
  the new password.

### Changed

- **Blocked chats.** In a chat with someone you blocked, the message box is
  replaced by "You blocked {name}" with an Unblock button, and their online
  status and typing indicator are hidden. If a message can't be delivered
  because the other person isn't accepting it, the chat says "You can't reply
  to this conversation".
- **Blocked profiles.** The profile of someone you blocked shows only their
  photo, name and username, with a note that you blocked them and an Unblock
  button. Their cover, bio and posts are hidden.

### Fixed

- Opening the profile of someone you blocked showed "That profile could not be
  loaded". A profile you can't view now says "This account isn't available".
- After unblocking someone, their profile loads again without having to leave
  and come back.

## [0.7.0] - 2026-09-23

Send feedback, report posts, and mute or hide what you'd rather not see, all
saved to your Yello account. Settings is split into panes, and a removed
friend now disappears from the list straight away.

### Added

- **Send feedback.** Settings → Send feedback lets you rate a feature from 1
  to 5, answer a short follow-up question and add a note of up to 500
  characters. You can choose to include the app version and OS. Your recent
  feedback is listed under the form.
- **Report a post.** The "…" menu on someone else's post has Report post:
  pick a reason, add details if you like, and confirm. When you close the
  dialog you can also hide the post or block its author. Reporting a post
  twice just shows it as already reported. When a report is resolved you get
  a notification that opens Privacy & safety.
- **Mute and hide.** The same menu has Hide this post, Mute and Copy link.
  Hidden, reported and muted posts collapse to a single line with a Show post
  button. What you hide or mute is saved to your account, so it applies
  wherever you sign in.
- **Privacy & safety.** Lists your muted accounts, your blocked accounts and
  the status of your reports, with unmute and unblock.

### Changed

- **Settings has panes.** Appearance, Notifications, Privacy & safety,
  Updates and Send feedback each get their own pane. Account and Security are
  now under Privacy & safety, and About is under Updates.
- Every screen except Messages now uses the Home feed's column width, so the
  layout stays put as you move between screens.

### Fixed

- Removing a friend takes them off the list straight away. Before, they stayed
  until you restarted.
- When someone else removes you, or declines or cancels a request, your friend
  lists catch up within about 30 seconds. They also refresh when you open
  Friends or come back to the window.

## [0.6.0] - 2026-09-22

Chat grows up — replies, edits, unsend, reactions, files, group management and
invites, with desktop chat alerts — Home gets a new frame with a compact mode,
and Yello can now check for and install its own updates from Settings.

### Added

- **Reply, edit, unsend and react in chat.** Hover a message to reply (the
  quote jumps to the original), edit your own, unsend it for everyone (it
  stays as "Message deleted"), or react with an emoji. One reaction per person
  per message; tapping yours again removes it. Up in an empty message box
  edits your last message.
- **Files in chat.** Attach up to 10 files of up to 10 MB each with the
  paperclip, by pasting an image, or by dragging files in from another window.
  Photos show in the conversation and open full size; other files have a Save
  button that asks where to put them.
- **Groups.** Group details (the ⓘ in a group's header) rename the group, set
  or remove its photo, list members with owner and admin badges, promote and
  demote admins, remove members, add friends directly or send them an invite,
  and leave. Invites arrive as a card in your direct messages with Join and
  Decline.
- **Chat alerts on the desktop.** A system notification for a new message
  while Yello is in the background — one per conversation, taken down if the
  message is unsent — and for the first reaction to one of your messages.
  Settings → Notifications has a Chat section to turn either off.
- **Updates from Settings.** Settings → Updates has "Check now" and
  "Update now", which downloads the new version, checks it, installs it over
  the current one and restarts — nothing is uninstalled, so settings and
  sign-ins are kept. "Check for updates automatically" is on by default and
  never downloads without the click.
  - Windows (`.exe`) and Linux AppImage update without a password.
  - Linux `.deb`, `.rpm` and `.pacman` ask for your password in the desktop's
    own prompt. That needs a polkit agent, which GNOME, KDE, Cinnamon, XFCE
    and MATE run; on Hyprland, sway or i3 start one (`hyprpolkitagent`,
    `polkit-gnome`) or keep using `yello-desktop-app update`.
  - A Microsoft Store install is told when a newer version is out; the Store
    delivers it after Microsoft's review.
- **Compact layout.** The panel button beside the logo switches between the
  labelled sidebars and a compact frame: an icon rail with tooltips, one side
  panel with a Chats / Trending switch, and more room for the feed. The choice
  is remembered.
- `/` jumps to search from anywhere that is not a text field.

### Changed

- **A new frame.** A calmer neutral palette with hairline dividers and one
  yellow accent. The navigation rail is grouped, marks waiting messages,
  notifications and requests with a dot, and keeps your account at its foot.
  The right rail is now your profile card with friends, requests and unread in
  one line, your recent chats, and trending projects.
- **Home.** The feed fills the space between the rails, the composer is one
  row with a Public / Friends / Only me chip, posts show the author and time in
  a header with Edit and Delete under "…", times read "11m" or "3d" (hover for
  the full time), and new stories wear a yellow ring.
- The right rail no longer lists friend requests, requests you sent or popular
  communities. Requests are a number that opens Friends, where they are
  answered.

### Fixed

- The feed no longer shows an old comment count after someone else comments
  or replies. It catches up when you open a post, when you come back to the
  feed or the window, and when a notification about the post arrives.

### Upgrading

- Windows `.exe` users on 0.5.0 install the 0.6.0 installer over the old one
  once; from then on, Settings → Updates does it. Linux users run
  `yello-desktop-app update` once (or install the 0.6.0 package over the old
  one) for the same reason.

## [0.5.0] - 2026-09-19

Communities, the showcase and people search now run on the API, you can edit
your own profile, and Linux installs update themselves with
`yello-desktop-app update`.

### Added

- **Communities, for real.** The directory, community pages, joining and
  leaving, posting and voting now run against the API instead of sample data.
  Discover and Joined search by name, slug or tag on the server and page with
  "Show more"; post lists page by cursor and sort by Hot, New or Top on the
  front page and inside each community. Home's Communities tab shows posts from
  the communities you joined. Only members can start a thread — the composer
  offers to join first — and a vote shows instantly, then settles to the
  server's score.
- **Showcase, for real.** The grid, the featured strip, the tech filter chips,
  project pages, likes and publishing are backed by the API. Opening a project
  counts one view per session. GitHub stars are hidden until the server has
  checked the repository, rather than shown as zero.
- The right rail's popular communities and trending projects come from the
  API, and joining from the rail replaces the card with the next suggestion.
- **People search, for real.** The top bar and the Friends screen search
  everyone by name or @username on the server, in its relevance order, with
  "Show more". Picking someone in the top bar opens their profile, and every
  result carries working friend controls. Search starts at two characters.
- **Edit your profile.** "Edit profile" on your own profile changes your
  photo, cover image, username, name and bio. Only what you changed is sent,
  so an untouched username does not spend the once-a-week change. Profiles now
  show their cover image.
- **`yello-desktop-app update` on Linux.** An app installed from the `.deb`,
  `.rpm` or `.pacman` package upgrades itself from a terminal: it downloads the
  latest release for the same format, checks it against the release's
  checksum, and installs it over the old version with the distribution's own
  tool under `sudo`. Nothing is uninstalled first, and settings and saved
  sign-ins stay. An AppImage updates the same way, without a password.
- A Microsoft Store package is built on release, for publishing Yello through
  the Store. A Store install carries Microsoft's signature, so Windows shows no
  SmartScreen warning, and the Store keeps it updated.

### Changed

- Project links must be `https://`. The form says so as you type, and a link
  from the server that is not https is not drawn as a link at all.
- The "online" count on communities is hidden: the service does not track
  presence yet.
- Settings → About no longer shows the API address, and the renderer is no
  longer told it.

### Fixed

- Switching conversations no longer replays the page animation on the whole
  Messages screen; only the new thread's messages fade in.
- The message box stays pinned at the bottom of the thread instead of
  scrolling away with a long conversation.
- A repost's quoted post opens the original when clicked, and its author and
  time are links.
- The account switcher no longer keeps showing a photo or name that was
  removed from the account.

## [0.4.0] - 2026-09-16

Adds the notification inbox and switching between accounts, and gives link
previews a card everywhere a link can appear.

### Added

- **Notifications.** The inbox from yello-notify: a bell in the top bar with
  an unread count and a panel of recent activity, a full Notifications screen
  with All and Unread tabs and cursor paging, and a count on the nav rail.
  Rows can be opened (which acknowledges them and follows the link), marked
  read individually or all at once, and dismissed. Clicking a row goes to the
  post, comment thread, profile or conversation it is about; a row whose type
  this build does not recognise still renders from the server's own wording,
  it just does not navigate.
- **Desktop alerts.** A native OS notification when something arrives while
  Yello is in the background, plus a count on the taskbar or dock icon.
  Clicking the alert brings the window back and opens what it is about.
  Notifications are delivered over FCM, which a desktop client cannot
  receive, so the main process polls the inbox instead — often while the
  window has focus, rarely while it does not, and immediately when focus
  returns.
- **Notification preferences.** Settings → Notifications turns desktop alerts
  off entirely or per activity type. A muted type stops the alert only: the
  row still arrives in the inbox and still counts as unread, which is how the
  service defines a mute, and the wording says so.
- **Switching between accounts.** The identity block at the foot of the nav
  rail lists the accounts this device remembers and moves between them in one
  click without a password. "Add another account" signs in alongside the
  current session; "Sign out" falls through to another remembered account
  when there is one. Up to five accounts are kept, and only those signed in
  with "Remember me" — the others deliberately leave no credential behind.
  Removing an account erases its stored credential immediately.
- **Link previews everywhere.** Chat messages, community posts and showcase
  project pages now draw the same preview card the feed does. The card in a
  quoted repost grew from a small side thumbnail to a full-width image, and
  the repost composer shows the quoted post's link instead of dropping it.

### Changed

- Link preview cards come in three sizes chosen by where they sit, rather
  than one compact flag: a thumbnail beside the text in comments and chat, a
  2:1 image above it in quoted reposts and community posts, and a 1.91:1
  image on a post's own card. GitHub keeps the side-by-side treatment at
  every size, because its card image reads badly enlarged.
- Opening the notification panel or screen always asks the server, rather
  than showing what the first fetch of the session found.

### Fixed

- A malformed timestamp anywhere — in a post, comment, message, friend row or
  notification — blanked that whole screen with "Something went wrong".
  `Intl` throws on an invalid date rather than returning something unusable,
  and these are formatted during render. Unreadable times now show as a dash
  and the screen survives.
- One unexpected field in one notification no longer empties the entire
  inbox: rows are parsed individually and only the bad one is dropped.

### Security

- Remembered accounts are stored in one vault encrypted through the OS
  keychain (`safeStorage`), written owner-only, and never reachable from the
  renderer — no IPC channel returns a token. Holding several refresh tokens
  rather than one widens what a single compromised vault would expose, so the
  list is capped at five, only accounts the user opted into are stored, and
  signing out erases that account's token rather than letting it age out.
- Switching proves the target account's token against the server before
  ending the current session, so an expired saved session cannot sign the
  user out of the account they were already using.
- A successful switch restarts the renderer, so no store can carry one
  account's posts or direct messages into another's session.
- Deep links from a notification are built through an allowlist: the value
  must be a recognised key for that notification type and must look like an
  id before it becomes a route.
- Failed responses log the field names that failed validation, never the
  values.

## [0.3.0] - 2026-09-15

Moves to the live deployment at `api.yello.cachewraith.com`, adds real-time
chat, redesigns the interface, and previews three surfaces the API does not
serve yet. Also carries the 2026-09-11 API changes that were merged after
0.2.0 (listed under their own headings below).

### Added

- **Real-time chat.** Direct and group conversations on the yello-chat
  service: history, sending, read receipts (✓/✓✓ from the participants'
  markers), typing indicators and presence over a WebSocket owned by the
  main process, with an HTTP fallback for sends keyed by `clientId` so a
  retry cannot duplicate. Start a chat from a profile, a friend row, the
  right rail, or the "New message" picker (one friend = direct, several =
  group). A "Live" indicator in the top bar shows the socket's state.
- **Friends, fully.** Cancel a sent request, see requests you sent, block and
  unblock, and a Blocked list — every route addressed by the other user's id
  as the API now models it. A profile's buttons read the server's own
  `friendStatus`.
- **Comment editing** (`PUT /comments/{id}`), by the author.
- **Clickable links** in posts, comments and chat, opening in the system
  browser. The first link on a post (without photos), on a comment, and in a
  quoted original gets a **preview card** — GitHub, YouTube (via oEmbed) and
  any page with Open Graph tags — unfurled in the main process with SSRF
  guards, and the thumbnail re-encoded to a small JPEG so the CSP stays
  closed.
- **Six reactions.** Hovering the heart opens a strip of 👍 ❤️ 😄 😮 😢 😠 on
  posts and comments; the button shows what you chose.
- **Light theme.** Settings → Appearance: dark (default), light, or system.
- **Communities, Showcase and Stories** (preview). Reddit-style communities
  with votes and per-community pages; a KhmerCoder-style project showcase
  with a featured strip, filters, detail pages and a submit form; Instagram-
  style stories with a viewer that grows out of the tapped ring and shrinks
  back into it. These have no API yet: they run on sample data and keep what
  you do in memory for the session, and each carries a "Preview" chip.
- **Linux packages for every family**: `.rpm` (Fedora, openSUSE, RHEL) and
  `.pacman` (Arch, Manjaro) join `.deb` and `.AppImage`.
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

- **Live server.** The app targets `https://api.yello.cachewraith.com`
  (`prod`, the default) or `http://localhost:8080` (`local`); the `dev`
  target and the `dev:prod`/`package:prod` scripts are gone. Every REST path
  is under `/v1`. Set `YELLO_CHAT_BASE_URL` only when running the two
  services on different local ports.
- **Redesigned interface.** Dark-first palette with Yello yellow as the one
  accent, pill controls, a 56px frosted top bar, an icon navigation rail with
  count badges, a centred column of spaced post cards, a stories row and a
  "For you | Communities" tab on Home, and a right rail (your counts, friend
  requests with inline accept/decline, friends online, recent chats, popular
  communities, trending projects). On Messages the column widens into the
  rail's slot with a transition rather than swapping frames.
- **WebP** is accepted for post images; the server decodes it.
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

### Removed

- **Notifications**, **profile editing** and **avatar upload**: the live API
  has no routes for them (`/notifications`, `PUT /users/me`,
  `PUT /users/me/avatar` all answer 404). The sidebar badges now count
  unread messages and friend requests instead. Profile details are set at
  sign-up.
- The sample chat data; conversations are real.

### Fixed

- Multipart image keys are the server's `images[]` / `removeImageIds[]`, so
  uploads are read as lists.
- The share link is the post's own `shareUrl`; the removed `share-link`
  route is no longer called.
- Link preview cards in comments and quoted reposts render at their full
  width (a bare `max-w-md` resolved to the 16px spacing token).

### Security

- The chat socket authenticates by sending the access token as the first
  frame over `wss://`, never in the URL; the token never enters the renderer.
  Frames are parsed against a schema in the main process before being pushed
  and parsed again on arrival.
- Link unfurling is treated as SSRF: web URLs only, hosts must resolve to
  public addresses (re-checked on every redirect), bodies capped and
  time-limited, and the image decoded and re-encoded by `nativeImage`
  before it reaches the page. Unfurling from the client means a linked site
  sees the reader's IP, as a browser visit would; no cookies are sent.
- External links open only over `http(s)`; every other scheme is refused.

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
