/**
 * fix-chapter-progress-user-index.js   (one-time migration)
 *
 * Fixes the `user_chapter_unique` index on chapter_progress.
 *
 * The index was declared with partialFilterExpression { userId: { $type: 'objectId' } },
 * but userId is stored as a STRING (req.user.id → Mongoose `.id` → _id.toString(), and
 * the schema types userId as String). An objectId filter therefore matched ZERO docs,
 * so the unique constraint enforced nothing for logged-in users. The model now declares
 * $type:'string', but Mongoose autoIndex will NOT replace an existing index that has the
 * same name and different options — so existing databases need this explicit drop+recreate.
 *
 * Safe + idempotent:
 *   • If the index is already string-filtered → no-op.
 *   • Never deletes documents. If duplicate (userId, chapterId) groups exist it ABORTS
 *     (a unique build would fail) and prints them, so they can be resolved first.
 *   • Re-running after success does nothing.
 *
 * Run:  cd backend && node scripts/fix-chapter-progress-user-index.js
 */

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';

const COLLECTION     = 'chapter_progress';
const INDEX_NAME     = 'user_chapter_unique';
const DESIRED_KEY    = { userId: 1, chapterId: 1 };
const DESIRED_FILTER = { userId: { $type: 'string' } };

let connected = false;

try {
  await connectDB();
  connected = true;
  const coll = mongoose.connection.db.collection(COLLECTION);

  const existing = (await coll.indexes()).find((i) => i.name === INDEX_NAME);

  // Already correct? → no-op.
  if (existing && JSON.stringify(existing.partialFilterExpression) === JSON.stringify(DESIRED_FILTER)) {
    console.log(`✓ '${INDEX_NAME}' already filters ${JSON.stringify(DESIRED_FILTER)} — nothing to do.`);
  } else {
    // Safety gate: never build a unique index while duplicates exist.
    const dupes = await coll.aggregate([
      { $match: { userId: { $type: 'string' } } },
      { $group: { _id: { userId: '$userId', chapterId: '$chapterId' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();

    if (dupes.length > 0) {
      console.error(`✗ ABORT: ${dupes.length} duplicate (userId, chapterId) group(s) exist — resolve these first (no data was changed):`);
      for (const d of dupes) {
        console.error(`   userId=${d._id.userId}  chapter=${d._id.chapterId}  ×${d.count}  docs=[${d.ids.join(', ')}]`);
      }
      process.exitCode = 1;
    } else {
      if (existing) {
        console.log(`• Dropping old '${INDEX_NAME}' (filter ${JSON.stringify(existing.partialFilterExpression || {})})...`);
        await coll.dropIndex(INDEX_NAME);
      }
      console.log(`• Creating '${INDEX_NAME}' with partial filter ${JSON.stringify(DESIRED_FILTER)}...`);
      await coll.createIndex(DESIRED_KEY, { unique: true, name: INDEX_NAME, partialFilterExpression: DESIRED_FILTER });
      console.log('✓ Migration complete.');
    }
  }

  // Final state for confirmation.
  const after = (await coll.indexes()).find((i) => i.name === INDEX_NAME);
  console.log(`\nFinal '${INDEX_NAME}' filter: ${after ? JSON.stringify(after.partialFilterExpression) : 'MISSING'}`);
} catch (err) {
  console.error('\n[fix-chapter-progress-user-index] FAILED:', err.message);
  process.exitCode = 1;
} finally {
  if (connected) await disconnectDB();
}
