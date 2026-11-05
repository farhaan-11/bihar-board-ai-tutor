import { verifyAccessToken } from './tokenHelpers.js';
import { verifyGuestToken } from './guestTokenHelpers.js';

// "Bearer abc.def.ghi" -> "abc.def.ghi"
const readBearerToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
};

// I name the caller on req.callerId so the limiters count each student, not each IP.
// I read the token only and never hit the DB — a limiter needs a name, not a user row.
export const attachCallerId = (req, _res, next) => {
  const token = readBearerToken(req.headers.authorization);
  const login = token ? verifyAccessToken(token) : null;

  if (login && login.userId) {
    req.callerId = `user_${login.userId}`;
    return next();
  }

  // No token, or a bad one, leaves callerId null and the limiters fall back to IP.
  const guestId = verifyGuestToken(req.headers['x-guest-id']);
  req.callerId = guestId ? `guest_${guestId}` : null;
  return next();
};
