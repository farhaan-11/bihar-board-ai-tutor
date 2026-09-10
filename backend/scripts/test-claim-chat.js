/**
 * test-claim-chat.js
 *
 * Phase 4 of GUEST_SERVERSIDE_PLAN.md — claim a guest's chat on login. This is
 * the fix for P2 (a guest's chat was invisible after signing up).
 *
 * claimGuestData() already moved chapter_progress / study_events / quiz history.
 * It now also flips chat_sessions ownership (guestId -> userId) and syncs
 * chat_history.userId. chat_history messages follow automatically because that
 * collection is keyed only by sessionId.
 *
 * Live DB test — needs MONGODB_URI. Cleans up after itself.
 * Run: npm run test:claim-chat   (from backend/)
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';
import { ChatSession } from '../src/models/chatSession.model.js';
import { ChatHistory } from '../src/models/chatHistory.model.js';
import {
  updateChatSession,
  findChatSession,
  getSessionsByUser,
} from '../src/services/chatSession.service.js';
import { addChatMessages } from '../src/services/chatHistory.service.js';
import { claimGuestData } from '../src/services/chapterProgress.service.js';

const sessionIds = [];
const userIds = [];
const track = (sid) => { sessionIds.push(sid); return sid; };

const seedGuestChat = async (gid, { turns = 1 } = {}) => {
  const sid = track(randomUUID());
  for (let i = 0; i < turns; i++) {
    await updateChatSession(
      sid,
      { chatStateSet: { answerLanguage: 'hinglish' }, chatStateInc: { messageCount: 1 } },
      { userId: null, guestId: gid, sessionType: 'global' },
    );
    await addChatMessages(sid, [
      { role: 'student', text: `q${i}` },
      { role: 'tutor', text: `a${i}` },
    ]);
  }
  return sid;
};

try {
  await connectDB();

  // ── 1. A guest's chat sessions + history transfer to the user ─────────────
  {
    const gid = `guest-${randomUUID()}`;
    const uid = `user-${randomUUID().slice(0, 8)}`;
    userIds.push(uid);

    const sidA = await seedGuestChat(gid, { turns: 2 });
    const sidB = await seedGuestChat(gid, { turns: 1 });

    const result = await claimGuestData(uid, gid);
    assert.equal(result.chatSessionsTransferred, 2, 'both guest sessions were transferred');

    for (const sid of [sidA, sidB]) {
      const s = await findChatSession(sid);
      assert.equal(s.userId, uid, `${sid}: userId flipped to the user`);
      assert.equal(s.guestId, null, `${sid}: guestId cleared`);
      assert.equal(s.mode, 'logged_in', `${sid}: mode is logged_in`);

      const h = await ChatHistory.findOne({ sessionId: sid }).lean();
      assert.equal(h.userId, uid, `${sid}: chat_history.userId synced`);
      assert.ok(h.messages.length >= 2, `${sid}: messages still present (${h.messages.length})`);
    }

    const listed = await getSessionsByUser(uid);
    const listedIds = listed.map((s) => s.sessionId);
    assert.ok(listedIds.includes(sidA) && listedIds.includes(sidB),
      'both claimed sessions now appear in the user sidebar query');
    console.log('  ✅ guest chat sessions + history transfer; both show in getSessionsByUser');
  }

  // ── 2. A pre-existing user session is untouched by the claim ──────────────
  {
    const gid = `guest-${randomUUID()}`;
    const uid = `user-${randomUUID().slice(0, 8)}`;
    userIds.push(uid);

    // user already has a session
    const ownSid = track(randomUUID());
    await updateChatSession(
      ownSid,
      { chatStateSet: {}, chatStateInc: { messageCount: 1 } },
      { userId: uid, guestId: null, sessionType: 'global' },
    );
    await addChatMessages(ownSid, [{ role: 'student', text: 'own' }, { role: 'tutor', text: 'ok' }]);

    // and a guest session to claim
    const guestSid = await seedGuestChat(gid, { turns: 1 });

    await claimGuestData(uid, gid);

    const own = await findChatSession(ownSid);
    assert.equal(own.userId, uid, 'pre-existing user session still owned by the user');
    assert.equal(own.guestId, null);

    const listed = await getSessionsByUser(uid);
    assert.equal(listed.length, 2, 'user now sees exactly their own + the claimed session');
    console.log('  ✅ pre-existing user session untouched; no collision');
  }

  // ── 3. No guest chat → chatSessionsTransferred: 0, no error ───────────────
  {
    const gid = `guest-${randomUUID()}`;
    const uid = `user-${randomUUID().slice(0, 8)}`;
    userIds.push(uid);
    const result = await claimGuestData(uid, gid);
    assert.equal(result.chatSessionsTransferred, 0);
    console.log('  ✅ nothing to claim → chatSessionsTransferred: 0');
  }

  console.log('\x1b[32m✓ All claim-chat (Phase 4) tests passed\x1b[0m');
} catch (err) {
  console.error(`\n  FAILED ❌  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  if (sessionIds.length) {
    await ChatSession.deleteMany({ sessionId: { $in: sessionIds } });
    await ChatHistory.deleteMany({ sessionId: { $in: sessionIds } });
    console.log(`Cleaned up ${sessionIds.length} chat session(s) + history.`);
  }
  await disconnectDB();
}
