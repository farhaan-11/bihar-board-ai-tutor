/**
 * test-guest-session-stamp.js
 *
 * Phase 3 of GUEST_SERVERSIDE_PLAN.md — stamp guestId onto chat sessions.
 *
 * Before this, chat_sessions had no guest link at all (userId only, null for
 * guests), so a guest's chat could never be found or claimed on login. This
 * verifies updateChatSession() now writes guestId on creation, via $setOnInsert
 * (so it is immutable after the first turn, exactly like userId / sessionType),
 * and that the partial guest index is declared.
 *
 * Live DB test — needs MONGODB_URI. Cleans up after itself.
 * Run: npm run test:guest-session-stamp   (from backend/)
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';
import { ChatSession } from '../src/models/chatSession.model.js';
import { updateChatSession, findChatSession } from '../src/services/chatSession.service.js';

const cleanup = [];
const track = (id) => { cleanup.push(id); return id; };

const turn = (sessionId, meta) =>
  updateChatSession(
    sessionId,
    { chatStateSet: { answerLanguage: 'hinglish' }, chatStateInc: { messageCount: 1 } },
    meta,
  );

try {
  await connectDB();

  // ── 1. A guest turn stamps guestId, leaves userId null ────────────────────
  {
    const sid = track(randomUUID());
    const gid = `guest-${randomUUID()}`;
    await turn(sid, { userId: null, guestId: gid, sessionType: 'global' });

    const doc = await findChatSession(sid);
    assert.equal(doc.guestId, gid, 'guest session must carry its guestId');
    assert.equal(doc.userId, null, 'guest session userId stays null');
    assert.equal(doc.mode, 'guest', 'guest session mode is "guest"');
    console.log('  ✅ guest turn → { guestId: <gid>, userId: null, mode: "guest" }');
  }

  // ── 2. A logged-in turn writes userId, leaves guestId null ────────────────
  {
    const sid = track(randomUUID());
    const uid = `user-${randomUUID().slice(0, 8)}`;
    await turn(sid, { userId: uid, guestId: null, sessionType: 'global' });

    const doc = await findChatSession(sid);
    assert.equal(doc.userId, uid, 'logged-in session carries userId');
    assert.equal(doc.guestId, null, 'logged-in session guestId stays null');
    assert.equal(doc.mode, 'logged_in', 'logged-in session mode is "logged_in"');
    console.log('  ✅ logged-in turn → { userId: <uid>, guestId: null, mode: "logged_in" }');
  }

  // ── 3. guestId is immutable after creation ($setOnInsert) ─────────────────
  {
    const sid = track(randomUUID());
    const gid1 = `guest-${randomUUID()}`;
    const gid2 = `guest-${randomUUID()}`;
    await turn(sid, { userId: null, guestId: gid1, sessionType: 'global' });
    await turn(sid, { userId: null, guestId: gid2, sessionType: 'global' }); // must NOT overwrite

    const doc = await findChatSession(sid);
    assert.equal(doc.guestId, gid1, 'guestId must stay the value set on the first turn');
    assert.equal(doc.chatState.messageCount, 2, 'the second turn still applied its $inc');
    console.log('  ✅ second turn with a different guestId does not overwrite the first');
  }

  // ── 4. A session with no identity still works (guestId defaults to null) ──
  {
    const sid = track(randomUUID());
    await turn(sid, { sessionType: 'global' }); // no userId, no guestId
    const doc = await findChatSession(sid);
    assert.equal(doc.guestId, null);
    assert.equal(doc.userId, null);
    console.log('  ✅ identity-less turn → guestId defaults to null, no error');
  }

  // ── 5. Partial guest index is declared on the schema ──────────────────────
  {
    const hasGuestIndex = ChatSession.schema.indexes().some(
      ([fields, opts]) =>
        fields.guestId === 1 &&
        opts?.partialFilterExpression?.guestId?.$type === 'string',
    );
    assert.ok(hasGuestIndex, 'schema must declare a partial { guestId: 1 } index');
    console.log('  ✅ partial { guestId: 1 } index declared');
  }

  console.log('\x1b[32m✓ All guest-session-stamp (Phase 3) tests passed\x1b[0m');
} catch (err) {
  console.error(`\n  FAILED ❌  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  if (cleanup.length) {
    await ChatSession.deleteMany({ sessionId: { $in: cleanup } });
    console.log(`Cleaned up ${cleanup.length} test document(s).`);
  }
  await disconnectDB();
}
