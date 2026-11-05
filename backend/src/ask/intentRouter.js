// Picks the prompt and model settings for each intent, then calls the LLM.
// step6 calls this when USE_INTENT_ROUTER=true (the live setting).
//
// Read top to bottom: DRIFT_INSTRUCTIONS, INTENT_CONFIG, HISTORY_WINDOW, getChain(),
// buildPromptInput(), routeToIntentHandler().

import { RunnableSequence }      from '@langchain/core/runnables';
import { greetingPrompt }          from '../prompts/intents/greetingPrompt.js';
import { redirectPrompt }          from '../prompts/intents/redirectPrompt.js';
import { unsafePrompt }            from '../prompts/intents/unsafePrompt.js';
import { chooseCoursePrompt }      from '../prompts/intents/chooseCoursePrompt.js';
import { explainMorePrompt }       from '../prompts/intents/explainMorePrompt.js';
import { conceptWithChunksPrompt, conceptNoChunksPrompt } from '../prompts/intents/conceptQuestionPrompt.js';
import { nextStepPrompt }          from '../prompts/intents/nextStepPrompt.js';
import { examInfoPrompt }          from '../prompts/intents/examInfoPrompt.js';
import { emotionalSupportPrompt }  from '../prompts/intents/emotionalSupportPrompt.js';
import { createChatModel }       from '../llm/chatModel.js';
import { stringParser }          from '../llm/stringParser.js';
import { parseJsonObject }       from '../utils/jsonParser.js';
import { getAnswerLanguageInstruction } from '../utils/languageDetector.js';
import { formatRecentHistory, formatCompressedHistory } from './promptHelpers.js';
import { logCallTokens }         from '../utils/tokenLogger.js';
import { extractTokenBreakdown } from '../utils/tokenUsage.js';
import { ProviderUnavailableError, classifyProviderError } from '../utils/providerErrors.js';

const isDev = process.env.NODE_ENV !== 'production';

// Extra instruction for the GREETING prompt, by drift tier (how many casual messages in a row).
// Tier 0: none. Tier 1: gentle nudge to study.
// Tier 2: firm redirect, but emotional messages still get one line of empathy first.
const DRIFT_INSTRUCTIONS = {
  0: '',
  1: 'Behavior note: Student kai baar casual messages bhej chuka hai. Ek sentence mein briefly respond karo, phir clearly ek science topic padhne ke liye invite karo.',
  2: 'Behavior note: Student baar baar padhai se bhaag raha hai. Agar message emotional hai (exam stress, scared, tired) to sirf ek line empathy do phir study redirect. Agar sirf casual chat hai to directly 1-2 lines mein ek science topic suggest karo — aur kuch nahi.',
};

// Prompt and model settings per intent.
// temperature: 0 = same answer every time, higher = more varied.
// maxTokens: hard cap on reply length. Short replies save real tokens.
// GREETING is 0.5 so replies do not feel robotic. OUT_OF_CONTEXT, UNSAFE and CONCEPT are 0.
//
// CONCEPT_QUESTION has two keys here (WITH_CHUNKS / NO_CHUNKS), picked by resolveChainKey()
// below. decision.intent stays 'CONCEPT_QUESTION' everywhere else.
const INTENT_CONFIG = {
  GREETING:                     { prompt: greetingPrompt,          temperature: 0.5, maxTokens: 300  },
  EMOTIONAL_SUPPORT:            { prompt: emotionalSupportPrompt,  temperature: 0.5, maxTokens: 350  },
  OUT_OF_CONTEXT:               { prompt: redirectPrompt,          temperature: 0,   maxTokens: 100  },
  UNSAFE_OR_ABUSIVE:            { prompt: unsafePrompt,            temperature: 0,   maxTokens: 100  },
  CHOOSE_COURSE:                { prompt: chooseCoursePrompt,      temperature: 0.2, maxTokens: 600  },
  EXPLAIN_MORE:                 { prompt: explainMorePrompt,       temperature: 0.3, maxTokens: 1500 },
  CONCEPT_QUESTION_WITH_CHUNKS: { prompt: conceptWithChunksPrompt, temperature: 0,   maxTokens: 1500 },
  CONCEPT_QUESTION_NO_CHUNKS:   { prompt: conceptNoChunksPrompt,   temperature: 0,   maxTokens: 300  },
  EXAM_INFO:                    { prompt: examInfoPrompt,          temperature: 0,   maxTokens: 600  },
  NEXT_STEP:                    { prompt: nextStepPrompt,          temperature: 0.1, maxTokens: 1200 },
};

// How many recent messages each intent gets. 0 = none. Less history means fewer tokens.
const HISTORY_WINDOW = {
  GREETING:                     4,
  EMOTIONAL_SUPPORT:            4,
  OUT_OF_CONTEXT:               0,
  UNSAFE_OR_ABUSIVE:            0,
  CHOOSE_COURSE:                4,
  EXPLAIN_MORE:                 6,
  CONCEPT_QUESTION_WITH_CHUNKS: 6,
  CONCEPT_QUESTION_NO_CHUNKS:   0,   // the redirect does not use history at all
  EXAM_INFO:                    0,
  NEXT_STEP:                    2,
};

// One chain per intent, built the first time it is needed.
const intentChains = new Map();

const getChain = (intent) => {
  if (!intentChains.has(intent)) {
    const config = INTENT_CONFIG[intent];
    intentChains.set(intent, RunnableSequence.from([
      config.prompt,
      createChatModel({ temperature: config.temperature, maxTokens: config.maxTokens }),
      stringParser,
    ]));
  }
  return intentChains.get(intent);
};

// Each prompt only accepts certain {variables}. Send only what that prompt needs.
const buildPromptInput = (intent, input, context, retrieval) => {
  const { question }                                                                      = input;
  const { language, curriculumSummary, focusChapterPrompt, recentMessages = [], driftSignal, lastStudyResponse } = context;
  const { retrievedContext }                                                             = retrieval;

  const answerLang = getAnswerLanguageInstruction(language.answerLanguage, intent);
  const window     = HISTORY_WINDOW[intent] ?? 6;
  // Older Zuno replies are compressed, except for EXPLAIN_MORE. Its prompt says never to
  // open like the last explanation, so it needs the full last reply.
  const history    = window === 0
    ? ''
    : intent === 'EXPLAIN_MORE'
      ? formatRecentHistory(recentMessages.slice(-window))
      : formatCompressedHistory(recentMessages.slice(-window));

  switch (intent) {
    case 'GREETING': {
      const tier            = driftSignal?.tier ?? 0;
      const driftInstruction = DRIFT_INSTRUCTIONS[tier] ?? '';
      return { message: question, answerLanguageInstruction: answerLang, history, driftInstruction };
    }

    case 'EMOTIONAL_SUPPORT':
      return { message: question, answerLanguageInstruction: answerLang, history };

    case 'OUT_OF_CONTEXT':
    case 'UNSAFE_OR_ABUSIVE':
      return { message: question };

    case 'CHOOSE_COURSE':
      return { message: question, answerLanguageInstruction: answerLang, curriculumSummary, history };

    case 'EXPLAIN_MORE':
      return { message: question, answerLanguageInstruction: answerLang, retrievedContext, history, lastStudyResponse: lastStudyResponse || 'No previous study explanation.' };

    case 'CONCEPT_QUESTION_WITH_CHUNKS':
      return { message: question, answerLanguageInstruction: answerLang, focusChapter: focusChapterPrompt, retrievedContext, history, lastStudyResponse: lastStudyResponse || 'No previous study explanation.' };

    case 'CONCEPT_QUESTION_NO_CHUNKS':
      // The prompt only gives a short, honest redirect, so no retrievedContext, history or focusChapter.
      return { message: question, answerLanguageInstruction: answerLang };

    case 'EXAM_INFO':
      return { message: question, answerLanguageInstruction: answerLang, retrievedContext };

    case 'NEXT_STEP':
      return { message: question, answerLanguageInstruction: answerLang, retrievedContext, history };

    default:
      // Unknown intent: use the concept question inputs.
      return { message: question, answerLanguageInstruction: answerLang, focusChapter: focusChapterPrompt, retrievedContext, history };
  }
};

// Cleans up the sections array from LLM output (at most 5 sections).
export const normalizeSections = (sections) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((s) => ({ heading: String(s?.heading || '').trim(), content: String(s?.content || '').trim() }))
    .filter((s) => s.heading || s.content)
    .slice(0, 5);
};

// The LLM sometimes echoes a prompt's example text (like "Explanation here") instead of
// writing a real answer. This catches that. "Aage badhein" is not listed on purpose:
// it is a real chip label, not leaked placeholder text.
const PLACEHOLDER_SIGNATURES = new Set([
  'explanation here',
  'section heading',
  'short topic title',
  'topic title from retrieved content',
  'simple hinglish question',
  'your hinglish question here',
]);

export const isPlaceholderResponse = (sections) =>
  sections.length > 0 &&
  sections.every((s) => PLACEHOLDER_SIGNATURES.has(s.content.trim().toLowerCase()));

// CONCEPT_QUESTION uses one of two prompt variants, depending on whether step5 found usable
// content. Every other intent passes through unchanged. The returned key only picks the
// prompt, chain and history window. Logging, drift tracking and step7 still see 'CONCEPT_QUESTION'.
const resolveChainKey = (intent, retrievedContext) => {
  if (intent !== 'CONCEPT_QUESTION') return intent;
  const hasChunks = Boolean(retrievedContext)
    && retrievedContext !== 'NO_RETRIEVED_CONTEXT'
    && retrievedContext !== 'CHAPTER_COMPLETE';
  return hasChunks ? 'CONCEPT_QUESTION_WITH_CHUNKS' : 'CONCEPT_QUESTION_NO_CHUNKS';
};

export const routeToIntentHandler = async (input, context, decision, retrieval, streamCallbacks = null, abortSignal = null) => {
  const { intent, responseMode } = decision;
  const chainKey = resolveChainKey(intent, retrieval.retrievedContext);

  // step5 says the chapter is finished. No LLM call, return a fixed message.
  if (retrieval.retrievedContext === 'CHAPTER_COMPLETE') {
    return {
      status:           'answered',
      responseMode:     'study_tutor',
      title:            'Quiz Time!',
      sections:         [{ heading: '', content: 'Saare topics ho gaye! Ab is chapter ka quiz do — 70% ya usse zyada laane par chapter complete hoga.' }],
      suggestedActions: [
        { type: 'start_gate_quiz', label: 'Quiz shuru karo' },
      ],
      memoryUpdate:     {},
      tokenUsage:       0,
      tokenBreakdown:   { input: 0, output: 0, total: 0, cached: 0 },
    };
  }

  // The topic exists, but in another chapter than the student's focus chapter.
  // Fixed reply, no LLM call.
  if (retrieval.isOutOfFocusAnswer && intent === 'CONCEPT_QUESTION') {
    const chapterTitle = input.focusChapter?.hinglishTitle || input.focusChapter?.title || 'is chapter';
    if (isDev) console.log(`[IntentRouter] Out-of-focus answer detected for focus chapter: "${chapterTitle}"`);
    return {
      status:           'answered',
      responseMode:     'study_tutor',
      title:            'Yeh topic doosre chapter mein hai',
      sections:         [{ heading: '', content: `"${chapterTitle}" chapter mein yeh topic nahi milaa. Poore Science material mein search karne ke liye Global Mode use karo — wahan milega!` }],
      suggestedActions: [{ type: 'global_mode', label: 'Poore Science mein dhundho' }],
      memoryUpdate:     {},
      tokenUsage:       0,
      tokenBreakdown:   { input: 0, output: 0, total: 0, cached: 0 },
    };
  }

  // NEXT_STEP with no active chapter (Global Mode). Fixed reply, no LLM call.
  // getNextTopic() only says 'no_chapter' when chatState.currentChapterId is null, which never
  // happens in Focus Mode, so the (NO_RETRIEVED_CONTEXT, NEXT_STEP) pair is enough to detect it.
  if (retrieval.retrievedContext === 'NO_RETRIEVED_CONTEXT' && intent === 'NEXT_STEP') {
    return {
      status:           'answered',
      responseMode:     'study_tutor',
      title:            null,
      sections:         [{ heading: '', content: 'Abhi koi chapter select nahi hai, isliye "agla topic" dikha nahi sakte. Pehle ek chapter chuno, phir hum step by step aage badhenge!' }],
      suggestedActions: [
        { type: 'switch_chapter', label: 'Chapter chunein' },
        { type: 'global_mode',    label: 'Koi bhi sawaal poochho' },
      ],
      memoryUpdate:     {},
      tokenUsage:       0,
      tokenBreakdown:   { input: 0, output: 0, total: 0, cached: 0 },
    };
  }

  // Should never happen: step4's normalizeDecision already fixes unknown intents.
  if (!INTENT_CONFIG[chainKey]) {
    console.warn(`[IntentRouter] Unknown intent "${intent}" — falling back to CONCEPT_QUESTION`);
    return routeToIntentHandler(input, context, { ...decision, intent: 'CONCEPT_QUESTION' }, retrieval);
  }

  let capturedBreakdown = { input: 0, output: 0, total: 0, cached: 0 };

  try {
    const chain       = getChain(chainKey);
    const promptInput = buildPromptInput(chainKey, input, context, retrieval);

    if (streamCallbacks?.onStreamStart) {
      streamCallbacks.onStreamStart();
    }

    let rawResponse = '';
    const stream = await chain.stream(promptInput, {
      signal: abortSignal || undefined,
      callbacks: [{ handleLLMEnd: (out) => { capturedBreakdown = extractTokenBreakdown(out); } }],
    });

    for await (const chunk of stream) {
      rawResponse += chunk;
      if (streamCallbacks?.onToken) {
        streamCallbacks.onToken(chunk);
      }
    }

    const parsed = parseJsonObject(rawResponse, `IntentRouter [${chainKey}]`);

    // The LLM sometimes puts the answer in "title" instead of sections[0].content.
    // If sections are empty but the title has text, use the title as a section.
    let sections = normalizeSections(parsed.sections);
    if (!sections.length && String(parsed.title || '').trim()) {
      sections = [{ heading: '', content: String(parsed.title).trim() }];
    }

    // The LLM echoed a prompt example (e.g. "Explanation here") instead of an answer.
    // Return the same safe message the parse-error path below uses.
    if (isPlaceholderResponse(sections)) {
      console.error(`[IntentRouter] Placeholder leak for "${intent}" — falling back`);
      logCallTokens('TUTOR', capturedBreakdown, { mode: responseMode, intent, status: 'PLACEHOLDER_LEAK' });
      return {
        status:           'error',
        responseMode:     responseMode || 'study_tutor',
        title:            null,
        sections:         [{ heading: '', content: 'Thodi technical dikkat aayi. Apna sawaal ek baar aur poochho.' }],
        suggestedActions: [],
        memoryUpdate:     {},
        tokenUsage:       capturedBreakdown.total,
        tokenBreakdown:   capturedBreakdown,
      };
    }

    // GREETING and EMOTIONAL_SUPPORT are always "answered", so the LLM cannot
    // return insufficient_context for a non-academic message.
    let status = String(parsed.status || 'answered').trim();
    if (intent === 'GREETING' || intent === 'EMOTIONAL_SUPPORT') {
      status = 'answered';
    }

    // CONCEPT_QUESTION and EXPLAIN_MORE sometimes say "insufficient_context" even though
    // step5 found good chunks and the LLM wrote a real answer. That is model confusion, not
    // a content gap. A real gap is handled earlier (retrievedContext is NO_RETRIEVED_CONTEXT),
    // which this check leaves out.
    const RETRIEVAL_BACKED_INTENTS = new Set(['CONCEPT_QUESTION', 'EXPLAIN_MORE']);
    const hasRealRetrievedContent =
      Boolean(retrieval.retrievedContext) &&
      retrieval.retrievedContext !== 'NO_RETRIEVED_CONTEXT' &&
      retrieval.retrievedContext !== 'CHAPTER_COMPLETE';
    const hasSubstantiveAnswer = sections.some((s) => s.content.length >= 50);

    if (
      RETRIEVAL_BACKED_INTENTS.has(intent) &&
      hasRealRetrievedContent &&
      hasSubstantiveAnswer &&
      ['insufficient_context', 'out_of_scope'].includes(status)
    ) {
      console.warn(`[IntentRouter Guard] ${intent} returned "${status}" despite retrieved content — overriding to "answered"`);
      status = 'answered';
    }

    const VALID_STATUSES = new Set(['answered', 'insufficient_context', 'needs_clarification', 'out_of_scope']);
    if (!VALID_STATUSES.has(status)) status = 'answered';

    const normalized = {
      status,
      responseMode:     parsed.responseMode ?? responseMode,
      title:            responseMode === 'conversation' ? null : (String(parsed.title || '').trim() || null),
      sections:         sections.length ? sections : [{ heading: '', content: 'Thodi technical dikkat aayi. Apna sawaal ek baar aur poochho.' }],
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 4) : [],
      memoryUpdate:     (parsed.memoryUpdate && typeof parsed.memoryUpdate === 'object') ? parsed.memoryUpdate : {},
    };

    logCallTokens('TUTOR', capturedBreakdown, { mode: responseMode, intent });
    const chainLabel = chainKey !== intent ? ` (${chainKey})` : '';
    if (isDev) console.log(`[IntentRouter] ${intent}${chainLabel} → status:${normalized.status}`);

    return { ...normalized, tokenUsage: capturedBreakdown.total, tokenBreakdown: capturedBreakdown };

  } catch (error) {
    intentChains.delete(chainKey); // rebuild this chain fresh on the next request

    const errorType = classifyProviderError(error);

    if (error.name === 'AbortError' || error.message === 'Timeout') {
      throw error;
    }

    if (errorType === 'parse_error') {
      console.error(`[IntentRouter] Parse error for "${intent}":`, error.message);
      logCallTokens('TUTOR', capturedBreakdown, { mode: responseMode, intent, status: 'PARSE_ERROR' });
      return {
        status:           'error',
        responseMode:     responseMode || 'study_tutor',
        title:            null,
        sections:         [{ heading: '', content: 'Thodi technical dikkat aayi. Apna sawaal ek baar aur poochho.' }],
        suggestedActions: [],
        memoryUpdate:     {},
        tokenUsage:       capturedBreakdown.total,
        tokenBreakdown:   capturedBreakdown,
      };
    }

    throw new ProviderUnavailableError(errorType, error.message);
  }
};
