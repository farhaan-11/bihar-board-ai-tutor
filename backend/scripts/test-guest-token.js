/**
 * test-guest-token.js
 *
 * Phase 1 of GUEST_SERVERSIDE_PLAN.md — server-minted guest identity token.
 *
 * The client used to generate its own guest id (crypto.randomUUID in
 * localStorage) and send it as X-Guest-Id. That value was forgeable and
 * infinitely rotatable, so the 5-turn guest cap (guest_turns:<gid>) could be
 * bypassed by minting a fresh id per request.
 *
 * Fix (Rule 4 — remove the cause): the id is now wrapped in a JWT signed with
 * GUEST_TOKEN_SECRET. A valid token can only come from the server; a new
 * identity requires a call to the IP-rate-limited mint endpoint.
 *
 * This test verifies the guestTokenHelpers contract in isolation — no server /
 * DB / Redis / network. A token round-trips to a stable inner gid, and every
 * tamper / wrong-secret / wrong-type / expired / garbage case resolves to null
 * (never a throw, never a usable identity). It also asserts the wiring:
 * POST /api/v1/auth/guest is registered behind guestMintLimiter, and
 * validateEnv() requires GUEST_TOKEN_SECRET.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

// Must be set BEFORE importing the helpers — the secret is read lazily so tests
// can do exactly this.
process.env.GUEST_TOKEN_SECRET = 'test-guest-secret-0123456789abcdef0123456789abcdef';

const { generateGuestToken, verifyGuestToken } = await import('../src/auth/guestTokenHelpers.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 1. Fresh mint → verify round-trips to a UUID gid ─────────────────────────
{
  const token = generateGuestToken();
  const gid = verifyGuestToken(token);
  assert.ok(gid, 'a freshly minted token must verify');
  assert.match(gid, UUID_RE, 'the inner gid is a UUID');
}

// ── 2. Two mints are two distinct identities ─────────────────────────────────
{
  const a = verifyGuestToken(generateGuestToken());
  const b = verifyGuestToken(generateGuestToken());
  assert.notEqual(a, b, 'each mint allocates a new gid');
}

// ── 3. Garbage / empty / non-string input → null, never a throw ──────────────
{
  for (const bad of ['', null, undefined, 'not-a-jwt', 'a.b.c', 42, {}, []]) {
    assert.equal(verifyGuestToken(bad), null, `rejects ${JSON.stringify(bad)}`);
  }
}

// ── 4. Tampered payload → signature mismatch → null ──────────────────────────
{
  const token = generateGuestToken();
  const parts = token.split('.');
  parts[1] = parts[1].slice(0, -2) + (parts[1].slice(-2) === 'AA' ? 'BB' : 'AA');
  assert.equal(verifyGuestToken(parts.join('.')), null, 'a tampered token is rejected');
}

// ── 5. Signed with a different secret → null ─────────────────────────────────
{
  const foreign = jwt.sign({ t: 'guest', gid: 'abc' }, 'some-other-secret-not-ours');
  assert.equal(verifyGuestToken(foreign), null, 'a foreign-secret token is rejected');
}

// ── 6. Right secret, wrong / missing type claim → null ───────────────────────
{
  const asUser = jwt.sign({ t: 'user', userId: 'u1' }, process.env.GUEST_TOKEN_SECRET);
  assert.equal(verifyGuestToken(asUser), null, 'a non-guest token type is rejected');

  const noType = jwt.sign({ gid: 'g1' }, process.env.GUEST_TOKEN_SECRET);
  assert.equal(verifyGuestToken(noType), null, 'a missing type claim is rejected');

  const noGid = jwt.sign({ t: 'guest' }, process.env.GUEST_TOKEN_SECRET);
  assert.equal(verifyGuestToken(noGid), null, 'a missing gid is rejected');
}

// ── 7. Expired token → null ─────────────────────────────────────────────────
{
  const expired = jwt.sign({ t: 'guest', gid: 'g1' }, process.env.GUEST_TOKEN_SECRET, { expiresIn: -10 });
  assert.equal(verifyGuestToken(expired), null, 'an expired token is rejected');
}

// ── 8. Wiring: route registered + limiter applied + env required ─────────────
{
  const routes = readFileSync(
    fileURLToPath(new URL('../src/routes/auth.routes.js', import.meta.url)),
    'utf8',
  );
  assert.match(
    routes,
    /router\.post\(\s*['"]\/guest['"]\s*,\s*guestMintLimiter\s*,\s*issueGuestToken\s*\)/,
    'POST /guest must be registered behind guestMintLimiter',
  );

  const limiters = readFileSync(
    fileURLToPath(new URL('../src/middlewares/rateLimiters.js', import.meta.url)),
    'utf8',
  );
  assert.match(limiters, /export const guestMintLimiter\s*=\s*rateLimit\(/, 'guestMintLimiter is exported');

  const envSrc = readFileSync(
    fileURLToPath(new URL('../src/config/env.js', import.meta.url)),
    'utf8',
  );
  assert.match(
    envSrc,
    /missing\.push\(\s*['"]GUEST_TOKEN_SECRET['"]\s*\)/,
    'validateEnv() must require GUEST_TOKEN_SECRET',
  );
}

console.log('\x1b[32m✓ All guest-token tests passed\x1b[0m');
