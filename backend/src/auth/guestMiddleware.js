import { verifyGuestToken } from './guestTokenHelpers.js';

// Legacy bare-UUID guest id shape. Before Phase 1 the browser generated its own
// guest id and sent it raw. During the transition window we still accept those
// so existing guests don't lose their in-flight progress. Removed when
// GUEST_LEGACY_ACCEPT=false (Phase 6 of GUEST_SERVERSIDE_PLAN.md).
const LEGACY_GUEST_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * attachGuest — the single trusted reader of the X-Guest-Id header.
 *
 * Resolves guest identity into `req.guest` and never blocks the request
 * (mirrors optionalAuth's shape and contract).
 *
 * Priority:
 *   1. req.user present            → req.guest = null  (a logged-in student is not a guest)
 *   2. header is a valid signed guest token → req.guest = { id: <gid> }
 *   3. header is a bare legacy UUID and GUEST_LEGACY_ACCEPT !== 'false'
 *                                   → req.guest = { id: <uuid> }   (transition only)
 *   4. anything else               → req.guest = null
 *
 * ORDERING: must run AFTER optionalAuth (it reads req.user) and BEFORE any
 * identity-keyed rate limiter (identityKeyGenerator reads req.guest).
 */
export const attachGuest = (req, _res, next) => {
  if (req.user) {
    req.guest = null;
    return next();
  }

  const raw = req.headers['x-guest-id'];
  let gid = raw ? verifyGuestToken(raw) : null;

  if (
    !gid &&
    raw &&
    process.env.GUEST_LEGACY_ACCEPT !== 'false' &&
    LEGACY_GUEST_UUID.test(String(raw).trim())
  ) {
    gid = String(raw).trim();
  }

  req.guest = gid ? { id: gid } : null;
  return next();
};
