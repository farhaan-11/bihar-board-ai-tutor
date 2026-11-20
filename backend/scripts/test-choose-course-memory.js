/**
 * test-choose-course-memory.js
 *
 * Regression test for BUG-3 (STAGE1_DONE.md Section C).
 *
 * BUG-3: step7.saveAndRespond.js's INTENT_MEMORY_WHITELIST let CHOOSE_COURSE
 * write currentSubjectId / currentSectionId / currentChapterId into session
 * memory. Those three fields are then UNCONDITIONALLY overwritten ~180 lines
 * later (the `studyMode === 'global' | 'focus'` force-sync block) from
 * chatState — which step2 sets from the request's chapterId, never from the
 * LLM. So the whitelist entry promised a capability (LLM-driven chapter
 * switching) that does not exist. Chapter switching only ever happens through
 * the request `chapterId` param (frontend FocusModal path).
 *
 * Fix (Rule 4 — remove the cause): CHOOSE_COURSE whitelist entry is now [].
 *
 * No server / DB / LLM call — imports the pure helper + the whitelist directly.
 */

import assert from 'node:assert/strict';

import {
  INTENT_MEMORY_WHITELIST,
  sanitizeMemoryUpdate,
} from '../src/ask/step7.saveAndRespond.js';

// Fields the step7 force-sync block (studyMode === 'global' | 'focus') writes
// UNCONDITIONALLY on every turn, for every intent, straight from chatState.
// Anything an intent whitelist lists here is dead — it can never reach the DB.
const CODE_MANAGED_CHAPTER_FIELDS = [
  'currentSubjectId',
  'currentSectionId',
  'currentChapterId',
];

// ── Invariant: no intent may whitelist a code-managed chapter field ──────────
for (const [intent, fields] of Object.entries(INTENT_MEMORY_WHITELIST)) {
  for (const dead of CODE_MANAGED_CHAPTER_FIELDS) {
    assert.equal(
      fields.includes(dead),
      false,
      `BUG-3: intent "${intent}" whitelists "${dead}", but step7's force-sync ` +
      `block overwrites it every turn from chatState — the entry is dead code.`,
    );
  }
}

// ── Behavioural: CHOOSE_COURSE lets the LLM write nothing to session memory ──
assert.deepEqual(
  sanitizeMemoryUpdate({
    memoryUpdate: {
      currentChapterId: 'phys_ch_03',
      currentSubjectId: 'science',
      learningMode: 'lesson',
      lastTopic: 'Reflection of light',
    },
    intent: 'CHOOSE_COURSE',
  }),
  {},
  'CHOOSE_COURSE must strip every LLM-supplied field — chapter context comes ' +
  'from the request chapterId, not the tutor LLM.',
);

// ── Guard against over-deletion: the study intents keep their real fields ────
assert.deepEqual(
  sanitizeMemoryUpdate({
    memoryUpdate: { lastTopic: 'Reflection of light', currentChapterId: 'x' },
    intent: 'CONCEPT_QUESTION',
  }),
  { lastTopic: 'Reflection of light' },
  'CONCEPT_QUESTION still keeps lastTopic (and still drops currentChapterId).',
);

assert.deepEqual(
  sanitizeMemoryUpdate({
    memoryUpdate: { lastDoubtTopic: 'Ohm law', lastTopic: 'drift' },
    intent: 'EXPLAIN_MORE',
  }),
  { lastDoubtTopic: 'Ohm law' },
  'EXPLAIN_MORE still keeps lastDoubtTopic and still blocks lastTopic (drift guard).',
);

console.log('\x1b[32m✓ All choose-course-memory (BUG-3) tests passed\x1b[0m');
