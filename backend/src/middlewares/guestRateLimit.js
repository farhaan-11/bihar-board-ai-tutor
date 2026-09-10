import redis from '../config/redisClient.js';
import { env } from '../config/env.js';

export const guestRateLimit = async (req, res, next) => {
  // Logged-in users are not subject to the guest turn limit
  if (req.user) return next();

  // Skip in development so guest limit doesn't block local testing
  if (process.env.NODE_ENV === 'development') return next();

  // attachGuest resolves the X-Guest-Id header into req.guest — a verified
  // signed-token gid or a legacy UUID, already shape-validated. No identity here
  // means no valid token/legacy id was presented.
  const guestId = req.guest?.id;

  if (!guestId) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_GUEST_ID',
        message: 'Valid guest ID required.',
        statusCode: 400,
      },
    });
  }

  try {
    const count = parseInt((await redis.get(`guest_turns:${guestId}`)) || '0', 10);
    if (count >= env.guestTurnLimit) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'GUEST_LIMIT_REACHED',
          message: 'Guest limit ho gayi. Login karke padhai jaari rakho!',
          statusCode: 429,
        },
      });
    }
    next();
  } catch (err) {
    // Redis outage — fail open so students are not blocked
    console.error('[guestRateLimit] Redis check failed, failing open:', err.message);
    next();
  }
};
