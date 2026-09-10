/**
 * askOrchestrator.js
 *
 * ============================================================
 * THE MAIN ASK API FLOW — START HERE TO UNDERSTAND THE SYSTEM
 * ============================================================
 *
 * When a student sends a question (POST /api/v1/ask), this file runs.
 * It calls 7 steps in order. Each step is its own small file.
 *
 * FLOW:
 *
 *   Step 1 → validateInput.js     Validate question, studyMode, chapterId
 *   Step 2 → loadSession.js       Load/create session, state, history from MongoDB
 *   Step 3 → buildContext.js      Detect language, format memory + history for LLM
 *   Step 4 → decideRetrieval.js   LLM Decider: is this in scope? does it need RAG?  ← 1st LLM call
 *   Step 5 → retrieveContent.js   Vector search + rerank (if Step 4 said needsRetrieval=true)
 *   Step 6 → generateResponse.js  Tutor LLM: generate the student-facing answer     ← 2nd LLM call
 *   Step 7 → saveAndRespond.js    Save to MongoDB, build and return the API response
 *
 * READING TIP FOR JUNIOR DEVELOPERS:ASA
 *   If you want to understand any specific part, open the step file directly.
 *   Each step file has comments explaining what it does, what it returns, and why.
 */

import { validateInput } from './step1.validateInput.js';
import { loadSession } from './step2.loadSession.js';
import { buildContext } from './step3.buildContext.js';
import { decideRetrieval } from './step4.decideRetrieval.js';
import { probeAcademicSimilarity } from './intentSafetyNet.js';
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

/**
 * Main Ask API handler.
 * Called by ask.controller.js → ask.routes.js → POST /api/v1/ask
 *
 * @param {object} body - Raw request body { question, studyMode, sessionId, chapterId }
 * @returns {object}    - The complete API response payload
 */
export const askQuestion = async (body = {}, { userId = null, guestId = null } = {}, streamCallbacks = null, abortSignal = null) => {

  // --- PRE-PIPELINE: Steps 1-3 ---
  // These steps handle input validation, DB session load, and context building.
  // If these fail it is likely a DB outage or config issue — not a provider error.
  let input, session, context;

  try {
    input = await validateInput(body);
    session = await loadSession({ ...input, userId, guestId });
    context = await buildContext(input, session);
  } catch (error) {
    // Any client-facing validation/session error (400/403/404/429) already carries
    // a safe, curated Hinglish message from step1/step2 — show it as-is instead of
    // masking it with the generic fallback below.
    if (error instanceof ApiError && error.statusCode < 500) {
      return buildProviderErrorResponse(error.message, body.question, body.studyMode);
    }
    // Truly unknown/unexpected errors (DB down, code bug) — never leak internals.
    console.error('[Orchestrator] Pre-pipeline failure:', error.message);
    return buildProviderErrorResponse(
      'Kuch technical dikkat aa gayi. Thodi der mein try karo.',
      body.question,
      body.studyMode
    );
  }

  // --- MAIN PIPELINE: Steps 4-7 ---
  try {
    streamCallbacks?.onStage?.('deciding');
    const decision = await decideRetrieval(input, context, abortSignal);
    if (isDev) console.log(`[Step 4→5] intent: ${decision.intent}, needsRetrieval: ${decision.needsRetrieval}`);

    // --- Layer 2.2: Academic Safety Net ---
    // Runs ONLY when the decider produced an English translation. That is the gate:
    //   englishQuery != null  → "this is a real-world question" → worth probing
    //   englishQuery == null  → greeting / emotional / explicitly-excluded → nothing to probe
    // This is what keeps "Hello Zuno" a greeting: it probes 0.7355 on its raw text (above the
    // 0.70 threshold) and used to be wrongly promoted to CONCEPT_QUESTION. With no English
    // query, the probe never runs.
    // Probing English also makes the net actually work: raw Hinglish scores 0.59-0.69 and never
    // fires; the same questions in English score 0.71-0.85 and always do.
    const SAFETY_NET_TARGETS = new Set(['GREETING', 'OUT_OF_CONTEXT']);
    if (SAFETY_NET_TARGETS.has(decision.intent) && decision.englishQuery) {
      const { score, fired } = await probeAcademicSimilarity(decision.englishQuery);
      if (fired) {
        console.warn(
          `[SafetyNet] ${decision.intent} → CONCEPT_QUESTION | score:${score.toFixed(3)} | english:"${decision.englishQuery.slice(0, 60)}"`
        );
        decision.intent         = 'CONCEPT_QUESTION';
        decision.inScope        = true;
        decision.needsRetrieval = true;
        decision.responseMode   = 'study_tutor';
        decision._overridden    = true;

        // Retrieval must use the English query — the raw question retrieves 0 chunks.
        decision.searchQuery = decision.englishQuery;
      }
    }

    // --- Phase 3: Session Drift Cap (Step 3.2.2) ---
    // Fires AFTER safety net so academic queries are never blocked.
    // Skips step5/step6 (zero LLM tokens) but routes through step7 for full persistence:
    // history saved, messageCount incremented, totalTokensUsed tracked, session payload returned.
    // Uses 'DRIFT_CAP' intent — not in ACADEMIC_INTENTS or DRIFT_INTENTS — so drift counters
    // are intentionally left unchanged (totalNonAcademicTurns stays at cap, not incremented).
    const DRIFT_CAP_INTENTS = new Set(['GREETING', 'OUT_OF_CONTEXT']);
    if (
      DRIFT_CAP_INTENTS.has(decision.intent) &&
      (context.driftSignal?.totalNonAcademic ?? 0) >= env.maxNonAcademicTurns
    ) {
      console.warn(
        `[DriftCap] Session ${session.sessionId} — total drift ${context.driftSignal.totalNonAcademic} >= max ${env.maxNonAcademicTurns}. Blocking ${decision.intent} turn.`
      );
      const capContent = 'Zuno sirf Science padhaane ke liye hai! Koi bhi topic chunao — Physics, Chemistry, ya Biology — aur hum shuru karte hain.';

      const capDecision  = { ...decision, intent: 'DRIFT_CAP' };
      const capRetrieval = { retrieval: null, chunks: [], sources: [], retrievedContext: 'NO_RETRIEVED_CONTEXT', nextTopicSignal: null, lastRetrievalQuery: null };
      const capResponse  = { status: 'answered', responseMode: 'conversation', title: null, sections: [{ heading: '', content: capContent }], answer: capContent, suggestedActions: [], memoryUpdate: {}, tokenUsage: 0, tokenBreakdown: { input: 0, output: 0, total: 0, cached: 0 } };

      // SSE may already be open (onStage('deciding') above lazily opens it) — if so,
      // this response must go out as the 'end' event, not a plain return, or the
      // controller's `if (streamStarted) return;` will swallow it silently.
      try {
        const capPayload = await saveAndRespond(input, session, context, capDecision, capRetrieval, capResponse, userId, decision.tokenUsage || 0, guestId);
        streamCallbacks?.onComplete?.(capPayload);
        return capPayload;
      } catch {
        // DB failed — student still gets the cap message, session data stays stale
        const capFallback = {
          status: 'answered', intent: 'conversation', responseMode: 'conversation',
          studyMode: input.studyMode, question: input.question,
          detectedLanguage: context.language?.detectedLanguage ?? 'hinglish',
          answerLanguage:   context.language?.answerLanguage   ?? 'hinglish',
          title: null, sections: [{ heading: '', content: capContent }],
          answer: capContent, sources: [], suggestedActions: [],
          retrieval: null, decision: null, session: null,
        };
        streamCallbacks?.onComplete?.(capFallback);
        return capFallback;
      }
    }

    // "searching" only fires for intents that actually fetch teaching content —
    // EXAM_INFO does a JSON lookup (not a search) and GREETING/EMOTIONAL_SUPPORT/etc
    // skip Step 5 entirely, so showing a "searching" phrase for those would be dishonest.
    const CONTENT_FETCHING_INTENTS = new Set(['CONCEPT_QUESTION', 'NEXT_STEP', 'EXPLAIN_MORE']);
    if (CONTENT_FETCHING_INTENTS.has(decision.intent)) {
      streamCallbacks?.onStage?.('searching');
    }

    const retrieval = await retrieveContent(decision, input, session, abortSignal);

    // CHAPTER_COMPLETE skips the Step 6 LLM call entirely (fixed message) — don't
    // show a "generating" phrase for a call that never happens.
    if (retrieval.retrievedContext !== 'CHAPTER_COMPLETE') {
      streamCallbacks?.onStage?.('generating');
    }

    const response = await generateResponse(input, context, decision, retrieval, streamCallbacks, abortSignal);
    const tokenUsage = (decision.tokenUsage || 0) + (response.tokenUsage || 0);
    const finalPayload = await saveAndRespond(input, session, context, decision, retrieval, response, userId, tokenUsage, guestId);
    
    if (streamCallbacks?.onComplete) {
      streamCallbacks.onComplete(finalPayload);
    }
    return finalPayload;

  } catch (error) {

    // Bubble up aborts straight to the controller
    if (error.name === 'AbortError' || error.message === 'Client disconnected' || error.message === 'Timeout') {
      throw error;
    }

    if (error instanceof ProviderUnavailableError) {
      // Calculate how many times this has happened recently
      const effectiveCount = getEffectiveErrorCount(
        session.chatState?.consecutiveErrors,
        session.chatState?.lastErrorAt
      );

      const message = getProviderErrorMessage(
        error.errorType,
        effectiveCount,
        input.question
      );

      // Save updated error count — fire and forget.
      // If this DB call fails, we still return a response to the student.
      updateChatSessionState(session.sessionId, {
        consecutiveErrors: effectiveCount + 1,
        lastErrorAt: new Date(),
      }, userId).catch((e) => console.error('[Orchestrator] consecutiveErrors save failed:', e));

      // SSE may already be open (onStage('deciding') opens it lazily) — route through
      // the 'end' event in that case, same reasoning as the drift cap block above.
      const providerErrorPayload = buildProviderErrorResponse(message, input.question, input.studyMode);
      streamCallbacks?.onComplete?.(providerErrorPayload);
      return providerErrorPayload;
    }

    // Unexpected error (e.g. Step 7 MongoDB failure) — log only, do not increment error count
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
