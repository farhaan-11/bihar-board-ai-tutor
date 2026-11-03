# Zuno — Data Deletion Runbook (operator-only)

**Last updated: 3 November 2026**

> **This is an internal ops document, not a student-facing page.** It is the
> manual procedure that backs the promise in the Privacy Policy: *"Jab chaaho,
> email karke apna data delete karwa sakte ho."* (Stage 1 checklist **F4**.)
>
> **Chhota matlab (Hinglish):** Jab koi student email karke apna data delete
> karne ko kahe, uske paas sirf **email** hoga. Us email se hum uska account
> dhoondhte hain, uski `_id` nikaalte hain, aur ussi id/email se saari jagah ka
> data mitate hain — **pehle gin ke, phir mita ke, phir dubara gin ke** taaki
> koi galti na ho aur sirf usi student ka data jaaye.

> ⚠️ **DANGER — yeh PRODUCTION database (`zuno_prod`) par chalta hai.** Delete
> wapas nahi aata. Har kadam soch ke, dekh ke chalao. Niche ka order mat badlo.

---

## 0. Before you touch anything

1. **Identity.** The deletion request **must come from the same email address**
   that is being deleted (the sender/reply-to matches). We never delete an
   account on someone else's say-so. If it arrives from a different address,
   reply and ask them to send it from the account's own email.

2. **Backup.** A MongoDB Atlas backup exists (Stage 1 G2). For extra safety, you
   can dump just this one user's documents before deleting, so a mistake is
   reversible:
   ```bash
   mongodump --uri "<MONGODB_URI>" --db zuno_prod \
     --collection users --query '{ "email": "<lowercased-email>" }' \
     --out ./backup-before-delete
   ```
   (Optional for the pilot; the re-count in Step 5 is the real safety net.)

3. **Connect.** Use the `MONGODB_URI` from `backend/.env` with `mongosh`:
   ```bash
   mongosh "<MONGODB_URI>"
   ```
   Confirm you are on the right DB — `db` should print **`zuno_prod`**
   (run `use zuno_prod` if not).

---

## 1. Which data belongs to a student (the map)

Verified against the models on 2026-11-03. A student's data lives in **8**
collections. Two others (`chunks`, `questions`) are syllabus/quiz **content** —
never touch them.

| Collection | Keyed by | Type of the key field |
|---|---|---|
| `users` | `_id` (and `email`) | `_id` = ObjectId · `email` = String |
| `chat_sessions` | `userId` | **String** (hex of the user `_id`) |
| `chat_history` | `sessionId` (authoritative), `userId` | both **String** |
| `chapter_progress` | `userId` | **String** |
| `quiz_attempts` | `userId` | **String** |
| `quiz_sessions` | `userId` | **String** (also auto-expires via TTL) |
| `study_events` | `userId` | **String** |
| `support_requests` | `email` (we use this), `userId` | `email` = String · `userId` = **ObjectId** |

**Two traps this map encodes — do not forget them:**

- **`userId` is not the same type everywhere.** In 6 collections it is a
  **String** (the hex form of the user's `_id`, e.g. `"650abc..."`). In
  `support_requests` it is an **ObjectId**. So we key the 6 by the string `uid`,
  and we key `support_requests` by **email** (always present, and the thing we
  actually have) — which sidesteps the type mismatch entirely.
- **`chat_history` is deleted by its session ids, not only `userId`.** Its
  `userId` field is "for analytics later" and may not be reliably populated;
  `sessionId` is the required, unique, authoritative link. We delete by both, to
  be safe.

---

## 2. Step 1 — Confirm the key type (READ-ONLY, run once)

Before the first real deletion ever, confirm the 6 collections really store
`userId` as a **String**. This reads one row per collection and deletes nothing.

```js
["chat_sessions","chat_history","chapter_progress",
 "quiz_attempts","quiz_sessions","study_events"].forEach(c => {
  const d = db[c].findOne({ userId: { $ne: null } });
  print(c + ": " + (d ? typeof d.userId + "  e.g. " + d.userId
                       : "— no rows with a userId yet"));
});
```

**Expected:** every line prints `string`.

- If any line prints `object` → that collection stores an **ObjectId**, and its
  delete below must use `ObjectId(uid)` instead of the plain string. **Stop and
  flag it** before deleting.
- *(Side note, not a deletion concern: if `chapter_progress` prints `string`, the
  `user_chapter_unique` index — which filters on `$type: 'objectId'` — is a
  separate, already-parked issue. It does not affect this runbook.)*

---

## 3. Step 2 — Find the student and lock the id

Paste the student's email as a **literal string** (never build the query by
string-joining untrusted text).

```js
// Normalise exactly how it is stored (lowercase + trimmed).
const email = "RAW_EMAIL_HERE".trim().toLowerCase();

const user = db.users.findOne({ email });
printjson(user);              // EYEBALL THIS: right name? right email? right created date?
```

- `null` → no account with that email. It may be a guest (no email on record —
  see §6) or a typo. Reply to the student; do not proceed.
- Found → the id we key everything off:

```js
const uid = user._id.toString();   // string form, for the 6 string-keyed collections
// user._id (ObjectId) is used only for the users + support_requests steps
```

---

## 4. Step 3 — COUNT first (dry run — deletes nothing)

Gather the user's session ids, then count every collection. **Sanity-check the
numbers** — they should look like one student's footprint (a handful to a few
hundred), never tens of thousands. A wild number means the key is wrong — stop.

```js
const sessionIds = db.chat_sessions.find({ userId: uid })
                     .toArray().map(s => s.sessionId);

print("chat_sessions    : " + db.chat_sessions.countDocuments({ userId: uid }));
print("chat_history     : " + db.chat_history.countDocuments(
        { $or: [ { userId: uid }, { sessionId: { $in: sessionIds } } ] }));
print("chapter_progress : " + db.chapter_progress.countDocuments({ userId: uid }));
print("quiz_attempts    : " + db.quiz_attempts.countDocuments({ userId: uid }));
print("quiz_sessions    : " + db.quiz_sessions.countDocuments({ userId: uid }));
print("study_events     : " + db.study_events.countDocuments({ userId: uid }));
print("support_requests : " + db.support_requests.countDocuments({ email }));
print("users            : " + db.users.countDocuments({ _id: user._id }));
```

---

## 5. Step 4 — Delete (children first, the user LAST)

Deleting the `users` row last means that if anything interrupts the run, you can
still re-find the account by email and re-run the rest.

```js
db.chat_history.deleteMany(
  { $or: [ { userId: uid }, { sessionId: { $in: sessionIds } } ] });
db.chat_sessions.deleteMany({ userId: uid });
db.chapter_progress.deleteMany({ userId: uid });
db.quiz_attempts.deleteMany({ userId: uid });
db.quiz_sessions.deleteMany({ userId: uid });
db.study_events.deleteMany({ userId: uid });
db.support_requests.deleteMany({ email });

db.users.deleteOne({ _id: user._id });   // LAST
```

---

## 6. Step 5 — Re-count (this is the guarantee)

Run the **exact same counts from Step 3 again.** Every single one must now be
**0**.

```js
print("chat_sessions    : " + db.chat_sessions.countDocuments({ userId: uid }));
print("chat_history     : " + db.chat_history.countDocuments(
        { $or: [ { userId: uid }, { sessionId: { $in: sessionIds } } ] }));
print("chapter_progress : " + db.chapter_progress.countDocuments({ userId: uid }));
print("quiz_attempts    : " + db.quiz_attempts.countDocuments({ userId: uid }));
print("quiz_sessions    : " + db.quiz_sessions.countDocuments({ userId: uid }));
print("study_events     : " + db.study_events.countDocuments({ userId: uid }));
print("support_requests : " + db.support_requests.countDocuments({ email }));
print("users            : " + db.users.countDocuments({ _id: user._id }));
```

Any non-zero line → something was missed (most likely a key-type mismatch on
that one collection — recheck §2). Do not tell the student "done" until every
line reads 0.

Then reply to the student confirming their account and data have been deleted.

---

## 7. Edge cases, stated honestly

- **Guest-only data cannot be located by email.** Someone who never created an
  account exists only under a random `guestId`, with no name or email anywhere.
  There is no way to tie an incoming email to that `guestId`, so this runbook
  cannot reach pure-guest data. (Guest `quiz_sessions` also expire on their own
  via TTL.) When a guest logs in, their guest sessions are claimed onto their
  account (`guestId` nulled, `userId` set), so from then on that data **is**
  reachable by the normal flow above.
  *If you ever need to delete a known guest and you have their `guestId`:* swap
  every `{ userId: uid }` for `{ guestId: "<token>" }`, key `support_requests`
  by `guestId` too, and skip the `users` step (a guest has no `users` row).

- **The support email may differ from the account email.** `support_requests`
  stores whatever email the student typed into the form, which can differ from
  their login email. The flow above deletes support rows matching the **account**
  email; if the student mentions they used a different email in support, delete
  those by that email as well.

- **Not atomic.** The deletes are separate statements, not one transaction. For
  pilot scale that is fine — the Step 5 re-count is what proves completeness.

---

## 8. Scope

Manual, operator-run, via support email — exactly what F4 requires for launch.
A self-serve "Delete my account" button in the app is **out of scope** for
Stage 1 and is parked in `BACKLOG.md`.
