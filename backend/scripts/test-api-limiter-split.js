/**
 * Regression test for BUG-8b / BACKLOG R6: the app-level limiter used to do two
 * jobs with one key, so a whole classroom shared 150 requests. It is now two
 * limiters — one counts per student, one per IP. No server, DB, Redis or network.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ipKeyGenerator } from 'express-rate-limit';

import { attachCallerId } from '../src/auth/callerIdMiddleware.js';
import { identityKeyGenerator, perStudentApiLimiter, perIpApiLimiter } from '../src/middlewares/rateLimiters.js';
import { generateAccessToken } from '../src/auth/tokenHelpers.js';

process.env.JWT_ACCESS_SECRET = 'test-access-secret-for-limiter-split';

const SCHOOL_IP = '203.0.113.7';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const limitersSource = readSource('../src/middlewares/rateLimiters.js');
const appSource = readSource('../src/app.js');

const blockFor = (exportName) => {
  const from = limitersSource.indexOf(`export const ${exportName}`);
  assert.notEqual(from, -1, `${exportName} must be exported`);
  const block = limitersSource.slice(from);
  return block.slice(0, block.indexOf('});') + 3);
};

// ── 1. A whole classroom no longer shares one bucket ────────────────────────
// This is the bug itself: 20 students on one school IP used to land on one key.
{
  const keys = new Set();
  for (let i = 0; i < 20; i += 1) {
    const req = { headers: { authorization: `Bearer ${generateAccessToken(`stu_${i}`)}` }, ip: SCHOOL_IP };
    attachCallerId(req, null, () => {});
    keys.add(identityKeyGenerator(req));
  }
  assert.equal(keys.size, 20, 'BUG-8b: 20 students on one IP must get 20 separate buckets');
  assert.equal(keys.has(ipKeyGenerator(SCHOOL_IP)), false, 'no student should fall back to the IP key');
}

// ── 2. The two limiters really are keyed differently ────────────────────────
// If both ended up on the same key, we would be back to one limiter doing two jobs.
{
  assert.match(
    blockFor('perStudentApiLimiter'),
    /keyGenerator:\s*identityKeyGenerator/,
    'perStudentApiLimiter must count per student',
  );
  assert.equal(
    /keyGenerator/.test(blockFor('perIpApiLimiter')),
    false,
    'perIpApiLimiter must stay on the default IP key — that is its whole job',
  );
}

// ── 3. Separate Redis namespaces, or the two would share one counter ────────
{
  assert.match(blockFor('perStudentApiLimiter'), /createRedisStore\('rl_student:'\)/);
  assert.match(blockFor('perIpApiLimiter'), /createRedisStore\('rl_ip:'\)/);
}

// ── 4. The per-IP ceiling has to clear a real classroom ─────────────────────
// 30 students * ~60 requests in a 15 minute window is about 1,800.
{
  const perIpMax = Number(blockFor('perIpApiLimiter').match(/max:\s*(\d+)/)[1]);
  assert.ok(perIpMax >= 2000, `per-IP ceiling ${perIpMax} is too low for a 30-student classroom`);
}

// ── 5. Wiring: attachCallerId must run BEFORE the per-student limiter ───────
// Without this order the limiter silently falls back to IP and the bug returns
// with no error anywhere. This guard is the reason that cannot happen quietly.
{
  const mount = appSource.match(/app\.use\('\/api',([^)]*)\)/);
  assert.notEqual(mount, null, 'app.js must still mount middleware on /api');

  const order = mount[1];
  assert.ok(order.includes('attachCallerId'), 'attachCallerId must be mounted on /api');
  assert.ok(order.includes('perStudentApiLimiter'), 'perStudentApiLimiter must be mounted on /api');
  assert.ok(order.includes('perIpApiLimiter'), 'perIpApiLimiter must be mounted on /api');
  assert.ok(
    order.indexOf('attachCallerId') < order.indexOf('perStudentApiLimiter'),
    'attachCallerId must come first, or the per-student limiter has no name to count',
  );
}

// ── 6. The old single limiter is gone, not just renamed around ──────────────
{
  assert.equal(
    /globalApiLimiter/.test(limitersSource) || /globalApiLimiter/.test(appSource),
    false,
    'globalApiLimiter was replaced by the split — no reference should remain',
  );
}

assert.equal(typeof perStudentApiLimiter, 'function');
assert.equal(typeof perIpApiLimiter, 'function');

console.log('\x1b[32m✓ All api-limiter-split (BUG-8b / R6) tests passed\x1b[0m');
