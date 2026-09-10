/**
 * test-attach-guest.js
 *
 * Phase 2 of GUEST_SERVERSIDE_PLAN.md — attachGuest, the single trusted reader
 * of the X-Guest-Id header.
 *
 * Verifies the middleware contract with mock req objects — no server / DB /
 * Redis / network:
 *   - a valid server-signed guest token resolves to req.guest = { id: <gid> }
 *   - a logged-in request is never treated as a guest
 *   - a missing / garbage / foreign token resolves to req.guest = null
 *   - a legacy bare-UUID header is accepted only while GUEST_LEGACY_ACCEPT !== 'false'
 *   - the middleware never blocks (next is always called, no error)
 *   - two mints = two identities  → the id can no longer be forged, only issued
 */

import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.GUEST_TOKEN_SECRET = 'test-guest-secret-0123456789abcdef0123456789abcdef';

const { attachGuest } = await import('../src/auth/guestMiddleware.js');
const { generateGuestToken } = await import('../src/auth/guestTokenHelpers.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Runs attachGuest synchronously against a mock req; returns { req, nexted }.
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
  const token = generateGuestToken();
  const req = run({ headers: { 'x-guest-id': token } });
  assert.ok(req.guest && typeof req.guest.id === 'string', 'req.guest is populated');
  assert.match(req.guest.id, UUID_RE, 'inner gid is a UUID');
}

// ── 2. No header → req.guest = null ─────────────────────────────────────────
{
  const req = run({ headers: {} });
  assert.equal(req.guest, null);
}

// ── 3. Logged-in request is never a guest (even with a stray header) ────────
{
  const token = generateGuestToken();
  const req = run({ user: { id: 'stu_A' }, headers: { 'x-guest-id': token } });
  assert.equal(req.guest, null, 'req.user present → req.guest must be null');
}

// ── 4. Garbage / foreign-secret token → req.guest = null ────────────────────
{
  assert.equal(run({ headers: { 'x-guest-id': 'not-a-token' } }).guest, null);
  const foreign = jwt.sign({ t: 'guest', gid: 'abc' }, 'some-other-secret');
  assert.equal(run({ headers: { 'x-guest-id': foreign } }).guest, null);
}

// ── 5. Legacy bare UUID — accepted while GUEST_LEGACY_ACCEPT !== 'false' ─────
{
  const legacy = '11111111-2222-3333-4444-555555555555';

  delete process.env.GUEST_LEGACY_ACCEPT; // unset → permissive
  let req = run({ headers: { 'x-guest-id': legacy } });
  assert.deepEqual(req.guest, { id: legacy }, 'unset flag → legacy UUID adopted');

  process.env.GUEST_LEGACY_ACCEPT = 'true';
  req = run({ headers: { 'x-guest-id': legacy } });
  assert.deepEqual(req.guest, { id: legacy }, '"true" → legacy UUID adopted');
}

// ── 6. Legacy bare UUID — rejected once GUEST_LEGACY_ACCEPT === 'false' ─────
{
  const legacy = '11111111-2222-3333-4444-555555555555';
  process.env.GUEST_LEGACY_ACCEPT = 'false';
  const req = run({ headers: { 'x-guest-id': legacy } });
  assert.equal(req.guest, null, 'flag "false" → bare UUID is no longer an identity');
  delete process.env.GUEST_LEGACY_ACCEPT; // restore default for any later test
}

// ── 7. Two mints → two identities (cannot forge, must be issued) ────────────
{
  const a = run({ headers: { 'x-guest-id': generateGuestToken() } }).guest.id;
  const b = run({ headers: { 'x-guest-id': generateGuestToken() } }).guest.id;
  assert.notEqual(a, b, 'each server mint is a distinct identity');
}

// ── 8. A rotated unsigned id is NOT an identity (the P1 fix, in one line) ───
{
  // attacker rotates a fresh fake id per request with the legacy path closed
  process.env.GUEST_LEGACY_ACCEPT = 'false';
  for (let i = 0; i < 5; i++) {
    const fake = `fake-${i}-${Math.random()}`;
    assert.equal(run({ headers: { 'x-guest-id': fake } }).guest, null);
  }
  delete process.env.GUEST_LEGACY_ACCEPT;
}

console.log('\x1b[32m✓ All attach-guest (Phase 2) tests passed\x1b[0m');
