/**
 * test-attach-guest.js
 *
 * attachGuest — the single reader of the X-Guest-Id header (GUEST_SERVERSIDE_PLAN.md).
 *
 * Verifies the middleware contract with mock req objects — no server / DB /
 * Redis / network:
 *   - a valid server-signed guest token resolves to req.guest = { id: <gid> }
 *   - a logged-in request is never treated as a guest
 *   - a missing / garbage / foreign / bare-UUID token resolves to req.guest = null
 *   - the middleware never blocks (next is always called, no error)
 *   - two mints = two identities  → the id can only be issued, never forged
 */

import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.GUEST_TOKEN_SECRET = 'test-guest-secret-0123456789abcdef0123456789abcdef';

const { attachGuest } = await import('../src/auth/guestMiddleware.js');
const { generateGuestToken } = await import('../src/auth/guestTokenHelpers.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Runs attachGuest synchronously against a mock req; returns the mutated req.
const run = (req) => {
  let nexted = false;
  attachGuest(req, {}, (err) => {
    assert.equal(err, undefined, 'attachGuest must never pass an error to next()');
    nexted = true;
  });
  assert.equal(nexted, true, 'attachGuest must always call next()');
  return req;
};

// ── 1. Valid signed token → req.guest = { id: gid } ─────────────────────────
{
  const req = run({ headers: { 'x-guest-id': generateGuestToken() } });
  assert.ok(req.guest && typeof req.guest.id === 'string', 'req.guest is populated');
  assert.match(req.guest.id, UUID_RE, 'inner gid is a UUID');
}

// ── 2. No header → req.guest = null ─────────────────────────────────────────
{
  assert.equal(run({ headers: {} }).guest, null);
}

// ── 3. Logged-in request is never a guest (even with a stray token header) ──
{
  const req = run({ user: { id: 'stu_A' }, headers: { 'x-guest-id': generateGuestToken() } });
  assert.equal(req.guest, null, 'req.user present → req.guest must be null');
}

// ── 4. Garbage / foreign-secret / bare-UUID header → req.guest = null ───────
{
  assert.equal(run({ headers: { 'x-guest-id': 'not-a-token' } }).guest, null);

  const foreign = jwt.sign({ t: 'guest', gid: 'abc' }, 'some-other-secret');
  assert.equal(run({ headers: { 'x-guest-id': foreign } }).guest, null);

  // a bare legacy UUID is no longer an identity (Phase 6 removed that path)
  assert.equal(run({ headers: { 'x-guest-id': '11111111-2222-3333-4444-555555555555' } }).guest, null);
}

// ── 5. Two mints → two identities (cannot forge, must be issued) ────────────
{
  const a = run({ headers: { 'x-guest-id': generateGuestToken() } }).guest.id;
  const b = run({ headers: { 'x-guest-id': generateGuestToken() } }).guest.id;
  assert.notEqual(a, b, 'each server mint is a distinct identity');
}

// ── 6. A rotated fake id is NOT an identity (the P1 fix, in one line) ──────
{
  for (let i = 0; i < 5; i++) {
    const fake = `fake-${i}-${Math.random()}`;
    assert.equal(run({ headers: { 'x-guest-id': fake } }).guest, null);
  }
}

console.log('\x1b[32m✓ All attach-guest tests passed\x1b[0m');
