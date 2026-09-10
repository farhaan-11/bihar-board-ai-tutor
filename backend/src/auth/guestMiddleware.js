import { verifyGuestToken } from './guestTokenHelpers.js';

/**
 * attachGuest — the single reader of the X-Guest-Id header.
 *
 * Resolves guest identity into `req.guest` and never blocks the request
 * (mirrors optionalAuth's shape and contract).
 *
 *   1. req.user present            → req.guest = null  (a logged-in student is not a guest)
 *   2. header is a valid server-signed guest token → req.guest = { id: <gid> }
 *   3. anything else               → req.guest = null
 *
 * Only a server-signed token counts — the browser can no longer present a
 * self-chosen id. (The one-release transition that also accepted a legacy bare
 * UUID was removed in Phase 6 of GUEST_SERVERSIDE_PLAN.md.)
 *
 * ORDERING: must run AFTER optionalAuth (it reads req.user) and BEFORE any
 * identity-keyed rate limiter (identityKeyGenerator reads req.guest).
 */
export const attachGuest = (req, _res, next) => {
  if (req.user) {
    req.guest = null;
    return next();
  }

  const gid = verifyGuestToken(req.headers['x-guest-id']);
  req.guest = gid ? { id: gid } : null;
  return next();
};
