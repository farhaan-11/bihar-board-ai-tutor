import { verifyGuestToken } from './guestTokenHelpers.js';

// Legacy bare-UUID guest id shape. Before Phase 1 the browser generated its own
// guest id and sent it raw. During the transition window we still accept those
// so existing guests don't lose their in-flight progress. Removed when
// GUEST_LEGACY_ACCEPT=false (Phase 6 of GUEST_SERVERSIDE_PLAN.md).
const LEGACY_GUEST_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves an X-Guest-Id header value into a guest id string, or null.
 *
 *   - a valid server-signed guest token  → its inner gid
 *   - a bare legacy UUID, while GUEST_LEGACY_ACCEPT !== 'false'  → that UUID (transition only)
 *   - anything else  → null
 *
 * Shared by attachGuest (per-request identity) and the login claim, so both
 * agree on what counts as a guest identity and both stop honouring the legacy
 * shape at the same moment (Phase 6 flips the flag).
 */
export const resolveGuestIdFromHeader = (raw) => {
  if (!raw) return null;

  const gid = verifyGuestToken(raw);
  if (gid) return gid;

  if (
    process.env.GUEST_LEGACY_ACCEPT !== 'false' &&
    LEGACY_GUEST_UUID.test(String(raw).trim())
  ) {
    return String(raw).trim();
  }

  return null;
};

/**
 * attachGuest — the single trusted reader of the X-Guest-Id header for
 * per-request identity.
 *
 * Resolves guest identity into `req.guest` and never blocks the request
 * (mirrors optionalAuth's shape and contract).
 *
 * Priority:
 *   1. req.user present  → req.guest = null  (a logged-in student is not a guest)
 *   2. resolveGuestIdFromHeader(header) → req.guest = { id: <gid> } or null
 *
 * ORDERING: must run AFTER optionalAuth (it reads req.user) and BEFORE any
 * identity-keyed rate limiter (identityKeyGenerator reads req.guest).
 */
export const attachGuest = (req, _res, next) => {
  if (req.user) {
    req.guest = null;
    return next();
  }

  const gid = resolveGuestIdFromHeader(req.headers['x-guest-id']);
  req.guest = gid ? { id: gid } : null;
  return next();
};
