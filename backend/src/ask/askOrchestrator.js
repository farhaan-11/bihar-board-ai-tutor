// A student's question lands here from POST /api/v1/ask.
// I run 7 steps in order, each in its own file:
//   1 validate input   2 load session   3 build context   4 decide retrieval (LLM)
//   5 retrieve chunks  6 generate answer (LLM)   7 save and respond

import { validateInput } from './step1.validateInput.js';
import { loadSession } from './step2.loadSession.js';
import { buildContext } from './step3.buildContext.js';
import { decideRetrieval } from './step4.decideRetrieval.js';
import { checkSyllabusMatch } from './intentSafetyNet.js';
import { retrieveContent } from './step5.retrieveContent.js';
import { generateResponse } from './step6.generateResponse.js';
import { saveAndRespond } from './step7.saveAndRespond.js';
import {
  ProviderUnavailableError,
  getEffectiveErrorCount,
  getProviderErrorMessage,
  buildProviderErrorResponse,
} from '../utils/providerErrors.js';
import { updateChatSessionState } from '../services/chatSession.service.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const isDev = process.env.NODE_ENV !== 'production';

// The controller calls this, and gets back the full API response payload.
export const askQuestion = async (
  body = {},
  { userId = null, guestId = null } = {},
  streamCallbacks = null,
  abortSignal = null
) => {

  // Steps 1-3. A failure here means the DB or my config is broken, not the LLM provider.
  let input, session, context;

  try {
    input = await validateInput(body);
    session = await loadSession({ ...input, userId, guestId });
    context = await buildContext(input, session);
  } catch (error) {
    // step1 and step2 already wrote a safe Hinglish message for any 4xx, so I pass it through.
    if (error instanceof ApiError && error.statusCode < 500) {
      return buildProviderErrorResponse(error.message, body.question, body.studyMode);
    }
    // Anything else is a DB outage or my own bug — I never show the student the real error.
    console.error('[Orchestrator] Pre-pipeline failure:', error.message);
    return buildProviderErrorResponse(
      'Kuch technical dikkat aa gayi. Thodi der mein try karo.',
      body.question,
      body.studyMode
    );
  }

  // Steps 4-7. Both LLM calls are in here, so a provider failure lands in the catch below.
  try {
    streamCallbacks?.onStage?.('deciding');
    const decision = await decideRetrieval(input, context, abortSignal);
    if (isDev) console.log(`[Step 4→5] intent: ${decision.intent}, needsRetrieval: ${decision.needsRetrieval}`);

    // The decider sometimes calls a real science question a greeting, so I check again.
    // I only check when it gave me an English translation — Hinglish scores 0.59-0.69 and
    // never fires, while the same question in English scores 0.71-0.85 and always does.
    // No English translation means a greeting or an emotional message, so there is nothing to check.
    const SAFETY_NET_TARGETS = new Set(['GREETING', 'OUT_OF_CONTEXT']);
    if (SAFETY_NET_TARGETS.has(decision.intent) && decision.englishQuery) {
      const { score, fired } = await checkSyllabusMatch(decision.englishQuery);
      if (fired) {
        console.warn(
          `[SafetyNet] ${decision.intent} → CONCEPT_QUESTION | score:${score.toFixed(3)} | english:"${decision.englishQuery.slice(0, 60)}"`
        );
        decision.intent         = 'CONCEPT_QUESTION';
        decision.inScope        = true;
        decision.needsRetrieval = true;
        decision.responseMode   = 'study_tutor';
        decision._overridden    = true;

        // Retrieval has to use the English query — the raw question returns 0 chunks.
        decision.searchQuery = decision.englishQuery;
      }
    }

    // Too much small talk in one session, so I stop answering it. This runs after the safety
    // net so a real question is never blocked. I skip both LLM calls but still run step7,
    // which saves the turn. The 'DRIFT_CAP' intent is in no counter set, so counters stay put.
    const DRIFT_CAP_INTENTS = new Set(['GREETING', 'OUT_OF_CONTEXT']);
    if (
      DRIFT_CAP_INTENTS.has(decision.intent) &&
      (context.driftSignal?.totalNonAcademic ?? 0) >= env.maxNonAcademicTurns
    ) {
      console.warn(
        `[DriftCap] Session ${session.sessionId} — total drift ${context.driftSignal.totalNonAcademic} >= max ${env.maxNonAcademicTurns}. Blocking ${decision.intent} turn.`
      );
      const capMessage = 'Zuno sirf Science padhaane ke liye hai! Koi bhi topic chunao — Physics, Chemistry, ya Biology — aur hum shuru karte hain.';

      const capDecision = { ...decision, intent: 'DRIFT_CAP' };

      const capRetrieval = {
        retrieval:          null,
        chunks:             [],
        sources:            [],
        retrievedContext:   'NO_RETRIEVED_CONTEXT',
        nextTopicSignal:    null,
        lastRetrievalQuery: null,
      };

      const capResponse = {
        status:           'answered',
        responseMode:     'conversation',
        title:            null,
        sections:         [{ heading: '', content: capMessage }],
        answer:           capMessage,
        suggestedActions: [],
        memoryUpdate:     {},
        tokenUsage:       0,
        tokenBreakdown:   { input: 0, output: 0, total: 0, cached: 0 },
      };

      // The stream is already open by now, so this has to go out through onComplete.
      // A plain return would be swallowed by the controller's `if (streamStarted) return;`.
      try {
        const savedPayload = await saveAndRespond({
          input, session, context,
          decision:   capDecision,
          retrieved:  capRetrieval,
          response:   capResponse,
          userId,
          tokenUsage: decision.tokenUsage || 0,
          guestId,
        });
        streamCallbacks?.onComplete?.(savedPayload);
        return savedPayload;
      } catch {
        // The DB write failed. The student still gets the message, but the session stays stale.
        const unsavedPayload = {
          status:           'answered',
          intent:           'conversation',
          responseMode:     'conversation',
          studyMode:        input.studyMode,
          question:         input.question,
          detectedLanguage: context.language?.detectedLanguage ?? 'hinglish',
          answerLanguage:   context.language?.answerLanguage   ?? 'hinglish',
          title:            null,
          sections:         [{ heading: '', content: capMessage }],
          answer:           capMessage,
          sources:          [],
          suggestedActions: [],
          retrieval:        null,
          decision:         null,
          session:          null,
        };
        streamCallbacks?.onComplete?.(unsavedPayload);
        return unsavedPayload;
      }
    }

    // I only show "searching" when step 5 really searches. EXAM_INFO reads a JSON file and
    // greetings skip step 5 completely, so the phrase would be a lie for them.
    const CONTENT_FETCHING_INTENTS = new Set(['CONCEPT_QUESTION', 'NEXT_STEP', 'EXPLAIN_MORE']);
    if (CONTENT_FETCHING_INTENTS.has(decision.intent)) {
      streamCallbacks?.onStage?.('searching');
    }

    const retrieval = await retrieveContent(decision, input, session, abortSignal);

    // CHAPTER_COMPLETE returns a fixed message with no LLM call, so nothing is generated.
    if (retrieval.retrievedContext !== 'CHAPTER_COMPLETE') {
      streamCallbacks?.onStage?.('generating');
    }

    const response = await generateResponse(input, context, decision, retrieval, streamCallbacks, abortSignal);
    const tokenUsage = (decision.tokenUsage || 0) + (response.tokenUsage || 0);
    const finalPayload = await saveAndRespond({
      input, session, context, decision, response, userId, tokenUsage, guestId,
      retrieved: retrieval,
    });

    if (streamCallbacks?.onComplete) {
      streamCallbacks.onComplete(finalPayload);
    }
    return finalPayload;

  } catch (error) {

    // An abort means the student left or we timed out, so the controller handles it, not me.
    if (error.name === 'AbortError' || error.message === 'Client disconnected' || error.message === 'Timeout') {
      throw error;
    }

    if (error instanceof ProviderUnavailableError) {
      // How many times this has already failed recently — the message gets softer each time.
      const effectiveCount = getEffectiveErrorCount(
        session.chatState?.consecutiveErrors,
        session.chatState?.lastErrorAt
      );

      const message = getProviderErrorMessage(
        error.errorType,
        effectiveCount,
        input.question
      );

      // Fire and forget — if this write fails the student still gets an answer.
      updateChatSessionState(session.sessionId, {
        consecutiveErrors: effectiveCount + 1,
        lastErrorAt: new Date(),
      }, userId).catch((e) => console.error('[Orchestrator] consecutiveErrors save failed:', e));

      // Same as the drift cap above — the stream is open, so this goes out through onComplete.
      const providerErrorPayload = buildProviderErrorResponse(message, input.question, input.studyMode);
      streamCallbacks?.onComplete?.(providerErrorPayload);
      return providerErrorPayload;
    }

    // Not the provider's fault (a step 7 Mongo failure, say), so I don't count it against it.
    console.error('[Orchestrator] Unexpected pipeline error:', error.message);
    const unexpectedErrorPayload = buildProviderErrorResponse(
      'Kuch technical dikkat aa gayi. Thodi der mein try karo.',
      input.question,
      input.studyMode
    );
    streamCallbacks?.onComplete?.(unexpectedErrorPayload);
    return unexpectedErrorPayload;
  }
};
