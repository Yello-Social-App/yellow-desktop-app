# Backend endpoints for chat stickers

> **Status (2026-09-28): built, and the app is built on it.** This was the
> request sent to the backend before the endpoints existed. The live contract
> is the chat service's Swagger at `/ws/docs`, and it differs from this draft
> in a few places: **background removal is switched off for now** (every draft
> answers `NO_SUBJECT`), errors use the service's fixed codes with the case in
> `details.reason`, `GET /ws/stickers/mine` pages with `limit`/`cursor`, ids are
> UUIDs, a non-member saving from a message gets `404`, and `sticker.*` events
> reach every one of the owner's sockets. The client is in
> `electron/ipc/handlers/stickers.handler.ts`, `src/features/stickers/` and
> `src/routes/messages/components/Sticker*.tsx`. The design is the "Chat
> stickers" mockup (https://claude.ai/artifact/G6G1xhX7PKc6eTJHtJSAn3).

The desktop app is adding stickers to chat:

1. **Picking a sticker.** A picker in the composer has three tabs: Recent, My stickers, and packs such as "Yello Buddy". Clicking a sticker sends it at once, as its own message, the way voice messages work.
2. **Making a sticker.** The user drops, browses or pastes a picture, chooses **Remove background** or **Keep background**, gives it an optional name, and then taps **Save** or **Save and send**.
3. **Keeping someone else's sticker.** Hovering a sticker a friend sent offers **Add to My stickers**.
4. **Managing stickers.** Right-clicking a sticker you made offers **Rename** and **Delete**.

Stickers belong to the **chat service** (`yello-chat`, mounted at `/ws`), because messages refer to them. Every path below uses that service.

**Search needs no endpoint.** A user has at most 200 stickers plus a few packs, so the app filters by name locally.

**Background removal runs on the server** in this draft, so desktop and mobile get the same result and the desktop build doesn't carry an ML model. If on-device removal is chosen instead, see [If removal runs on the device](#if-removal-runs-on-the-device).

---

## Conventions (same as the rest of `/ws`)

|                   |                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base              | `/ws` on the chat service                                                                                                                                |
| Auth              | `Authorization: Bearer <access token>` on every endpoint. The owner is always the token's user, never a field in the body or query (OWASP A01).          |
| Success body      | The payload, bare (no envelope)                                                                                                                          |
| Error body        | `{ "code": "<CODE>", "message": "<safe text>", "details": { … } }`                                                                                       |
| Effect-only calls | `204 No Content`                                                                                                                                         |
| Paging            | `page` (0-based) and `size` (1–100), like messages                                                                                                       |
| Timestamps        | ISO-8601 UTC                                                                                                                                             |
| IDs               | Strings, max 64 characters                                                                                                                               |
| Media URLs        | Short-lived signed URLs with `urlExpiresAt`, like chat attachments. **Pack** stickers are the exception: their URLs are public, immutable and cacheable. |

---

## The `Sticker` object

```json
{
  "id": "stk_01J8ZK2V7N",
  "packId": null,
  "name": "Mochi with his stick",
  "background": "REMOVED",
  "image": {
    "url": "https://media.yello.cachewraith.com/stickers/…?X-Amz-Signature=…",
    "width": 512,
    "height": 512,
    "urlExpiresAt": "2026-09-28T11:15:00Z"
  },
  "isMine": true,
  "createdAt": "2026-09-28T10:15:00Z"
}
```

| Field        | Type                | Notes                                                                                                                                                                                 |
| ------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packId`     | string or `null`    | Set for pack stickers, `null` for stickers users made                                                                                                                                 |
| `name`       | string              | Max **40** characters, trimmed. It can be empty. The app searches on it.                                                                                                              |
| `background` | `REMOVED` \| `KEPT` | `REMOVED` is a transparent cut-out with a white outline built into the image. `KEPT` is the whole picture cropped to a square; the app draws the rounded corners and the white frame. |
| `image`      | object              | Always a **512 × 512 WebP**. `REMOVED` has an alpha channel.                                                                                                                          |
| `isMine`     | boolean             | `true` when the sticker is in the caller's library, so the app knows whether to offer "Add to My stickers"                                                                            |

---

## 1. Making a sticker

This takes two calls. The first uploads the picture and returns **both** versions. The app can then switch between Remove and Keep instantly without re-uploading, and the slow step (removal) runs only once.

### `POST /ws/stickers/drafts` (multipart)

| Part    | Rules                                                                                 |
| ------- | ------------------------------------------------------------------------------------- |
| `image` | Exactly one file. **PNG, JPEG or WebP**, max **5 MB**, max **4096 px** on either side |

**Response `201`**

```json
{
  "draftId": "drf_01J8ZK1…",
  "original": { "url": "…", "width": 512, "height": 512, "urlExpiresAt": "…" },
  "cutout": { "url": "…", "width": 512, "height": 512, "urlExpiresAt": "…" },
  "cutoutStatus": "READY",
  "expiresAt": "2026-09-28T11:15:00Z"
}
```

| Field          | Notes                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `original`     | The `KEPT` version: the picture cropped to a centred square and scaled to 512                                                                                                                 |
| `cutout`       | The `REMOVED` version, or `null` when `cutoutStatus` is `NO_SUBJECT`                                                                                                                          |
| `cutoutStatus` | `READY` or `NO_SUBJECT`. **`NO_SUBJECT` is not an error.** The draft is still valid and can be saved as `KEPT`. The app shows "There's no clear subject to cut out, so the background stays." |
| `expiresAt`    | Drafts live **1 hour**, and nothing unsaved is kept after that                                                                                                                                |

**Processing (server side)**

- Check the **magic bytes**, not the extension or `Content-Type`. Refuse anything that doesn't decode as one of the three formats.
- Refuse images over 4096 px on a side or 16 megapixels in total **before** fully decoding them, to guard against decompression bombs.
- **Strip all metadata** (EXIF, GPS, XMP). People will upload phone photos of their pets and homes (A04).
- Re-encode from the decoded pixels and never store the uploaded bytes. Only the re-encoded output is served.
- Run the removal model with a time limit (for example 10 s). A timeout or model failure returns `NO_SUBJECT`, never `500`. The user can still make a `KEPT` sticker (A10).
- Target **p95 under 3 s** so the "Removing background…" state stays short. If it's slower, move to a `202` + socket event (`sticker.draft.ready`) instead. The app can handle that change.

**Errors**

| Case                                    | Response                                              |
| --------------------------------------- | ----------------------------------------------------- |
| No `image` part, or more than one       | `400 VALIDATION_FAILED`                               |
| Not a PNG, JPEG or WebP                 | `415 UNSUPPORTED_MEDIA` ("That file isn't a picture") |
| Over 5 MB                               | `413 PAYLOAD_TOO_LARGE` ("That picture is over 5 MB") |
| Over 4096 px or 16 MP                   | `400 VALIDATION_FAILED`, `details.image`              |
| Too many drafts (see [Limits](#limits)) | `429 RATE_LIMITED` with `Retry-After`                 |

### `POST /ws/stickers`

Turns a draft into a sticker in the caller's library.

```json
{ "draftId": "drf_01J8ZK1…", "background": "REMOVED", "name": "Mochi with his stick" }
```

| Rule                                                      | Error                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The draft must belong to the caller and not be expired    | `404 DRAFT_NOT_FOUND` (the same error for "not yours" and "expired", so drafts can't be probed) |
| `background` is `REMOVED` or `KEPT`                       | `400 VALIDATION_FAILED`                                                                         |
| `REMOVED` when the draft's `cutoutStatus` is `NO_SUBJECT` | `409 NO_SUBJECT`                                                                                |
| `name` up to 40 characters; optional, defaults to `""`    | `400 VALIDATION_FAILED`                                                                         |
| The library already holds 200 stickers                    | `409 STICKER_LIMIT_REACHED`                                                                     |

**Response `201`:** the `Sticker`. A draft can be saved **once**; a second save returns `404 DRAFT_NOT_FOUND`.

**"Save and send"** is two calls from the app: this one, then `message.send` with the new `stickerId`. They are kept separate so that a failed send never loses the sticker.

---

## 2. Reading stickers

### `GET /ws/stickers/mine?page=0&size=100`

The **My stickers** tab. Returns the caller's library, newest first, as a page of `Sticker`. Signed URLs are fresh on every call, so an expired URL is fixed by fetching the list again.

### `GET /ws/sticker-packs`

The pack tabs. There are only a few packs, so this returns all of them with their stickers and no paging.

```json
[
  {
    "id": "pack_yello_buddy",
    "name": "Yello Buddy",
    "thumbnailUrl": "https://cdn.yello…/packs/yello-buddy/hi.webp",
    "stickers": [/* Sticker, in pack order */]
  }
]
```

Send an `ETag` header, and answer `304` to `If-None-Match`. Packs rarely change, and the app caches them.

### `GET /ws/stickers/recent?size=24`

The **Recent** tab, newest first, with no duplicates, as a `Sticker[]`. The server updates the list whenever the caller sends a sticker, so Recent follows the user across devices. A sticker that was deleted, or whose pack was withdrawn, drops out.

_If this is too much work for the first release, the app can keep Recent locally on each device. Say so, and the endpoint can come later._

---

## 3. Managing stickers

### `PATCH /ws/stickers/{stickerId}`

```json
{ "name": "Mochi, proud" }
```

Only for stickers in the caller's library. Returns the updated `Sticker`. If the sticker isn't in the library, or is a pack sticker, the answer is `404 STICKER_NOT_FOUND`.

### `DELETE /ws/stickers/{stickerId}`

Removes the sticker from the caller's library and returns `204`. **Messages already sent keep showing it.** Keep the image while any message still refers to it, the same way attachments are kept. If the sticker isn't in the library, the answer is `404 STICKER_NOT_FOUND`.

### `POST /ws/conversations/{conversationId}/messages/{messageId}/sticker/save`

**Add to My stickers** for a sticker someone else sent. It goes through the message, not the sticker ID, so the server authorizes it with the rule chat already has: the caller must be a member of the conversation (A01).

| Rule                                                 | Error                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The caller is a member of the conversation           | `403 ACCESS_DENIED`                                                                            |
| The message exists, has a sticker, and isn't deleted | `404 NOT_FOUND`                                                                                |
| The sticker comes from a pack                        | `409 ALREADY_AVAILABLE` (packs are always in the picker)                                       |
| The sticker is already in the library                | `200` with the existing `Sticker`, which is idempotent; the app shows "Already in My stickers" |
| The library already holds 200 stickers               | `409 STICKER_LIMIT_REACHED`                                                                    |

**Response `201`:** the `Sticker` with `isMine: true`. This points to the same stored image and doesn't copy it. The saved sticker's `name` is `""`, because the other person's name for it isn't shared.

---

## 4. Sending a sticker

Nothing new. `stickerId` is added to the two send routes that exist today:

- socket `message.send` → `message.sent`
- `POST /ws/conversations/{conversationId}/messages` (the HTTP fallback)

```json
{ "clientId": "c_…", "body": "", "stickerId": "stk_01J8ZK2V7N", "replyToMessageId": "msg_…" }
```

| Rule                                                                                                                      | Error                   |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| With `stickerId`, `body` must be empty and `attachmentIds` absent. A sticker is its own message, like a voice note.       | `400 VALIDATION_FAILED` |
| The sticker must be in the **caller's** library or in a pack. A guessed ID of another user's sticker must not work (A01). | `404 STICKER_NOT_FOUND` |
| `replyToMessageId` is allowed                                                                                             | —                       |
| `clientId` stays the idempotency key                                                                                      | —                       |

### Message shape

`ChatMessage` gains one field, `null` on every other message and on tombstones (as `storyReply` is):

```json
"sticker": {
  "id": "stk_01J8ZK2V7N",
  "packId": null,
  "background": "REMOVED",
  "image": { "url": "…", "width": 512, "height": 512, "urlExpiresAt": "…" }
}
```

- `name` is **not** included, because it's private to the owner.
- `message.new` over the socket carries the new field automatically.
- The conversation list's `lastMessage` needs a way to say "Sent a sticker". Add `hasSticker: true` to it, next to the fields it has today.
- An expired URL is refreshed by fetching the message again (`GET /ws/conversations/{id}/messages/{messageId}`), as for attachments.
- Reactions, replies, unsend and reporting work on sticker messages as on any other message. **Edit** is refused (`400`), because there's no text to edit.

---

## 5. Socket events (multi-device)

So that a sticker made on the phone appears in the desktop picker without a reload, send these to the **caller's other sessions** only:

| Event             | `data`                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| `sticker.added`   | `{ sticker: Sticker }`, sent after `POST /ws/stickers` or a save from a message |
| `sticker.updated` | `{ sticker: Sticker }`, sent after a rename                                     |
| `sticker.removed` | `{ stickerId }`, sent after a delete                                            |

---

## Limits

| What                    | Limit                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Stickers in one library | 200                                                                   |
| Upload                  | 5 MB; PNG, JPEG or WebP; 4096 px per side and 16 MP in total          |
| Drafts                  | 30 per user per hour (removal is CPU/GPU heavy, A06); 1-hour lifetime |
| Saved stickers          | Share the 200 cap                                                     |
| Name                    | 40 characters                                                         |

---

## Security checklist (OWASP Top 10:2025)

| ID  | What it means here                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | The owner always comes from the token. The server checks `stickerId` on send against the caller's library or a pack. Save-from-message checks conversation membership. `404` is the same for "not yours" and "doesn't exist". |
| A03 | Pin and patch the image decoder (libvips, Pillow or ImageMagick all have a long CVE history) and the removal model runtime. Load the model from your own storage, never download it at runtime.                               |
| A04 | Strip EXIF/GPS. Serve user stickers from signed, short-lived URLs.                                                                                                                                                            |
| A05 | Never pass the file name or `name` into a shell command or an image-tool argument string.                                                                                                                                     |
| A06 | Rate-limit drafts and cap the library. Decode in an isolated worker with memory and time limits.                                                                                                                              |
| A09 | Log the sticker ID, sizes and durations, never the image bytes, file names or sticker names.                                                                                                                                  |
| A10 | A removal failure or timeout means `NO_SUBJECT`, and the draft stays usable. The server never fails open on validation.                                                                                                       |

---

## If removal runs on the device

If the team chooses on-device removal (an ONNX model in the Electron app instead), **section 1 changes and nothing else does:**

- Drop `POST /ws/stickers/drafts`.
- `POST /ws/stickers` becomes **multipart**: `image` (the final PNG, already cut out or cropped by the app), `background` and `name`. The server still checks the magic bytes, strips metadata, re-encodes to 512 × 512 WebP and applies the same limits. It must **not** trust that a `REMOVED` image is really transparent.

The trade-off: the app grows by the size of the model and needs no network for the preview. Mobile has to ship its own model. Also check the model's licence: some popular background-removal packages are AGPL.

---

## What the desktop app changes once these exist

- `electron/api/endpoints.ts`: `chat.stickers`, `chat.stickerDrafts`, `chat.stickerPacks`, `chat.stickersRecent`, `chat.sticker(id)`, `chat.saveMessageSticker(cid, mid)`.
- `shared/ipc-types.ts`: a `stickerSchema`, the `sticker` field on `chatMessageSchema`, and `stickerId` on the send request.
- `electron/ipc/handlers/chat.handler.ts`: handlers for the calls above. The draft upload reads the file in the main process, as attachments do today, so the renderer never names a path.
- `src/routes/messages/components/`: `StickerPicker`, `CreateStickerDialog`, and a sticker branch in `MessageBubble`.
