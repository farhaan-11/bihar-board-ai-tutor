/**
 * test-decider-scope.js
 *
 * Regression test for BUG-4 (STAGE1_DONE.md Section C).
 *
 * BUG-4: deciderPrompt.js hardcoded "Cell structure" and "Atomic structure"
 * into the OUT_OF_CONTEXT exclusion list (intent 8 definition) AND into the
 * rule-8 "HARD LIMIT" block that force-sets searchQuery: null and overrides the
 * Hinglish-rescue rules. But both topics ARE covered by indexed Class 10 content:
 *   - "Atomic structure": data/.../chemistry/chapter-05-periodic-classification
 *     -> "### Atomic number", electronic configuration, K/L/M shells, valence
 *        electrons, 2n^2 rule.
 *   - "Cell structure": data/.../biology/chapter-02-control-and-coordination
 *     -> "## 4. Neuron / Nerve Cell" — full structure + parts (dendrite, cell
 *        body, axon, synapse), plus a "structure and function of a neuron" Q.
 * With searchQuery forced to null the SafetyNet English probe never runs
 * (askOrchestrator.js:96), so questions like "atomic number kya hai" or
 * "neuron ki structure batao" get a hardcoded false "not in your syllabus"
 * reply and also increment the drift counter toward a hard block.
 *
 * Fix (Rule 4 — remove the cause): delete the two stale entries from both the
 * exclusion list and the HARD LIMIT block, and drop the two "cell ..." counter-
 * examples. Genuinely-absent topics (Newton, Gravitation, Thermodynamics, ...)
 * stay excluded; generic Class 9 cell-organelle questions now fail safely via
 * retrieval (insufficient content) instead of a hardcoded decider reject.
 *
 * No server / DB / LLM call — imports the prompt text directly.
 */

import assert from 'node:assert/strict';

import { deciderSystemText } from '../src/prompts/deciderPrompt.js';

// ── BUG-4: the two stale topics must be gone from the decider prompt ──────────
assert.equal(
  /Cell structure/i.test(deciderSystemText),
  false,
  'BUG-4: deciderPrompt still names "Cell structure" as out of scope, but the ' +
  '"Neuron / Nerve Cell" section (chapter-02 biology) covers cell structure ' +
  'and parts — valid questions get a false rejection.',
);

assert.equal(
  /Atomic structure/i.test(deciderSystemText),
  false,
  'BUG-4: deciderPrompt still names "Atomic structure" as out of scope, but ' +
  'chapter-05 chemistry covers atomic number, electronic configuration, shells ' +
  'and valence electrons — valid questions get a false rejection.',
);

// The "cell ..." HARD LIMIT counter-examples must be gone too.
assert.equal(
  /"cell (ki structure|ke parts)/i.test(deciderSystemText),
  false,
  'BUG-4: deciderPrompt still carries a "cell ki structure batao -> ' +
  'OUT_OF_CONTEXT" counter-example.',
);

// ── Over-deletion guard: genuinely-absent topics stay excluded ───────────────
for (const stillExcluded of ['Newton', 'Gravitation', 'Thermodynamics', 'Motion', 'Pressure']) {
  assert.ok(
    deciderSystemText.includes(stillExcluded),
    `BUG-4 fix went too far: "${stillExcluded}" is not in any Class 10 chapter ` +
    `and must remain in the OUT_OF_CONTEXT exclusion list.`,
  );
}

console.log('\x1b[32m✓ All decider-scope (BUG-4) tests passed\x1b[0m');
