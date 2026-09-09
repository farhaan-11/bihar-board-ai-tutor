/**
 * test-ask-limiter-identity.js
 *
 * Regression test for BUG-8 (PROJECT_STATE.md §4 / STAGE1_DONE.md Section C).
 *
 * BUG-8: askApiLimiter had no keyGenerator, so express-rate-limit fell back to
 * keying the 30-req/min bucket by raw client IP. Under CGNAT / school / coaching
 * / mobile-carrier networks, hundreds of students share one public IP — so they
 * shared ONE bucket. Five students asking six questions each in a minute would
 * 429 the sixth student for something the other five did.
 *
 * The quiz limiters (quizGenerateLimiter etc.) never had this bug — they key by
 * userId / guestId and only fall back to IP when neither is present.
 *
 * Fix (Rule 4 — remove the cause, no new guard/cap): the quiz limiters' inline
 * keyGenerator is extracted to one shared `identityKeyGenerator` export, and
 * askApiLimiter now uses it. The 30/min number is unchanged — it is now measured
 * per student instead of per IP, so it never needs to grow with user count.
 *
 * No server / DB / Redis / LLM call — imports the pure key function + reads the
 * module source for the wiring assertion.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { identityKeyGenerator, askApiLimiter } from '../src/middlewares/rateLimiters.js';

// express-rate-limit's own IPv6-safe helper — identityKeyGenerator must reuse it
// for the fallback so a bare-IP key is still normalised the same way.
import { ipKeyGenerator } from 'express-rate-limit';

const SCHOOL_IP = '203.0.113.7'; // one public IP, shared by a whole classroom

// ── 1. Two logged-in students behind ONE IP get TWO buckets ──────────────────
{
  const a = identityKeyGenerator({ user: { id: 'stu_A' }, headers: {}, ip: SCHOOL_IP });
  const b = identityKeyGenerator({ user: { id: 'stu_B' }, headers: {}, ip: SCHOOL_IP });
  assert.notEqual(a, b, 'BUG-8: two logged-in users on one IP must not share a bucket');
  assert.equal(a, 'user_stu_A');
  assert.equal(b, 'user_stu_B');
}

// ── 2. Two guests behind ONE IP get TWO buckets ─────────────────────────────
{
  const a = identityKeyGenerator({ user: null, headers: { 'x-guest-id': 'guest-A' }, ip: SCHOOL_IP });
  const b = identityKeyGenerator({ user: null, headers: { 'x-guest-id': 'guest-B' }, ip: SCHOOL_IP });
  assert.notEqual(a, b, 'BUG-8: two guests on one IP must not share a bucket');
  assert.equal(a, 'guest_guest-A');
  assert.equal(b, 'guest_guest-B');
}

// ── 3. A logged-in user keeps ONE bucket across different IPs (home ↔ school) ─
{
  const home = identityKeyGenerator({ user: { id: 'stu_A' }, headers: {}, ip: '198.51.100.42' });
  const school = identityKeyGenerator({ user: { id: 'stu_A' }, headers: {}, ip: SCHOOL_IP });
  assert.equal(home, school, 'a single identity must be one bucket regardless of network');
}

// ── 4. Logged-in identity wins over a stray guest header ────────────────────
{
  const k = identityKeyGenerator({ user: { id: 'stu_A' }, headers: { 'x-guest-id': 'guest-X' }, ip: SCHOOL_IP });
  assert.equal(k, 'user_stu_A', 'req.user must take priority over x-guest-id');
}

// ── 5. No identity at all → fall back to the IPv6-safe IP key ───────────────
{
  const k = identityKeyGenerator({ user: null, headers: {}, ip: SCHOOL_IP });
  assert.equal(k, ipKeyGenerator(SCHOOL_IP), 'no user + no guest id → normalised IP key');
}

// ── 6. Wiring: askApiLimiter actually uses identityKeyGenerator ─────────────
// The bug was a MISSING keyGenerator, so the regression guard has to prove the
// limiter is wired to the identity function, not just that the function exists.
{
  assert.equal(typeof askApiLimiter, 'function', 'askApiLimiter middleware is exported');

  const src = readFileSync(
    fileURLToPath(new URL('../src/middlewares/rateLimiters.js', import.meta.url)),
    'utf8',
  );
  const askBlock = src.slice(src.indexOf('export const askApiLimiter'));
  const askBlockBody = askBlock.slice(0, askBlock.indexOf('});') + 3);
  assert.match(
    askBlockBody,
    /keyGenerator:\s*identityKeyGenerator/,
    'BUG-8: askApiLimiter must set keyGenerator: identityKeyGenerator',
  );
}

console.log('\x1b[32m✓ All ask-limiter-identity (BUG-8) tests passed\x1b[0m');
