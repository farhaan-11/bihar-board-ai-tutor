import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

/**
 * Server-signed guest identity token.
 *
 * Before this, the browser generated its own guest id (crypto.randomUUID in
 * localStorage) and sent it as X-Guest-Id. That value was forgeable and
 * infinitely rotatable, so the guest turn limit (guest_turns:<gid>) could be
 * bypassed by minting a fresh id per request. A signed token fixes the cause:
 * a valid token can only come from the server, and a new identity requires a
 * call to the IP-rate-limited mint endpoint.
 *
 * The inner `gid` is a plain UUID so every `guestId` column, index and the login
 * claim work unchanged — only the wrapper is new.
 *
 * Signed with GUEST_TOKEN_SECRET, deliberately separate from JWT_ACCESS_SECRET /
 * JWT_REFRESH_SECRET so a leak of one signing key never affects the other tier.
 *
 * The secret is read lazily (a function, not a module-level const) so tests can
 * set the env var before importing this module — mirrors nothing else in the
 * repo only because the JWT helpers read process.env at call time too.
 */
const guestSecret = () => process.env.GUEST_TOKEN_SECRET;

// Long-lived: a guest token only grants a 5-turn allowance, never account access,
// so there is little value in short expiry. If it does lapse the frontend simply
// re-mints. 180d comfortably outlives the 30-day guest_turns counter TTL.
const GUEST_TOKEN_EXPIRY = '180d';

/**
 * Mints a signed guest token wrapping a fresh random gid.
 * @returns {string} signed JWT
 */
export const generateGuestToken = () => {
  return jwt.sign({ t: 'guest', gid: randomUUID() }, guestSecret(), { expiresIn: GUEST_TOKEN_EXPIRY });
};

/**
 * Verifies a guest token.
 * @param {string} token
 * @returns {string|null} the inner gid on success; null on ANY failure
 *   (bad/missing signature, wrong secret, wrong or missing type claim, expired,
 *   malformed, non-string input). Never throws.
 */
export const verifyGuestToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token, guestSecret());
    if (decoded?.t !== 'guest' || typeof decoded.gid !== 'string' || !decoded.gid) {
      return null;
    }
    return decoded.gid;
  } catch {
    return null;
  }
};
