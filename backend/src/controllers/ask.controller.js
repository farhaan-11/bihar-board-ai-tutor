import { askQuestion } from '../ask/askOrchestrator.js';
import { sendResponse } from '../utils/sendResponse.js';

export const askQuestionController = async (req, res, next) => {
  let streamStarted = false;
  let timeoutId = null;
  const abortController = new AbortController();

  // Detect early client disconnect (browser closed/refreshed)
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

    // Set a hard 60-second timeout for the LLM pipeline
    timeoutId = setTimeout(() => {
      console.warn(`[Ask API] Request hit 60s hard timeout. Aborting...`);
      abortController.abort(new Error('Timeout'));
    }, 60000);
    // Opens the SSE pipe on first use — safe to call more than once (e.g. once
    // from an early onStage() during Step 4/5, and again from Step 6's own
    // onStreamStart() call) since the streamStarted guard makes it a no-op
    // after the first call.
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

    // Handle our explicit AbortController errors
    if (error.name === 'AbortError' || error.message === 'Client disconnected' || error.message === 'Timeout') {
      const errorMsg = error.message === 'Timeout' 
        ? 'Sorry, lagta hai network thoda slow hai. Mujhe answer laane mein zyada time lag gaya! Ek baar wapas poochho, main try karta hoon.' 
        : 'Request cancel kar di gayi.';

      if (streamStarted) {
        // Safe closure if headers were already sent
        res.write(`data: ${JSON.stringify({ event: 'end', payload: { status: 'cancelled', answer: errorMsg, sources: [] } })}\n\n`);
        return res.end();
      } else {
        // Standard JSON response if headers weren't sent
        if (error.message === 'Client disconnected') return res.end();
        return sendResponse(res, 504, { message: errorMsg });
      }
    }

    return next(error);
  }
};
