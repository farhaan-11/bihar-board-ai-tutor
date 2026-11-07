import { askQuestion } from '../ask/askOrchestrator.js';
import { sendResponse } from '../utils/sendResponse.js';

export const askQuestionController = async (req, res, next) => {
  let streamStarted = false;
  let timeoutId = null;
  const abortController = new AbortController();

  // If the student closes or refreshes the tab, I stop the pipeline instead of
  // paying for an LLM answer nobody will read.
  req.on('close', () => {
    if (!res.writableEnded) {
      console.warn(`[Ask API] Client disconnected early. Aborting request...`);
      abortController.abort(new Error('Client disconnected'));
    }
  });

  try {
    const userId = req.user?.id || null;
    // req.guest is set by attachGuest (already null when req.user is present)
    const guestId = req.guest?.id || null;

    // A hard stop for the whole pipeline, so a hung LLM call cannot leave the
    // student staring at a spinner forever.
    timeoutId = setTimeout(() => {
      console.warn(`[Ask API] Request hit 60s hard timeout. Aborting...`);
      abortController.abort(new Error('Timeout'));
    }, 60000);
    // Opens the SSE pipe. Several places call this — an early onStage() during
    // Step 4/5, then Step 6's own onStreamStart() — so the streamStarted guard
    // makes every call after the first one a no-op.
    const openStream = () => {
      if (streamStarted) return;
      streamStarted = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.flushHeaders();
    };

    const streamCallbacks = {
      onStreamStart: openStream,
      onStage: (stage) => {
        openStream();
        res.write(`data: ${JSON.stringify({ event: 'stage', stage })}\n\n`);
      },
      onToken: (chunk) => {
        if (streamStarted) {
          res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
        }
      },
      onComplete: (finalPayload) => {
        if (streamStarted) {
          res.write(`data: ${JSON.stringify({ event: 'end', payload: finalPayload })}\n\n`);
          res.end();
        }
      }
    };

    const answerPayload = await askQuestion(
      req.body, 
      { userId, guestId }, 
      streamCallbacks, 
      abortController.signal
    );

    clearTimeout(timeoutId);

    if (streamStarted) {
      return;
    }

    return sendResponse(res, 200, {
      message: 'Question processed successfully.',
      data: answerPayload,
    });
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    // The two aborts I raise myself, above: a closed tab and the hard timeout.
    if (error.name === 'AbortError' || error.message === 'Client disconnected' || error.message === 'Timeout') {
      const studentMessage = error.message === 'Timeout'
        ? 'Sorry, lagta hai network thoda slow hai. Mujhe answer laane mein zyada time lag gaya! Ek baar wapas poochho, main try karta hoon.'
        : 'Request cancel kar di gayi.';

      if (streamStarted) {
        // Headers already went out, so I close the stream politely instead.
        res.write(`data: ${JSON.stringify({ event: 'end', payload: { status: 'cancelled', answer: studentMessage, sources: [] } })}\n\n`);
        return res.end();
      } else {
        // Nothing sent yet, so a normal JSON reply still works.
        if (error.message === 'Client disconnected') return res.end();
        return sendResponse(res, 504, { message: studentMessage });
      }
    }

    return next(error);
  }
};
