import { RunnableSequence } from '@langchain/core/runnables';
import { createChatModel } from '../llm/chatModel.js';
import { getDeciderConfig } from '../llm/llm.config.js';
import { decisionSchema, DECISION_SCHEMA_NAME } from '../llm/decisionSchema.js';
import { deciderPrompt } from '../prompts/deciderPrompt.js';
import { ProviderUnavailableError, classifyProviderError } from '../utils/providerErrors.js';
import { logCallTokens } from '../utils/tokenLogger.js';
import { extractTokenBreakdown } from '../utils/tokenUsage.js';

const isDev = process.env.NODE_ENV !== 'production';

const VALID_INTENTS = new Set([
  'UNSAFE_OR_ABUSIVE',
  'GREETING',
  'EMOTIONAL_SUPPORT',
  'CHOOSE_COURSE',
  'NEXT_STEP',
  'EXPLAIN_MORE',
  'CONCEPT_QUESTION',
  'EXAM_INFO',
  'OUT_OF_CONTEXT'
]);

const VALID_RESPONSE_MODES = new Set(['conversation', 'study_tutor', 'redirect']);

// Built on the first request, then reused.
let deciderChain = null;

const getDeciderChain = () => {
  if (!deciderChain) {
    // withStructuredOutput makes the provider return an object that matches decisionSchema.
    // So there is no free-text JSON to parse, and no parse-error fallback that could give a
    // false "topic not in syllabus" reply. The schema's intent enum also rules out unknown intents.
    // Uses DECIDER_PROVIDER / DECIDER_MODEL if set, else LLM_PROVIDER / LLM_MODEL.
    const model = createChatModel({ ...getDeciderConfig(), maxTokens: 350 });
    deciderChain = RunnableSequence.from([
      deciderPrompt,
      model.withStructuredOutput(decisionSchema, { name: DECISION_SCHEMA_NAME, strict: true }),
    ]);
  }
  return deciderChain;
};

// Cleans the decider's output and works out the fields the code decides for itself
// (inScope, needsRetrieval, responseMode, searchQuery).
const normalizeDecision = (decision, rawQuestion) => {
  // The schema enum should make an unknown intent impossible. If one still arrives,
  // use CONCEPT_QUESTION, never GREETING: a real question treated as small talk
  // would count toward the drift block.
  const isKnownIntent = VALID_INTENTS.has(decision.intent);
  if (!isKnownIntent) console.error(`[Step 4] Unknown intent "${decision.intent}" — should be impossible with the schema enum; defaulting to CONCEPT_QUESTION`);
  const intent = isKnownIntent ? decision.intent : 'CONCEPT_QUESTION';

  const inScope = (intent !== 'OUT_OF_CONTEXT' && intent !== 'UNSAFE_OR_ABUSIVE');

  let responseMode = VALID_RESPONSE_MODES.has(decision.responseMode) ? decision.responseMode : 'study_tutor';
  if (!inScope) {
    responseMode = 'redirect';
  }

  // Only CONCEPT_QUESTION triggers retrieval. The decider does not return this field.
  const needsRetrieval = (intent === 'CONCEPT_QUESTION' && inScope);

  const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
  const rawSearchQuery = String(decision.searchQuery || '').trim();

  // The decider's English translation of the question, kept for every intent.
  // The safety net probes it even when the intent is OUT_OF_CONTEXT: raw Hinglish scores
  // 0.59-0.69 there (never fires at 0.70), the English translation scores 0.71-0.85.
  // null means the decider says this message needs no content lookup (greeting, emotional,
  // or an excluded topic), and the safety net respects that.
  const englishQuery =
    rawSearchQuery && !DEVANAGARI_PATTERN.test(rawSearchQuery)
      ? rawSearchQuery.replace(/\s+/g, ' ').trim()
      : null;

  // Retrieval always prefers the English query, because the chunks in MongoDB are English.
  // Raw Hinglish returned 0 chunks on 10 of 10 real questions, English returned 5 on all 10.
  // The raw question is only a fallback when the decider gave no usable English.
  let searchQuery = null;
  if (needsRetrieval) {
    if (englishQuery) {
      searchQuery = englishQuery;
    } else if (!DEVANAGARI_PATTERN.test(rawQuestion)) {
      searchQuery = rawQuestion.replace(/\s+/g, ' ').trim();
    } else {
      console.warn('[Step 4] No English searchQuery and raw question is Devanagari — skipping retrieval');
    }
  }

  // Only used for EXAM_INFO: the subject/chapter/unit the student asked about.
  // step5 uses it to fetch the exact fact from code (see examKnowledgeService.js).
  const examEntity = intent === 'EXAM_INFO' ? (String(decision.examEntity || '').trim() || null) : null;

  return {
    intent,
    inScope,
    needsRetrieval,
    responseMode,
    searchQuery,
    englishQuery,
    examEntity,
    reason: String(decision.reason || 'No reason given.').trim()
  };
};

// Step 4: asks the decider LLM what kind of message this is and whether it needs retrieval.
// Returns the normalized decision plus the decider's token usage.
export const decideRetrieval = async ({ question }, { deciderHistory, language }, abortSignal = null) => {
  if (isDev) console.log('[Step 4] Running intent classifier...');

  let capturedBreakdown = { input: 0, output: 0, total: 0 };

  try {
    const decision = await getDeciderChain().invoke(
      {
        message: question,
        detectedLanguage: language?.detectedLanguage ?? 'hinglish',
        history: deciderHistory,
      },
      {
        signal: abortSignal || undefined,
        callbacks: [{
          handleLLMEnd: (output) => { capturedBreakdown = extractTokenBreakdown(output); },
        }],
      }
    );

    if (isDev) console.log('[Step 4] Classification received.');

    const finalDecision = normalizeDecision(decision, question);

    logCallTokens('DECIDER', capturedBreakdown, {
      intent: finalDecision.intent,
      RAG: finalDecision.needsRetrieval ? 'YES' : 'NO',
    });

    return { ...finalDecision, tokenUsage: capturedBreakdown.total, tokenBreakdown: capturedBreakdown };

  } catch (error) {
    // Drop the chain so the next request builds a fresh one.
    deciderChain = null;

    if (error.name === 'AbortError' || error.message === 'Timeout') {
      throw error;
    }

    // The output shape is guaranteed, so any error here is a real provider failure
    // (rate limit, auth, network, refusal). Throw it so the orchestrator can ask the
    // student to try again, never a false scope rejection.
    const errorType = classifyProviderError(error);
    console.error(`[Step 4] Decider call failed (${errorType}):`, error.message);
    throw new ProviderUnavailableError(errorType, error.message);
  }
};
