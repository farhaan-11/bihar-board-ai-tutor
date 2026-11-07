// Step 6: generates the tutor's answer with the LLM.
// With USE_INTENT_ROUTER=true (the live setting) all the work is done by intentRouter.js.
// The code after that check is the legacy single-prompt path, used only when the flag is not 'true'.

import { RunnableSequence } from '@langchain/core/runnables';
import { createChatModel } from '../llm/chatModel.js';
import { stringParser } from '../llm/stringParser.js';
import { tutorResponsePrompt } from '../prompts/tutorPrompt.js';
import { parseJsonObject } from '../utils/jsonParser.js';
import { getAnswerLanguageInstruction } from '../utils/languageDetector.js';
import { sectionsToAnswerText } from './promptHelpers.js';
import { ProviderUnavailableError, classifyProviderError } from '../utils/providerErrors.js';
import { logCallTokens, approxTokens } from '../utils/tokenLogger.js';
import { extractTokenBreakdown } from '../utils/tokenUsage.js';
import { routeToIntentHandler, normalizeSections } from './intentRouter.js';

const isDev = process.env.NODE_ENV !== 'production';

let responseChain = null;

const getResponseChain = () => {
  if (!responseChain) {
    responseChain = RunnableSequence.from([
      tutorResponsePrompt,
      createChatModel({ temperature: 0.3, maxTokens: 1500 }), // 1500 covers a full science explanation on every provider, including Gemini
      stringParser,
    ]);
  }
  return responseChain;
};

// Fallback section text for when the LLM sections are empty or broken.
// A redirect or conversation reply must not blame a technical error.
const getFallbackSections = (responseMode, status) => {
  if (responseMode === 'redirect' || status === 'out_of_scope') {
    return [{ heading: '', content: 'Yeh topic Class 10 Science ke scope se bahar hai. Koi Science sawaal poochho — main madad karunga!' }];
  }
  if (responseMode === 'conversation') {
    return [{ heading: '', content: 'Haan! Koi sawaal ho toh poochho ya koi topic choose karo — main yahan hun!' }];
  }
  // study_tutor mode or unknown
  return [{ heading: '', content: 'Thodi technical dikkat aayi. Apna sawaal ek baar aur poochho.' }];
};

// Safe response for when the LLM output cannot be parsed (parse errors only).
const createFallbackResponse = ({ responseMode }) => ({
  status: 'error',
  responseMode: responseMode || 'study_tutor',
  title: null,
  sections: getFallbackSections(responseMode, null),
  suggestedActions: [],
  memoryUpdate: {},
});

// The curriculum list (~450 tokens) is only needed in some turns.
// Sending it every turn is the biggest avoidable waste in the prompt.
const needsCurriculum = (intent, responseMode, focusChapterPrompt, retrievedContext) => {
  // Redirect and conversation replies are short and never use the curriculum.
  if (responseMode === 'redirect' || responseMode === 'conversation') return false;

  // CHOOSE_COURSE lists chapters from this field.
  if (intent === 'CHOOSE_COURSE') return true;

  // EXPLAIN_MORE re-explains a topic that is already in the retrieved content.
  if (intent === 'EXPLAIN_MORE') return false;

  // Global mode: no active chapter, so the curriculum is the only reference the LLM has.
  if (focusChapterPrompt === 'No focus chapter selected.') return true;

  // Focus mode and nothing retrieved: the LLM needs it to redirect the student.
  if (retrievedContext === 'NO_RETRIEVED_CONTEXT') return true;

  // Focus mode and content retrieved: the chapter list is noise.
  return false;
};

export const generateResponse = async (input, context, decision, retrieval, streamCallbacks = null, abortSignal = null) => {

  if (process.env.USE_INTENT_ROUTER === 'true') {
    const result = await routeToIntentHandler(input, context, decision, retrieval, streamCallbacks, abortSignal);
    return { ...result, answer: sectionsToAnswerText(result) };
  }

  // Legacy path.
  const { question } = input;
  const { language, memory, history, curriculumSummary, focusChapterPrompt } = context;
  const { responseMode, intent } = decision;
  const { retrievedContext } = retrieval;

  // CHAPTER_COMPLETE: skip the LLM and return a fixed completion message.
  if (retrievedContext === 'CHAPTER_COMPLETE') {
    const chapterCompleteResponse = {
      status: 'answered',
      responseMode: 'study_tutor',
      title: 'Quiz Time!',
      sections: [{
        heading: '',
        content: 'Saare topics ho gaye! Ab is chapter ka quiz do — 70% ya usse zyada laane par chapter complete hoga.',
      }],
      suggestedActions: [
        { type: 'start_gate_quiz', label: 'Quiz shuru karo' },
      ],
      memoryUpdate: {},
    };
    return { ...chapterCompleteResponse, answer: sectionsToAnswerText(chapterCompleteResponse), tokenUsage: 0 };
  }

  if (isDev) console.log(`[Step 6 Execution] Invoking Tutor Generation Engine. Script Target: ${language.answerLanguage}`);

  // Declared outside try so the catch block can read it on parse errors.
  let capturedBreakdown = { input: 0, output: 0, total: 0 };

  try {
    const targetLanguageInstruction = getAnswerLanguageInstruction(language.answerLanguage);

    // Turn memory into JSON text, so the prompt does not show "[object Object]".
    const serializedMemory = memory && typeof memory === 'object'
      ? JSON.stringify(memory, null, 2)
      : String(memory || 'No active state records.');

    const curriculumForPrompt = needsCurriculum(intent, responseMode, focusChapterPrompt, retrievedContext)
      ? curriculumSummary
      : 'Not needed for this response type.';

    const rawResponse = await getResponseChain().invoke(
      {
        message: question,
        answerLanguageInstruction: targetLanguageInstruction,
        responseMode,
        decision: JSON.stringify({ responseMode, intent }),
        memory: serializedMemory,
        history,
        curriculumSummary: curriculumForPrompt,
        focusChapter: focusChapterPrompt,
        retrievedContext,
      },
      {
        signal: abortSignal || undefined,
        callbacks: [{
          handleLLMEnd: (output) => { capturedBreakdown = extractTokenBreakdown(output); },
        }],
      }
    );

    const parsed = parseJsonObject(rawResponse, 'Tutor response payload');

    // Conversation mode must never return insufficient_context or out_of_scope.
    // If the LLM ignored the prompt and did, replace it with a safe reply.
    if (responseMode === 'conversation' && ['insufficient_context', 'out_of_scope'].includes(parsed.status)) {
      console.warn('[Step 6 Guard] Conversation mode but LLM returned', parsed.status, '— overriding with safe fallback');
      const safeConversation = {
        status: 'answered',
        responseMode: 'conversation',
        title: null,
        sections: getFallbackSections('conversation', null),
        suggestedActions: [],
        memoryUpdate: {},
      };
      return { ...safeConversation, answer: sectionsToAnswerText(safeConversation), tokenUsage: capturedBreakdown.total };
    }

    let sections = normalizeSections(parsed.sections);

    // The LLM sometimes puts the conversation text in "title" instead of sections[0].content.
    // If sections are empty but the title has text, use the title as a section.
    if (!sections.length && parsed.title && String(parsed.title).trim()) {
      console.warn('[Step 6 Rescue] Empty sections but title has content — promoting title to section content');
      sections = [{ heading: '', content: String(parsed.title).trim() }];
    }

    // In conversation mode the status is always 'answered', so the LLM cannot send the
    // frontend a wrong state.
    let targetStatus = parsed.status ? String(parsed.status).trim() : 'answered';

    if (responseMode === 'conversation') {
      if (isDev) console.log(`[Step 6 Intent Firewall] Forcing status 'answered' for conversational intent: ${responseMode}`);
      targetStatus = 'answered';
    } else {
      targetStatus = ['answered', 'insufficient_context', 'needs_clarification', 'out_of_scope'].includes(targetStatus)
        ? targetStatus
        : 'answered';
    }

    const normalized = {
      status: targetStatus,
      responseMode,
      title: responseMode === 'conversation' ? null : (parsed.title ? String(parsed.title).trim() : null),
      sections: sections.length ? sections : getFallbackSections(responseMode, parsed.status),
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 4) : [],
      memoryUpdate: parsed.memoryUpdate && typeof parsed.memoryUpdate === 'object' ? parsed.memoryUpdate : {},
    };

    logCallTokens('TUTOR', capturedBreakdown, {
      mode: responseMode,
      status: normalized.status,
      ctxTokens: approxTokens(retrievedContext),
    });

    if (isDev) console.log(`[Step 6 Success] Response structured. Status: ${normalized.status}`);

    return {
      ...normalized,
      answer: sectionsToAnswerText(normalized),
      tokenUsage: capturedBreakdown.total,
      tokenBreakdown: capturedBreakdown,
    };

  } catch (error) {
    const errorType = classifyProviderError(error);

    if (error.name === 'AbortError' || error.message === 'Timeout') {
      throw error;
    }

    // Parse error: the provider is alive, only the output was bad.
    // Return a fallback and let the pipeline continue to Step 7.
    if (errorType === 'parse_error') {
      console.error('[Step 6] Parse error. Returning fallback response.', error.message);
      logCallTokens('TUTOR', capturedBreakdown, { mode: responseMode, status: 'PARSE_ERROR_FALLBACK' });
      responseChain = null;
      const fallback = createFallbackResponse({ responseMode });
      return {
        ...fallback,
        answer: sectionsToAnswerText(fallback),
        tokenUsage: capturedBreakdown.total,
        tokenBreakdown: capturedBreakdown,
      };
    }

    // Provider is down: reset the chain and throw to the orchestrator.
    console.error(`[Step 6] Provider error (${errorType}):`, error.message);
    responseChain = null;
    throw new ProviderUnavailableError(errorType, error.message);
  }
};
