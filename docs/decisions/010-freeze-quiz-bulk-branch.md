# ADR-010: Freeze `quiz-phase0.5-bulk`, do not merge

- **Date:** 2026-08-28
- **Status:** Accepted

## Context
`quiz-phase0.5-bulk` is a 28-commit branch holding a 7-stage pipeline (Stage A–G)
that extracted, built, and verified quiz questions from 18 real Bihar Board
PYQ papers spanning 2016–2026. It carries 499 data files — raw per-year
extraction, an answer-verification cache, and a 30-question golden set — and
reached 98.5% L3+ quality on its own review pass.

It was initially assumed to hold content that never reached `main` — a
significant amount of unshipped work.

## Investigation (2026-08-28)
A byte-for-byte diff of the finished output file,
`data/quiz-bank/bank/questions.json`, was run between `main` and
`quiz-phase0.5-bulk`:

```
git diff main quiz-phase0.5-bulk -- data/quiz-bank/bank/questions.json
→ 0 lines different — the files are identical, 1,126 questions on both sides
```

**The finished output of this pipeline already reached `main`** — it was carried
forward via `quiz-phase1` (`2d51287 feat(quiz): bring bulk question bank onto
quiz-phase1`), which was merged in the normal quiz feature line.

A real three-way test merge (`--no-commit --no-ff`, discarded after inspection)
confirmed:
- No conflict on the question bank data
- Only two conflicts: `backend/package.json` (differing npm script names —
  trivially compatible) and `docs/quiz/QUIZ_BUILD_LOG.md` (a running log both branches
  appended to differently)
- The quiz engine (`backend/src/services/quiz/`) and this project's docs
  survive the merge untouched, because the branch never modified them

## Decision
**Do not merge `quiz-phase0.5-bulk`.** Push it to GitHub (`origin`) as a backup
and leave it there, untouched. No content is at risk — the deliverable is
already on `main`.

## Additional finding (2026-08-28)
This branch had **never been pushed to GitHub** — it existed only on the local
development machine, with no remote tracking branch at all. The deliverable
(the 1,126-question bank) was safe on `main`, but the entire 28-commit pipeline
— 499 files of real, hard-won extraction and verification work — had a single
point of failure: that one machine's disk.

It has now been pushed: `git push -u origin quiz-phase0.5-bulk`. It remains
frozen and unmerged, but is no longer at risk of being lost.

## Why
- Merging would add 499 intermediate/scratch files to the working tree for
  zero product benefit right now
- The branch's value is as an **audit trail and rebuild toolkit** — useful if a
  larger question bank is needed later, not useful today
- Stage 1's goal is a stable launch with the existing 1,126-question bank;
  expanding the bank is explicitly Stage 3 scope (`BACKLOG.md`)

## Rejected alternatives
| Option | Why not |
|---|---|
| Merge now | No new content gained; adds noise for no Stage 1 benefit |
| Delete the branch | Destroys a working, verified pipeline that took real effort to build and may be needed to expand the question bank later |

## Consequences
- **Easy:** `main` stays lean; the pipeline is preserved and rebuildable
- **Hard:** the branch will keep drifting from `main` the longer it sits
  untouched; whoever picks it up later will need to rebase it first

## Revisit when
The question bank needs to grow beyond 1,126 questions — most likely to add
subjective/long-answer questions or fill a gap a chapter's coverage shows
after real student use. At that point, rebase this branch onto current `main`
before resuming Stage C–G.
