# Backend endpoints for Feedback, Reports and Mute

The desktop app ships three features that currently run on sample data, because the API has no endpoints for them yet:

1. **Send feedback**: rate a feature 1–5 with an optional note (Settings → Send feedback).
2. **Report a post**: pick a reason, add optional details, and see the outcome later (post **⋯** menu, and Settings → Privacy & safety).
3. **Mute an account**: stop seeing someone's posts without blocking them (post **⋯** menu, and Settings → Privacy & safety).

This document is the contract the app is built against. When these endpoints exist, the app only changes two files: `src/features/feedback/api.ts` and `src/features/moderation/api.ts`. Neither the screens nor the stores change.

**Already exists, don't rebuild:** blocking. The app already calls `POST/DELETE /v1/users/{userId}/block` and `GET /v1/friends/blocked`. The "Also block" option in the report flow will use those.

---

## Conventions (same as the rest of `/v1`)

| | |
|---|---|
| Base | `/v1` on the Yello API |
| Auth | `Authorization: Bearer <access token>` on every endpoint below. The caller is always taken from the token, never from the body or query (OWASP A01). |
| Success body | `{ "success": true, "data": <payload>, "timestamp": "<ISO-8601>" }` |
| Error body | `{ "success": false, "code": "<API_CODE>", "message": "<safe text>", "fieldErrors": { "<field>": ["<msg>"] }, "path": "/v1/..." }` |
| Effect-only calls (delete, unmute) | **`204 No Content`, no body.** Please make this consistent: some existing deletes answer `200` with `data: null`, and that caused a bug where a removed friend stayed on screen. |
| Paging | Query `page` (0-based, max 1000) and `size` (1–50). The response `data` is `{ content, page, size, totalElements, totalPages, last }`. |
| Timestamps | ISO-8601 UTC strings (`2026-09-22T10:15:00Z`) |
| IDs | Strings, max 64 characters |

Common error codes the app already handles: `400 VALIDATION_FAILED` (with `fieldErrors`), `401` (the token refresh flow runs), `403 ACCESS_DENIED`, `404 NOT_FOUND`, `429 RATE_LIMITED`.

---

## 1. Feedback

### `POST /v1/feedback`

Sends feedback on one feature.

**Request**

```json
{
  "featureId": "messages",
  "rating": 2,
  "note": "Messages sometimes arrive out of order after waking from sleep.",
  "diagnostics": { "appVersion": "0.6.0", "platform": "linux" }
}
```

| Field | Type | Rules |
|---|---|---|
| `featureId` | string enum | One of `messages`, `stories`, `communities`, `showcase`, `compact-mode`, `in-app-updates`, `other`. Reject anything else, since this is an allowlist and not free text. |
| `rating` | integer | 1–5 |
| `note` | string | Optional, trimmed, max **500** characters. It may be empty. |
| `diagnostics` | object or `null` | Optional. `appVersion` max 32 characters, `platform` max 32 characters. Store only these two keys and ignore anything else. |

**Response `201`**

```json
{
  "success": true,
  "data": {
    "id": "fb_01J8Z6Q4N5",
    "featureId": "messages",
    "rating": 2,
    "note": "Messages sometimes arrive out of order after waking from sleep.",
    "createdAt": "2026-09-22T10:15:00Z"
  }
}
```

**Errors:** `400 VALIDATION_FAILED`, `429 RATE_LIMITED`

### `GET /v1/feedback/me?page=0&size=20`

The caller's own feedback, newest first. This fills the "Your recent feedback" list.

**Response `200`:** a page of the same object as above.

### Backend notes

- Rate limit per user, for example 10 submissions per hour (OWASP A06).
- Treat `note` as untrusted text. Escape it wherever it's shown, such as an admin dashboard (A05), and don't write it to logs (A09).
- A 1–2 star rating with a note is the most useful signal. It's worth an index on `(featureId, rating, createdAt)` for the team's dashboard.

---

## 2. Reports

### `POST /v1/posts/{postId}/reports`

Reports a post. Reports are **anonymous to the post's author**: never show the author who reported them.

**Request**

```json
{
  "reason": "SPAM",
  "details": "They've posted this in three communities today"
}
```

| Field | Type | Rules |
|---|---|---|
| `reason` | string enum | `SPAM`, `HARASSMENT`, `HATE`, `VIOLENCE`, `SEXUAL`, `MISINFORMATION`, `OTHER` |
| `details` | string | Optional, trimmed, max **300** characters |

**Response `201`**

```json
{
  "success": true,
  "data": {
    "id": "rp_01J8Z7A2KD",
    "postId": "8f3c…",
    "reason": "SPAM",
    "status": "UNDER_REVIEW",
    "createdAt": "2026-09-22T10:16:00Z"
  }
}
```

**Errors**

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad reason or details too long |
| 400 | `CANNOT_REPORT_OWN_POST` | The caller is the post's author |
| 404 | `NOT_FOUND` | The post doesn't exist **or the caller can't see it** (a friends-only or private post). Use the same answer for both, so it doesn't reveal that the post exists (A01). |
| 409 | `REPORT_ALREADY_EXISTS` | The caller already has an open report on this post. The app treats this as "already reported", not as a failure. |
| 429 | `RATE_LIMITED` | Too many reports, for example more than 20 per hour |

### `GET /v1/reports/me?page=0&size=20`

The caller's own reports and their outcomes, newest first. This fills Settings → Privacy & safety → "Your reports".

**Response `200`:** a page of:

```json
{
  "id": "rp_01J8Z7A2KD",
  "postId": "8f3c…",
  "reason": "SPAM",
  "status": "UNDER_REVIEW",
  "createdAt": "2026-09-22T10:16:00Z",
  "resolvedAt": null,
  "post": {
    "authorName": "Marcus Rell",
    "excerpt": "Crypto giveaway!! First 50 people who DM me their wallet seed phrase…"
  }
}
```

| Field | Notes |
|---|---|
| `status` | `UNDER_REVIEW`, `ACTION_TAKEN` (the post was removed) or `NO_VIOLATION` |
| `post` | A snapshot taken **when the report was made** (author display name, and the first 80 characters of the content). It stays readable after the post is removed. It may be `null`. |

### Reviewing reports (moderator side, needed so `status` ever changes)

The app doesn't call these, but without them every report stays `UNDER_REVIEW` forever.

- `GET /v1/admin/reports?status=UNDER_REVIEW&page=0&size=50`: the moderation queue, grouped or sorted by report count per post.
- `PATCH /v1/admin/reports/{reportId}` with `{ "status": "ACTION_TAKEN" | "NO_VIOLATION", "note": "<internal>" }`. Resolving should resolve **every** open report on the same post.

These must require a moderator role checked on the server (A01), and every decision should be written to an audit log with the moderator's id (A09).

### Live update when a report is resolved

The app has to show status changes as they happen, so when a report is resolved, send a notification to the reporter through the existing notify service:

| Field | Value |
|---|---|
| `type` | `REPORT_RESOLVED` (a new type: add it to the notification types) |
| `data` | `{ "reportId": "rp_…", "status": "ACTION_TAKEN" }` |
| Text | "We removed a post you reported" / "We reviewed a post you reported" |

When the app receives it, it re-reads `GET /v1/reports/me`. Don't include the post's author or content in the push itself.

---

## 3. Mute

Mute hides someone's posts from the caller's feed. Unlike a block, the other person can still message you and see your posts, and they're never told.

### `POST /v1/users/{userId}/mute`

**Response `204`** (no body). It's idempotent: muting someone already muted also answers `204`.

**Errors:** `400 CANNOT_MUTE_SELF`, `404 NOT_FOUND` (no such user)

### `DELETE /v1/users/{userId}/mute`

**Response `204`**. It's idempotent: unmuting someone who isn't muted also answers `204`.

### `GET /v1/users/me/muted?page=0&size=20`

**Response `200`:** a page of:

```json
{
  "user": { "id": "u_…", "username": "rithy", "fullName": "Rithy Chea", "avatarUrl": null },
  "since": "2026-09-10T08:00:00Z"
}
```

`user` uses the same author summary shape as everywhere else (`id`, `username`, `fullName`, `avatarUrl`).

### Backend notes

- **Filter muted authors out of `GET /v1/feed` on the server.** Today the app folds their posts down on the client. With server filtering, a muted account's posts never reach the client at all.
- A mute is private: it must never show up in the muted person's `friendStatus` or anywhere else they can read.

---

## 4. Hiding one post (optional)

"Hide this post" currently lives on this computer only and is forgotten on restart. To make it follow the account across devices:

- `POST /v1/posts/{postId}/hide` → `204`
- `DELETE /v1/posts/{postId}/hide` → `204`
- `GET /v1/feed` leaves out posts the caller has hidden.

This one is optional: the feature works without it.

---

## 5. Related fix for live updates: friendship removed

When someone removes a friend, declines a request or cancels one, the **other** person's app isn't told. It only catches up on its 30-second background refresh. Two small backend changes would make it instant:

1. Send a data-only notification with `type: "FRIENDSHIP_CHANGED"` and `data: { "userId": "<the other party>" }` to the other party when a friendship is removed, or a request is declined or cancelled. It doesn't need to appear in their notification inbox.
2. Answer `DELETE /v1/friends/{userId}` with **`204` and no body**, like the other effect-only calls.

---

## Summary checklist

| # | Method | Path | Returns | Priority |
|---|---|---|---|---|
| 1 | POST | `/v1/feedback` | 201 feedback | Required |
| 2 | GET | `/v1/feedback/me` | 200 page | Required |
| 3 | POST | `/v1/posts/{postId}/reports` | 201 report | Required |
| 4 | GET | `/v1/reports/me` | 200 page | Required |
| 5 | GET | `/v1/admin/reports` | 200 page | Required (moderators) |
| 6 | PATCH | `/v1/admin/reports/{reportId}` | 200 report | Required (moderators) |
| 7 | — | Notification `REPORT_RESOLVED` | push | Required for live updates |
| 8 | POST | `/v1/users/{userId}/mute` | 204 | Required |
| 9 | DELETE | `/v1/users/{userId}/mute` | 204 | Required |
| 10 | GET | `/v1/users/me/muted` | 200 page | Required |
| 11 | — | Feed leaves out muted authors | — | Required |
| 12 | POST/DELETE | `/v1/posts/{postId}/hide` | 204 | Optional |
| 13 | — | Notification `FRIENDSHIP_CHANGED` | push | Recommended |
| 14 | — | Make effect-only calls answer `204` | — | Recommended |
