# AUDIT_RULES.md — the contract

> This file exists because of a real, repeated failure pattern in this project.
> It is binding on any AI agent or developer doing review work here.
> Read it before any audit, review, or "let me check what's wrong" task.

---

## Why this file exists

For several months this project ran in a loop:

1. A bug appeared
2. A guard/layer was added on top to suppress it
3. The underlying cause was never removed
4. Later, an audit "discovered" the resulting complexity as a new problem
5. Back to step 1

The Ask pipeline accumulated **12 defensive layers** this way: SafetyNet,
DriftCap, Guard 1–4, Title Rescue, Intent Firewall, Out-of-Focus Fallback, and
three separate parse-error fallbacks.

Two things made the loop possible:

- **No written definition of "done".** Nothing could ever be finished, so every
  audit reopened everything.
- **No written record of why decisions were made.** A reviewer with no memory of
  the reasoning treats every past decision as suspicious — including its own.

The rules below are the mechanism that stops this. They are not aspirations.

---

## Rule 1 — Audit `main`. Verify branch state first.

Before reading a single line of code:

```bash
git branch --show-current
git rev-list --count main..HEAD    # how far ahead
git rev-list --count HEAD..main    # how far BEHIND  ← this is the one that bites
```

If the branch is behind `main`, **stop**. Switch to `main` or rebase first.

**Real incident (2026-08-28):** a full pipeline audit was run on `seo-work`,
which was 30 commits behind `main`. Two findings were reported as live bugs
that had already been fixed on `main`. This destroyed trust and wasted a
full session.

---

## Rule 2 — Three buckets. Never a flat list.

Every finding goes in exactly one bucket. The bucket determines what happens next.

### 🔴 BROKEN
A reproducible failure.

**Entry requirement:** you must be able to state the trigger and the wrong
result. If you cannot describe how to reproduce it, it is not BROKEN.

> Example: "Decider returns malformed JSON → `step4:210` sets
> `needsRetrieval: false` → student gets 'topic not in syllabus' for a valid
> question."

### 🟡 RISK
Works today. Will fail at a **named threshold**.

**Entry requirement:** the threshold must be a number.
"At 2,000 chunks", "at 500 concurrent users", "when OpenAI has an outage".
No number = not RISK.

### ⚪ OPINION
"I would design this differently."

**This is not a bug.** An OPINION may never be presented as a problem, may never
create urgency, and may never be proposed as work during an active stage.
It goes to `BACKLOG.md`.

---

## Rule 3 — Maximum 7 BROKEN per audit

If more than 7 are found, report the 7 highest-impact ones. The rest go to
`BACKLOG.md`.

**Why:** a list of 25 items reads as "the whole project is broken", regardless
of severity. That framing causes panic and paralysis. It is a communication
failure, not a thoroughness win.

---

## Rule 4 — No new layer without removing a cause

Any fix that **adds** a guard, wrapper, fallback, or override must **remove**
the cause it is guarding against.

The question to ask on every proposed fix:

> **"Which cause does this remove?"**

If the answer is "none, it just catches the symptom" — the fix is rejected.
Find the cause.

This is the rule that prevents layer 13.

---

## Rule 5 — Tests judge quality. Not opinions.

Once the golden set passes, the work is done. A reviewer's taste does not
reopen finished work.

If a future audit wants to claim something is wrong, it must first produce a
**failing test**. No failing test = not a problem.

---

## Rule 6 — Decisions are made, not offered

The owner of this project is explicitly a junior developer who asked for senior
architectural judgment. Handing back a menu of options pushes the decision onto
someone who said they cannot make it.

**Default:** state the decision, the reason, and the trade-off.

**Menu is allowed only for genuine business calls** — money, timeline, user
impact — where the owner holds information the agent does not.

---

## Rule 7 — Contradicting an ADR requires saying so out loud

If a finding contradicts a decision recorded in `docs/decisions/`, the finding
must open with:

> "This contradicts ADR-0XX. The new evidence is: ___"

An agent may not silently re-litigate a settled decision and present it as a
fresh discovery. This is the specific behaviour that made the owner lose trust.

---

## Rule 8 — Test a real merge before calling it risky

`git diff main..other` shows a file as "deleted" whenever the other branch
never touched it. That does not mean a merge would delete it.

Before you tell the owner a merge is risky, try it for real (clean working
tree first):

```bash
git merge --no-commit --no-ff <branch>
git status                 # read what would really change
git merge --abort
```

**Real incident (2026-08-28):** a raw diff made it look like the quiz system
would disappear. A real test merge showed the merge was safe, with only small
conflicts.

---

## Audit output template

```markdown
## Audit — <date>
Branch: main @ <sha>   |   Behind main: 0  ✅

### 🔴 BROKEN (max 7)
1. <what> — <file:line>
   Reproduce: <trigger → wrong result>
   Cause removed by fix: <which cause>

### 🟡 RISK
1. <what> — breaks at <number/threshold>

### ⚪ OPINION → BACKLOG.md
1. <what>

### ADR conflicts
- none / "Finding N contradicts ADR-00X because ___"
```
