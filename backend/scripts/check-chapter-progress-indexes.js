/**
 * check-chapter-progress-indexes.js   (READ-ONLY — writes nothing)
 *
 * Step 1 of the chapter_progress logged-in-user uniqueness fix.
 * Confirms three facts against the REAL database before any fix is written:
 *
 *   1. The live index definition on chapter_progress — is `user_chapter_unique`
 *      still filtering userId as $type:'objectId'?
 *   2. The actual BSON type userId is stored as (string / null / objectId / ...).
 *   3. Whether duplicate { userId, chapterId } documents already exist for
 *      logged-in users — those would block creating a real unique index in Step 3.
 *
 * Safe to run against production: it only reads (coll.indexes + aggregate).
 *
 * Run:  cd backend && node scripts/check-chapter-progress-indexes.js
 */

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';

const COLLECTION = 'chapter_progress';

let connected = false;

try {
  await connectDB();
  connected = true;

  const coll = mongoose.connection.db.collection(COLLECTION);

  // ── 1. Current indexes ──────────────────────────────────────────────────────
  console.log('\n=== 1. Current indexes on ' + COLLECTION + ' ===');
  const indexes = await coll.indexes();
  for (const idx of indexes) {
    const uniq    = idx.unique ? ' UNIQUE' : '';
    const partial = idx.partialFilterExpression
      ? ' partial=' + JSON.stringify(idx.partialFilterExpression)
      : '';
    console.log(`  • ${idx.name}: ${JSON.stringify(idx.key)}${uniq}${partial}`);
  }
  const userIdx = indexes.find((i) => i.name === 'user_chapter_unique');
  if (userIdx) {
    console.log(`\n  → user_chapter_unique partial filter: ${JSON.stringify(userIdx.partialFilterExpression || {})}`);
    console.log('    (bug present if this filters userId by $type "objectId")');
  } else {
    console.log('\n  → user_chapter_unique index NOT found.');
  }

  // ── 2. Actual BSON type of userId across all docs ───────────────────────────
  console.log('\n=== 2. Stored BSON type of userId (all docs) ===');
  const typeAgg = await coll.aggregate([
    { $group: { _id: { $type: '$userId' }, count: { $sum: 1 } } },
    { $sort:  { count: -1 } },
  ]).toArray();
  for (const row of typeAgg) {
    console.log(`  • userId type "${row._id}": ${row.count} doc(s)`);
  }
  const objectIdCount = typeAgg.find((r) => r._id === 'objectId')?.count || 0;
  const stringCount   = typeAgg.find((r) => r._id === 'string')?.count   || 0;
  console.log(`\n  → objectId-typed: ${objectIdCount}   |   string-typed: ${stringCount}`);
  console.log(
    objectIdCount === 0 && stringCount > 0
      ? '    VERDICT: userId stored as STRING → the objectId partial filter matches NOTHING → uniqueness NOT enforced. Bug confirmed.'
      : '    VERDICT: unexpected counts — review above before writing any fix.'
  );

  // ── 3. Duplicate { userId, chapterId } among logged-in docs ─────────────────
  console.log('\n=== 3. Duplicate (userId, chapterId) for logged-in users ===');
  const dupes = await coll.aggregate([
    { $match: { userId: { $type: 'string' } } },
    { $group: { _id: { userId: '$userId', chapterId: '$chapterId' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $sort:  { count: -1 } },
  ]).toArray();

  if (dupes.length === 0) {
    console.log('  • No duplicates found — a unique index can be created cleanly (no cleanup needed in Step 3).');
  } else {
    console.log(`  • ${dupes.length} duplicated (userId, chapterId) group(s) found — these MUST be cleaned in Step 3 before the unique index can build:`);
    for (const d of dupes) {
      console.log(`    - userId=${d._id.userId}  chapter=${d._id.chapterId}  ×${d.count}  docs=[${d.ids.join(', ')}]`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  // Read the actual filter type off the live index (not just the stored-type counts),
  // so this script is a correct verifier BEFORE and AFTER the fix:
  //   filter 'objectId' + string userIds  → bug present (enforces nothing)
  //   filter 'string'   + string userIds  → fixed (uniqueness now enforced)
  const userFilterType = userIdx?.partialFilterExpression?.userId?.$type ?? 'none';
  const enforced = userFilterType === 'string' && stringCount > 0;
  console.log('\n=== SUMMARY ===');
  console.log(`  user_chapter_unique filter type              : ${userFilterType}`);
  console.log(`  Uniqueness enforced for logged-in users?     : ${enforced ? 'YES (fixed)' : 'NO (bug present — filter must be "string")'}`);
  console.log(`  Logged-in duplicate groups needing cleanup   : ${dupes.length}`);
  console.log('');
} catch (err) {
  console.error('\n[check-chapter-progress-indexes] FAILED:', err.message);
  process.exitCode = 1;
} finally {
  if (connected) await disconnectDB();
}
