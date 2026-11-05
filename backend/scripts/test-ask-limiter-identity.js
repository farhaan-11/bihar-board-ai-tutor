/**
 * Regression test for BUG-8: two students behind one school IP must never share
 * a rate-limit bucket. Runs the real chain — attachCallerId reads a signed token,
 * identityKeyGenerator turns it into a bucket key. No server, DB, Redis or network.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ipKeyGenerator } from 'express-rate-limit';

import { attachCallerId } from '../src/auth/callerIdMiddleware.js';
import { identityKeyGenerator, askApiLimiter } from '../src/middlewares/rateLimiters.js';
import { generateAccessToken } from '../src/auth/tokenHelpers.js';
import { generateGuestToken } from '../src/auth/guestTokenHelpers.js';

// Both helpers read the secret at call time, so setting it after the imports works.
process.env.JWT_ACCESS_SECRET = 'test-access-secret-for-limiter-keys';
process.env.GUEST_TOKEN_SECRET = 'test-guest-secret-for-limiter-keys';

const SCHOOL_IP = '203.0.113.7'; // one public IP, shared by a whole classroom

// I build the request like express would and run attachCallerId over it, so these
// assertions cover the real chain instead of the key function on its own.
const keyFor = ({ login = null, guest = null, ip = SCHOOL_IP } = {}) => {
  const headers = {};
  if (login) headers.authorization = `Bearer ${login}`;
  if (guest) headers['x-guest-id'] = guest;

  const req = { headers, ip };
  attachCallerId(req, null, () => {});
  return identityKeyGenerator(req);
};

// ── 1. Two logged-in students behind ONE IP get TWO buckets ──────────────────
{
  const a = keyFor({ login: generateAccessToken('stu_A') });
  const b = keyFor({ login: generateAccessToken('stu_B') });
  assert.notEqual(a, b, 'BUG-8: two logged-in students on one IP must not share a bucket');
  assert.equal(a, 'user_stu_A');
  assert.equal(b, 'user_stu_B');
}

// ── 2. Two guests behind ONE IP get TWO buckets ─────────────────────────────
{
  const a = keyFor({ guest: generateGuestToken() });
  const b = keyFor({ guest: generateGuestToken() });
  assert.notEqual(a, b, 'BUG-8: two guests on one IP must not share a bucket');
  assert.match(a, /^guest_/);
  assert.match(b, /^guest_/);
}

// ── 3. One student keeps ONE bucket across networks (home ↔ school) ─────────
{
  const token = generateAccessToken('stu_A');
  const home = keyFor({ login: token, ip: '198.51.100.42' });
  const school = keyFor({ login: token, ip: SCHOOL_IP });
  assert.equal(home, school, 'one identity is one bucket, whatever the network');
}

// ── 4. A logged-in student is never counted as a guest ──────────────────────
{
  const k = keyFor({ login: generateAccessToken('stu_A'), guest: generateGuestToken() });
  assert.equal(k, 'user_stu_A', 'the login token wins over a stray guest header');
}

// ── 5. No token, or a forged one, falls back to the IP key ──────────────────
// This is what stops an attacker farming fresh buckets with made-up ids.
{
  assert.equal(keyFor(), ipKeyGenerator(SCHOOL_IP), 'no token → normalised IP key');
  assert.equal(keyFor({ login: 'not.a.real.token' }), ipKeyGenerator(SCHOOL_IP), 'forged login → IP key');
  assert.equal(keyFor({ guest: 'made-up-guest-id' }), ipKeyGenerator(SCHOOL_IP), 'unsigned guest id → IP key');
}

// ── 6. Wiring: askApiLimiter is actually attached to identityKeyGenerator ───
// BUG-8 was a MISSING keyGenerator, so proving the function exists is not enough.
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
