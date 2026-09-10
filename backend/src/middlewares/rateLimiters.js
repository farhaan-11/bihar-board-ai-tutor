import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redis from '../config/redisClient.js';

// Utility to create a standardized JSON response for rate limits
const createRateLimitResponse = (message) => ({
  success: false,
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    message,
  },
});

// Key a limiter bucket by WHO is making the request, not by where from.
// userId for logged-in students, guest id for guests, and only a bare IP when
// neither is present. This is what keeps a whole classroom / coaching centre /
// mobile-carrier network (all sharing one public IP under CGNAT) from sharing a
// single bucket — each student gets their own. The per-request ceiling therefore
// never has to grow with the user count.
// `req.user` is attached by optionalAuth; `req.guest` by attachGuest (the single
// trusted reader of the X-Guest-Id header — a signed guest token, or a legacy
// bare UUID during the transition window). `ipKeyGenerator` is
// express-rate-limit's own IPv6-safe normaliser.
export const identityKeyGenerator = (req) => {
  if (req.user) return `user_${req.user.id}`;
  const guestId = req.guest?.id;
  return guestId ? `guest_${guestId}` : ipKeyGenerator(req.ip);
};

// Each limiter gets its own Redis key namespace via prefix.
// Without unique prefixes, all three limiters would share counters — wrong behavior.
const createRedisStore = (prefix) =>
  new RedisStore({
    sendCommand: async (command, ...args) => redis.call(command, ...args),
    prefix,
  });

// 1. Global API Limiter (Protects against basic scraping and DDoS)
// Max 150 requests per 15 minutes per IP
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_global:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Bahut saari requests aa rahi hain. Kripya thodi der baad try karein.')
    );
  },
});

// 2. Ask API Limiter (Protects expensive LLM endpoints)
// Max 30 requests per 1 minute PER IDENTITY — keyed by userId/guestId, never
// bare IP, so a whole classroom behind one CGNAT/school IP doesn't share a
// bucket. 30/min is far above any real student's asking rate; it only catches
// scripted abuse from a single identity.
export const askApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  keyGenerator: identityKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_ask:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Aap bahut tezi se sawal pooch rahe hain. Ek minute rukiye aur fir try karein.')
    );
  },
});

// 3. Auth API Limiter (Protects against brute force login/OTP/register)
// Max 20 requests per 1 hour per IP
export const authApiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_auth:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Security karan se account access temporarily block kiya gaya hai. 1 ghante baad try karein.')
    );
  },
});

// 4. Quiz Generate Limiter (Protects quiz selection/shuffle work from abuse)
// Max 10 generate calls per minute PER IDENTITY — keyed by userId/guestId, never
// bare IP, so multiple students behind one school/NAT IP don't share a bucket.
export const quizGenerateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  keyGenerator: identityKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_quiz_gen:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Aap bahut tezi se quiz generate kar rahe hain. Ek minute rukiye.')
    );
  },
});

// 5. Quiz Submit Limiter (Protects scoring/attempt-write work from abuse)
// Max 10 submit calls per minute PER IDENTITY — same keying as quizGenerateLimiter.
export const quizSubmitLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  keyGenerator: identityKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_quiz_sub:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Aap bahut tezi se quiz submit kar rahe hain. Ek minute rukiye.')
    );
  },
});

// 6. Quiz History Limiter (Protects read-heavy history listing from abuse)
// Max 30 requests per minute PER IDENTITY — same keying as the other quiz
// limiters, more generous than generate/submit since this is read-only.
export const quizHistoryLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  keyGenerator: identityKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_quiz_hist:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Aap bahut tezi se history dekh rahe hain. Ek minute rukiye.')
    );
  },
});

// 7. Support Submission Limiter (Protects the support form from spam)
// Logged-in users get a higher ceiling (keyed by userId) than guests (keyed by IP).
// Max 5/day for logged-in users, 3/day for guests.
export const supportApiLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: (req) => (req.user ? 5 : 3),
  keyGenerator: (req) => (req.user ? `user_${req.user.id}` : ipKeyGenerator(req.ip)),
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_support:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Aap bahut zyada support requests bhej chuke hain aaj. Kal try karein.')
    );
  },
});

// 8. Guest Mint Limiter (Protects POST /api/v1/auth/guest — the guest-token issuer)
// Keyed by IP because the caller has no identity yet — that is the whole point of
// the endpoint. Deliberately generous: minting is a cheap, stateless, LLM-free op
// with no DB write, and the expensive path (/ask) stays bounded per-token by the
// 5-turn cap. 60/hour/IP lets a full classroom behind one NAT/CGNAT IP each obtain
// a token without throttling real students, while still capping a script that
// tries to farm tokens. Same shape as authApiLimiter (its closest sibling) — no
// custom keyGenerator, so express-rate-limit's default IPv6-safe IP key applies.
export const guestMintLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_guest_mint:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Thodi der baad dobara try karein.')
    );
  },
});
