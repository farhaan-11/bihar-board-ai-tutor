/**
 * One-time migration: create the partial { guestId: 1 } index on chat_sessions.
 *
 * Phase 3 of GUEST_SERVERSIDE_PLAN.md. chat_sessions.guestId is new; the login
 * claim (Phase 4) runs
 *   ChatSession.updateMany({ guestId, userId: null }, ...)
 * which is a full COLLSCAN without an index on guestId.
 *
 * chatSession.model.js now declares
 *   chatSessionSchema.index({ guestId: 1 }, { partialFilterExpression: { guestId: { $type: 'string' } } })
 * so Mongoose auto-creates it on the next server start (autoIndex). This script
 * makes that explicit and immediate for a deploy, matching the repo's
 * fix-*-index.js / create-*-index.js pattern. Idempotent — createIndex is a
 * no-op if an identical index already exists.
 *
 * Partial on { $type: 'string' } so the null guestId that every logged-in
 * session carries (schema default) is not indexed — same reasoning as the guest
 * indexes on quiz_attempts and chapter_progress.
 *
 * Run once from backend/: node scripts/create-chat-session-guest-index.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function run() {
  if (!MONGO_URI) throw new Error('MONGODB_URI (or MONGO_URI) is missing in .env');

  console.log('[Migration] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);

  const col = mongoose.connection.db.collection('chat_sessions');

  const before = await col.indexes();
  console.log('[Migration] Existing indexes:', before.map((i) => i.name).join(', '));

  const name = await col.createIndex(
    { guestId: 1 },
    { partialFilterExpression: { guestId: { $type: 'string' } } },
  );
  console.log(`[Migration] createIndex returned: ${name} ✓`);

  const after = await col.indexes();
  console.log('[Migration] Indexes now:', after.map((i) => i.name).join(', '));

  await mongoose.disconnect();
  console.log('[Migration] Done.');
}

run().catch((err) => {
  console.error('[Migration] FAILED:', err.message);
  process.exit(1);
});
