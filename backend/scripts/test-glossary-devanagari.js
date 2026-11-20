/**
 * test-glossary-devanagari.js
 *
 * Regression test for BUG-7 (STAGE1_DONE.md Section C).
 *
 * BUG-7: getAnswerLanguageInstruction() (utils/languageDetector.js) returned the
 * Hindi/Devanagari instruction from an early `return` that sat BEFORE the
 * glossary-append block at the tail of the function. Only the Hinglish
 * fall-through path reached the append, so a student who asked in Devanagari
 * (answerLanguage === 'hindi') never received the SCIENCE GLOSSARY term-
 * consistency vocabulary that Hinglish students get on every study turn.
 *
 * Fix (Rule 4 — remove the cause): decide `wantsGlossary` once, independently of
 * the language branch, and append the glossary to whichever base instruction
 * (Hindi or Hinglish) is returned. No guard/wrapper added.
 *
 * No server / DB / LLM call — imports the function directly.
 */

import assert from 'node:assert/strict';

import { getAnswerLanguageInstruction } from '../src/utils/languageDetector.js';

const GLOSSARY_MARKER = 'SCIENCE GLOSSARY';
// A sample term that only appears via formatGlossaryForPrompt().
const SAMPLE_TERM = 'photosynthesis';

// ── BUG-7: Devanagari answers on a study intent MUST carry the glossary ───────
const hindiConcept = getAnswerLanguageInstruction('hindi', 'CONCEPT_QUESTION');
assert.ok(
  hindiConcept.includes(GLOSSARY_MARKER) && hindiConcept.includes(SAMPLE_TERM),
  'BUG-7: getAnswerLanguageInstruction("hindi", "CONCEPT_QUESTION") is missing ' +
  'the science glossary — Devanagari answers get no term-consistency vocabulary.',
);
assert.ok(
  hindiConcept.includes('Devanagari'),
  'BUG-7: the Hindi study-intent instruction lost its Devanagari-script mandate.',
);

// ── Non-study intents stay glossary-free in Hindi too (no wasted ~1200 tokens) ─
const hindiGreeting = getAnswerLanguageInstruction('hindi', 'GREETING');
assert.equal(
  hindiGreeting.includes(GLOSSARY_MARKER),
  false,
  'BUG-7 fix went too far: GREETING (a short conversational reply) should not ' +
  'carry the science glossary.',
);

const hindiNoIntent = getAnswerLanguageInstruction('hindi');
assert.equal(
  hindiNoIntent.includes(GLOSSARY_MARKER),
  false,
  'BUG-7 fix went too far: a Hindi instruction with no intent must not carry ' +
  'the glossary.',
);

// ── Regression guard: Hinglish study-intent path still appends the glossary ───
const hinglishConcept = getAnswerLanguageInstruction('hinglish', 'CONCEPT_QUESTION');
assert.ok(
  hinglishConcept.includes(GLOSSARY_MARKER) && hinglishConcept.includes(SAMPLE_TERM),
  'Regression: Hinglish study-intent instruction lost the science glossary.',
);

const hinglishGreeting = getAnswerLanguageInstruction('hinglish', 'GREETING');
assert.equal(
  hinglishGreeting.includes(GLOSSARY_MARKER),
  false,
  'Regression: Hinglish GREETING should not carry the science glossary.',
);

// ── All STUDY_INTENTS get the glossary in both scripts ───────────────────────
for (const intent of ['CONCEPT_QUESTION', 'EXPLAIN_MORE', 'NEXT_STEP', 'EXAM_INFO', 'CHOOSE_COURSE']) {
  for (const lang of ['hindi', 'hinglish']) {
    assert.ok(
      getAnswerLanguageInstruction(lang, intent).includes(GLOSSARY_MARKER),
      `${lang} / ${intent}: expected the science glossary to be appended.`,
    );
  }
}

console.log('\x1b[32m✓ All glossary-devanagari (BUG-7) tests passed\x1b[0m');
