# ADR-013: Minors' data handling for the public launch — one policy for all, consent at the point of entry, reasonable-effort baseline (not full DPDP age-verification)

- **Date:** 2026-11-02
- **Status:** Accepted

## Context

Zuno's users are Bihar Board Class 10 students — roughly 15 years old, i.e.
**minors**. The launch is **open public**: anyone can sign up or use guest mode,
and age is neither verified nor can be assumed.

Today Zuno collects, for a signed-in user, **name + email + full chat history**;
for a **guest**, only their questions + an anonymous guest id (`ADR-012`). There
is **no privacy policy and no terms page** (verified: no such route in
`frontend/src/App.jsx`). Student questions are sent to **OpenAI** (and, on an
embedding-provider outage, to **Google Gemini** as a query-time fallback) to
produce answers; data is stored in **MongoDB Atlas**; **Google OAuth** is a login
option; verification/reset mail goes via **Nodemailer/Gmail**; infra is
**Render / Vercel / Upstash**.

India's **DPDP Act 2023** has specific provisions for processing children's data
(verifiable parental consent; no tracking/targeting of children). Full compliance
for an open, age-unverified consumer product is a **substantial system**
(age-gating + verifiable parental consent). Separately, **Google OAuth
verification requires a published privacy-policy URL** — without it the app cannot
leave OAuth "testing" mode for real users.

This forces one decision now, before public launch — what data, what consent,
what retention, what deletion, and how minors are handled — written down so the
privacy policy, terms, and deletion path (Stage 1 **F1–F5**) all flow from a
single source.

> This is **not legal advice.** It is the recorded product/engineering decision
> and the accepted risk for the pilot.

## Decision

Ship a **reasonable-effort privacy baseline** for the pilot, **not** full DPDP
age-verification:

1. **Data minimization.** Collect only **email + name** for signed-in users;
   nothing from guests beyond their questions + an anonymous guest id. Future
   fields (**profile picture, mobile number, gender**, and possibly a few more)
   are *planned but not collected*. Each must update this ADR **and** the privacy
   policy **before** it goes live.
2. **One privacy policy + one terms of use, for everyone.** Minors are addressed
   by a **short section inside** the documents, **not** by branching users by age
   in code.
3. **Consent at the point of entry.**
   - **Signed-up users:** a single **required checkbox** at signup —
     *"I have read and agree to the Terms of Use and Privacy Policy"* — signup is
     **blocked** without it. The age/parent clause lives **inside the Terms text**
     (*"you confirm you are 18+, or a parent/guardian has reviewed and
     consented"*). **No separate "18+" checkbox** (a tick verifies nothing).
   - **Guests:** covered by the same policy; consent via a **visible notice** near
     the entry / ask bar (*"By using Zuno you agree to our Terms & Privacy
     Policy"*, with links), since a guest never reaches the signup checkbox.
4. **Third-party disclosure.** The policy names every processor that sees student
   data: **OpenAI** (answers), **Google** (OAuth login + Gemini embedding
   fallback), **MongoDB Atlas** (storage), the **email sender** (verification /
   reset), and **hosting/caching** (Render, Vercel, Upstash).
5. **Retention.** Signed-in data is kept **while the account is active**; after
   **6+ months of inactivity** it **may be deleted at any time thereafter**
   (manual; may take days or months). The wording matches reality — it is **not**
   an automated guarantee. Guest data is minimal/anonymous and tied to the guest
   session.
6. **Deletion.** **No in-app delete button.** A user requests erasure **by email**;
   it is performed **manually, directly in MongoDB**. **No app code** is added for
   this. Phase D (**F4**) produces a short **runbook** (the collections to clear +
   a ready query), *not* a feature. Access/correction is also on request by email.
7. **Commitments.** No advertising; no behavioural tracking/targeting of children;
   no third-party ad/analytics trackers; `localStorage` used only for session.
8. **Accepted risk.** No hard age verification and no verifiable parental-consent
   mechanism. The **residual DPDP risk is accepted for the small pilot.** A full
   age/consent system is **Stage 2+**.

## Why

- **Google OAuth is a hard gate.** The app cannot be published to real users
  without a privacy-policy URL, so **F5 depends on F1** — this is a technical
  blocker, not a nicety.
- **Data minimization is the strongest lever we control.** The less personal data
  held about age-unverified minors, the smaller every downstream risk — so the
  pilot holds the minimum (email + name) and defers the sensitive fields.
- **A self-declared "18+" checkbox verifies nothing** — anyone ticks it. Folding
  the age/parent clause into the Terms that the one checkbox already covers keeps
  the substance without a meaningless control.
- **Honest wording keeps policy and code aligned.** Promising a precise automatic
  deletion we have not built would be a false promise — exactly the symptom-level
  move `AUDIT_RULES.md` Rule 4 and this project's discipline forbid. Manual
  deletion described as manual is truthful and we can actually honour it.
- **One document for everyone is standard** and avoids building a
  user-differentiation system — and that system is the large Stage 2 work we are
  explicitly *not* doing now.
- **Guests must be covered.** They still send questions to OpenAI and have chat
  stored; because they give no name/email their footprint is small, and a visible
  entry notice is the proportionate consent point (they never hit the signup
  checkbox).

## Rejected alternatives

| Option | Why not |
|---|---|
| Full DPDP compliance now (age-gate + verifiable parental consent) before launch | A substantial system; blocks the pilot indefinitely. Stage 2+ work; a small cohort does not need it to start. |
| Skip the privacy policy / terms entirely (as some apps do) | Google OAuth won't publish without a privacy-policy URL; real legal exposure for a minor-facing product; no liability protection. "Others skip it" ignores their legal teams and risk budgets. |
| A separate "18+" confirmation checkbox | Verifies nothing — anyone ticks it. The age/parent clause belongs in the Terms the one checkbox already covers. |
| A privacy policy written as if no minors use Zuno (general-only) | Dishonest for a Class-10 product; a false policy harms more than it helps. |
| Build an automatic 6-month-inactivity deletion job now | Promises automation not yet built; owner wants no app code for this at pilot. Manual deletion + honest wording instead. |
| In-app "delete my account" button | More app code than the pilot needs; Stage 1 **F4** explicitly allows manual-via-email. |

## Consequences

**Easy now:**
- **F1/F2** (privacy + terms pages) and **F4** (deletion path) can be written
  straight from this one decision.
- **F5** (Google OAuth) is unblocked once the privacy-policy URL is live.
- Minimal personal data held → smallest risk surface; a manual deletion stays
  tractable because the footprint is small and the runbook lists every collection.

**Cost / hard:**
- **Not** full legal compliance; the residual DPDP risk is carried by the pilot
  and **must be revisited before any wider launch**.
- Deletion is **manual** — it depends on the owner actually running the query when
  a request arrives or for the inactivity sweep; at pilot volume this is accepted.
- Every new data field (pic / number / gender) or new third-party processor
  requires updating **this ADR + the privacy policy before it ships** — a standing
  obligation, easy to forget.

## Revisit when

- User volume grows beyond the small pilot, **or** Zuno onboards a group that is
  clearly all minors (e.g. a school / classroom) → move toward a real age-gate +
  verifiable parental consent (Stage 2), and reconsider automated retention/
  deletion.
- **Any** new personal-data field or third-party processor is added → update this
  ADR + the privacy policy first.
- A formal DPDP children's-data rule / notification is issued that requires more
  than this baseline.
