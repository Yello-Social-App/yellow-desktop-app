# Backend endpoints for Stories

> **Status (2026-09-24): shipped, and the app is built on it.** This was the
> request sent to the backend before the endpoints existed. The live contract
> is the API's Swagger at `/docs` (`StoryController`), and it differs from this
> draft in a few places: errors are `RESOURCE_NOT_FOUND` / `RATE_LIMIT_EXCEEDED`,
> a non-image upload is `VALIDATION_FAILED` / `INVALID_IMAGE`, and a reply
> (`POST /v1/stories/{id}/replies`) becomes a DM whose message has
> `storyReply`. The client is in `electron/ipc/handlers/stories.handler.ts`
> and `src/features/stories/`.

The desktop app already has Stories on the home screen: the row of rings across the top, a full-screen viewer, and an "Add to your story" composer. It runs on sample data (`src/mocks/stories.ts`), and a story you add is forgotten on restart, because the API has no endpoints for it yet.

This document is the contract the app will be built against. It covers:

1. **Posting a story** as **text** (a line of text on a coloured backdrop) or as an **image** (a photo with an optional caption).
2. **24-hour expiry**: a story disappears for everyone else 24 hours after it's posted.
3. **Archive**: after it expires, the story stays in its owner's private archive (history) until they delete it.
4. **Seen state and viewers**: the ring greys out once you've watched someone's stories, and the owner can see who watched.

When these endpoints exist, the app adds a stories handler in `electron/api` + `electron/ipc`, and swaps the sample data in `src/features/stories/store.ts` for real calls. The viewer and composer screens keep their current shape. The composer gains a photo picker.

**Already exists, reuse it:** blocking (`/v1/users/{userId}/block`), muting (`/v1/users/{userId}/mute`), friends, and the author summary shape used on posts.

---

## Conventions (same as the rest of `/v1`)

| | |
|---|---|
| Base | `/v1` on the Yello API |
| Auth | `Authorization: Bearer <access token>` on every endpoint below. The owner is always the token's user, never a field in the body or query (OWASP A01). |
| Success body | `{ "success": true, "data": <payload>, "timestamp": "<ISO-8601>" }` |
| Error body | `{ "success": false, "code": "<API_CODE>", "message": "<safe text>", "fieldErrors": { "<field>": ["<msg>"] }, "path": "/v1/..." }` |
| Effect-only calls (delete, mark seen) | **`204 No Content`, no body.** |
| Paging | Query `page` (0-based, max 1000) and `size` (1–50). `data` is `{ content, page, size, totalElements, totalPages, last }`. |
| Timestamps | ISO-8601 UTC strings (`2026-09-23T10:15:00Z`) |
| IDs | Strings, max 64 characters |

Common error codes the app already handles: `400 VALIDATION_FAILED` (with `fieldErrors`), `401` (the token refresh flow runs), `403 ACCESS_DENIED`, `404 NOT_FOUND`, `413`, `429 RATE_LIMITED`.

---

## The `Story` object

Every endpoint below returns stories in this one shape. One `Story` is one slide. The app groups them by author into rings.

```json
{
  "id": "st_01J8ZB3M4Q",
  "author": { "id": "u_…", "username": "rithy", "fullName": "Rithy Chea", "avatarUrl": null },
  "type": "IMAGE",
  "text": "Meetup this Saturday 🎤",
  "background": null,
  "image": {
    "url": "https://media.yello.cachewraith.com/stories/…?X-Amz-Signature=…",
    "width": 1080,
    "height": 1920,
    "urlExpiresAt": "2026-09-23T10:30:00Z"
  },
  "visibility": "FRIENDS",
  "createdAt": "2026-09-23T10:15:00Z",
  "expiresAt": "2026-09-24T10:15:00Z",
  "isExpired": false,
  "isOwner": false,
  "isSeen": false,
  "viewCount": null
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `TEXT` \| `IMAGE` | |
| `text` | string or `null` | For `TEXT`, the story itself (required). For `IMAGE`, an optional caption. Max **140** characters, trimmed. |
| `background` | string or `null` | `TEXT` only. One of `cover-0` … `cover-7`. The app maps the key to a gradient, and the server stores the key only, never CSS or a colour value. `null` for `IMAGE`. |
| `image` | object or `null` | `IMAGE` only. `url` is a **short-lived signed URL** (see [Media](#media)). `width`/`height` are the stored image's pixel size, so the viewer can lay it out before it loads. |
| `visibility` | `FRIENDS` \| `PUBLIC` | Who may see it while it's active. Default `FRIENDS`. (No `PRIVATE`: a story only you can see is just the archive.) |
| `expiresAt` | timestamp | Always `createdAt + 24h`, **set by the server**. The client never sends it. |
| `isExpired` | boolean | `true` only in the owner's archive. Non-owners never receive an expired story. |
| `isOwner` | boolean | The server's word on authorship. |
| `isSeen` | boolean | Whether **the caller** has viewed this story. Always `true` on the caller's own stories. |
| `viewCount` | integer or `null` | The number of distinct viewers. **Only for the owner**, `null` for everyone else. |

---

## 1. Posting a story

### `POST /v1/stories`

Takes **JSON** for a text story and **multipart/form-data** for an image story, on the same path, like `PUT /v1/posts/{postId}` does today.

**Text story (JSON)**

```json
{
  "type": "TEXT",
  "text": "khtok v2 just hit 1k stars ⭐ thank you",
  "background": "cover-2",
  "visibility": "FRIENDS"
}
```

**Image story (multipart)**

| Part | Rules |
|---|---|
| `type` | `IMAGE` |
| `image` | Exactly **one** file. JPEG, PNG, WebP or GIF. Max **5 MB** (the same cap as post images). |
| `text` | Optional caption, max 140 characters |
| `visibility` | Optional, `FRIENDS` (default) or `PUBLIC` |

**Validation**

| Rule | Error |
|---|---|
| `type` is `TEXT` or `IMAGE`; anything else is rejected | `400 VALIDATION_FAILED` |
| `TEXT` needs non-blank `text` and a `background` from the allowlist | `400 VALIDATION_FAILED` |
| `IMAGE` needs exactly one `image` part; `background` is ignored | `400 VALIDATION_FAILED` |
| `text` over 140 characters | `400 VALIDATION_FAILED` |
| File over 5 MB | `413` (or `400` with `fieldErrors.image`) |
| File isn't really an image (see [Media](#media)) | `400 UNSUPPORTED_MEDIA` |
| Too many stories (see Backend notes) | `429 RATE_LIMITED` |

**Response `201`:** the created `Story`, with `isOwner: true`, `isSeen: true`, `viewCount: 0`.

---

## 2. Reading stories

### `GET /v1/stories/feed?page=0&size=20`

The row of rings on the home screen. It's a page of **author groups**, each holding that author's **active** stories.

```json
{
  "author": { "id": "u_…", "username": "rithy", "fullName": "Rithy Chea", "avatarUrl": null },
  "stories": [ /* Story, oldest first, so they play in the order posted */ ],
  "hasUnseen": true,
  "latestAt": "2026-09-23T10:15:00Z"
}
```

| Rule | |
|---|---|
| Who's in it | Friends' `FRIENDS` and `PUBLIC` stories. The caller's **own** stories are **not** in the feed (see `/v1/stories/me`). |
| Only active | `expiresAt > now()` at the time of the query. **Don't rely on a cleanup job for this:** filter in the query itself, so a story is gone at exactly 24h even if the job is late. |
| Left out | Authors the caller blocked or was blocked by (either direction), and authors the caller has muted. |
| Order | Groups with unseen stories first, then by `latestAt`, newest first. |
| Empty groups | Never returned. An author whose stories have all expired just drops out. |

### `GET /v1/stories/me`

The caller's own **active** stories, oldest first. This fills "Your story", the first ring. It's a plain array (at most 100 items, bounded by the rate limit), not a page. `viewCount` is filled in.

### `GET /v1/users/{userId}/stories`

One user's active stories, oldest first, for opening a ring from their profile. Same visibility rules as the feed.

**Errors:** `404 NOT_FOUND` when the user doesn't exist, **or** is blocked either way, **or** the caller can't see their stories. Give the same answer for all three so it doesn't reveal which (A01). An empty array is fine when the user exists and is visible but has no active stories.

### `GET /v1/stories/{storyId}`

One story, for a deep link.

- **Non-owner:** only while active and visible, otherwise `404 NOT_FOUND`. An expired story answers `404`, not a special "expired" code, so an outsider can't tell an expired story from one that never existed.
- **Owner:** always, including after it expires (`isExpired: true`).

---

## 3. Seen state and viewers

### `POST /v1/stories/{storyId}/view`

Marks the story as seen by the caller. The app calls this when a slide has finished playing or is skipped.

**Response `204`.** It's idempotent: the first view is stored, and repeats are no-ops (keep the first `viewedAt`).

- The owner viewing their own story is **not** recorded and doesn't count.
- If the story isn't active or visible to the caller: `404 NOT_FOUND`.

### `GET /v1/stories/{storyId}/viewers?page=0&size=50`

**Owner only.** Anyone else gets `404 NOT_FOUND`, not `403`, so the story's existence isn't confirmed (A01).

**Response `200`:** a page of:

```json
{
  "user": { "id": "u_…", "username": "sokha", "fullName": "Sokha Lim", "avatarUrl": null },
  "viewedAt": "2026-09-23T11:02:00Z"
}
```

Newest first. Leave out viewers the owner has since blocked.

**Retention:** keep the viewer list for **48 hours after the story was posted**, then delete the view rows and keep only the number in `viewCount`. So the archive shows "Seen by 23", not a permanent record of who watched what. This limits how much we hold about other people's behaviour (A04, data minimisation).

---

## 4. Archive (history)

Expired stories are **not deleted**. They move to the owner's archive, which only the owner can read. This isn't a copy: it's the same row, and "archived" just means `expiresAt <= now()`.

### `GET /v1/stories/archive?page=0&size=30`

The caller's own stories, **including expired ones**, newest first. The app groups them by day in Settings → Your activity → Story archive.

**Response `200`:** a page of `Story` with `isExpired` set for each.

Optional filters (nice to have):

| Query | Meaning |
|---|---|
| `from`, `to` | ISO dates, for jumping to a month |
| `type` | `TEXT` or `IMAGE` |

### `DELETE /v1/stories/{storyId}`

Owner only. It works on an active story (it vanishes for everyone at once) and on an archived one (it leaves the archive).

**Response `204`.** Non-owners get `404 NOT_FOUND`.

On delete, remove the **image object from storage** as well as the row, and delete its view rows. A delete must really delete (A04). Soft-deleting the row is fine for a short undo window, but the image file shouldn't outlive it by more than a day.

### Archive setting (optional)

Some people don't want an archive. If you add it:

- `GET /v1/users/me/story-settings` → `{ "archiveEnabled": true }`
- `PUT /v1/users/me/story-settings` with the same body → `200`

When `archiveEnabled` is `false`, the expiry job **deletes** expired stories and their images instead of keeping them. The default is `true`. Without this endpoint, everything is archived.

---

## Media

The image is the part where "expires in 24 hours" is easiest to get wrong. If the image sits at a permanent public URL, anyone who copied that URL can still open it after the story "expired".

**Storage and delivery**

- Store story images in a **private** bucket or path, never public-read.
- Hand out **signed URLs that expire after 15 minutes** (the same approach the chat service uses for attachments). Return `urlExpiresAt` with each one so the app knows when to re-fetch the story for a fresh URL.
- **Never sign a URL for an expired story to anyone but its owner.** Together with the 15-minute lifetime, this means a story's image stops working for other people within 15 minutes of expiry.
- Tell us the media **host** the URLs will use. The app only loads images from an allowlist of hosts (its content policy), so a new host needs one line in its config.

**Processing on upload**

- Check the file by its **content** (its magic bytes), not by the file name or the `Content-Type` the client sends, and then **re-encode** it (for example to WebP or JPEG). This throws away anything hidden in the file that isn't image data (A05, A08).
- **Strip all metadata**, especially EXIF **GPS location**. Phone photos often carry the exact place they were taken, and a story is shown to many people (A04).
- Downscale anything larger than, say, **1080 × 1920**, and reject absurd sizes (over 10,000 px on a side) before decoding. That stops "decompression bomb" files that are small on disk but huge in memory (A06).
- For GIFs: either keep them animated with a frame/size cap, or take the first frame. Tell us which, and the app will match.

---

## 5. Live updates (optional)

The app will re-read `/v1/stories/feed` when the window regains focus and on its normal 30-second background refresh, so nothing below is required.

For instant rings, send a **data-only** notification through the existing notify service when a friend posts their **first** active story (not every slide, to avoid spam):

| Field | Value |
|---|---|
| `type` | `STORY_POSTED` (new; add it to the notification types) |
| `data` | `{ "authorId": "u_…" }` |
| Inbox | Don't show it in the notification inbox. It's a refresh signal only. |

---

## Backend notes

- **Expiry is a query rule, not a job.** Every non-owner read filters on `expires_at > now()`. A scheduled job (hourly is fine) only does cleanup: it trims view rows older than 48h, and when the archive is off, it deletes expired stories and images.
- **Rate limit posting,** for example 100 stories per rolling 24 hours per user, plus a burst limit such as 10 per minute (A06).
- **Visibility is checked on the server** on every read, view and viewer-list call, from the token's user. Include friendship, both block directions, and mute (feed only). `visibility` changes nothing once a story has expired: only the owner can read it.
- **Don't log** story text or image URLs (signed URLs are credentials until they expire) (A09). Log `storyId`, the user id and the action.
- **Deleting an account** deletes all its stories, images and views, archive included.
- Suggested tables:
  - `stories(id, user_id, type, text, background, image_key, image_width, image_height, visibility, view_count, created_at, expires_at, deleted_at)` with an index on `(user_id, expires_at)` and on `(expires_at)`
  - `story_views(story_id, viewer_id, viewed_at)` with the primary key `(story_id, viewer_id)`, which makes `POST /view` idempotent for free

---

## Out of scope for now

- **Highlights** (pinning archived stories to your profile)
- **Replying to a story** in chat, and story reactions
- Video stories
- Close-friends lists

The app doesn't need any of these for the first version. We'll send a separate contract when we do.

---

## Summary checklist

| # | Method | Path | Returns | Priority |
|---|---|---|---|---|
| 1 | POST | `/v1/stories` (JSON or multipart) | 201 story | Required |
| 2 | GET | `/v1/stories/feed` | 200 page of author groups | Required |
| 3 | GET | `/v1/stories/me` | 200 story array | Required |
| 4 | GET | `/v1/users/{userId}/stories` | 200 story array | Required |
| 5 | GET | `/v1/stories/{storyId}` | 200 story | Required |
| 6 | POST | `/v1/stories/{storyId}/view` | 204 | Required |
| 7 | GET | `/v1/stories/{storyId}/viewers` | 200 page | Required |
| 8 | GET | `/v1/stories/archive` | 200 page | Required |
| 9 | DELETE | `/v1/stories/{storyId}` | 204 | Required |
| 10 | — | Private storage + 15-min signed URLs, none for expired stories | — | Required |
| 11 | — | Re-encode images and strip EXIF/GPS | — | Required |
| 12 | — | Cleanup job: trim views after 48h | — | Required |
| 13 | GET/PUT | `/v1/users/me/story-settings` | 200 | Optional |
| 14 | — | Notification `STORY_POSTED` (data-only) | push | Optional |
