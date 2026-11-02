// Chat DB model test
// ---------------------------------------------------------------------------
// Yeh test asli MongoDB se baat karke check karta hai ki chat ka data theek se
// save/read hota hai:
//   1. ek chat session ban-ta hai
//   2. us session me messages (student + tutor) add hote hai
//   3. session ki "chatState" (student kaunse chapter/lesson me hai) update hoti hai
//
// Note: "chatState" ab apni alag file/collection nahi hai — woh chat session ke
// andar hi rehti hai. Isliye use karne ke functions chatSession.service.js me hai.

import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';
import {
  createChatSession,
  findChatSession,
  updateChatSessionState,
  deleteSessionById,
} from '../src/services/chatSession.service.js';
import {
  addChatMessage,
  getChatHistory,
  deleteSessionHistory,
} from '../src/services/chatHistory.service.js';

// Chhota helper: agar condition false hai toh error phenk do.
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

let sessionId = null;

try {
  await connectDB();

  // ── 1. Session banao ───────────────────────────────────────────────
  const session = await createChatSession({
    mode: 'guest',
    title: 'Test Physics Chat',
  });
  sessionId = session.sessionId;

  // DB se wapas padho aur check karo ki theek se save hua.
  const savedSession = await findChatSession(sessionId);
  assert(savedSession, 'Chat session was not saved.');
  assert(savedSession.mode === 'guest', 'Chat session mode is wrong.');

  // Naya session hamesha default state ke saath aata hai: learningMode = 'idle'.
  assert(
    savedSession.chatState.learningMode === 'idle',
    'Default learning mode should be idle.'
  );

  // ── 2. Messages add karo (student ka sawaal + tutor ka jawab) ───────
  await addChatMessage({
    sessionId,
    role: 'student',
    text: 'physics chapter 3 padhao',
  });

  await addChatMessage({
    sessionId,
    role: 'tutor',
    text: 'Chalo Electricity start karte hain.',
    action: 'start_lesson',
    sources: [
      {
        chapterTitle: 'Electricity',
        chunkId: 'physics-chapter-03-chunk-001',
      },
    ],
    metadata: {
      chapterId: 'science.physics.chapter-03',
    },
  });

  // History padho aur check karo dono messages sahi order me aaye.
  const history = await getChatHistory(sessionId);
  assert(history.length === 2, 'Chat history should have 2 messages.');
  assert(history[0].role === 'student', 'First message should be student.');
  assert(history[1].role === 'tutor', 'Second message should be tutor.');
  assert(history[1].action === 'start_lesson', 'Tutor action was not saved.');

  // ── 3. Session ki chatState update karo ─────────────────────────────
  // updateChatSessionState() sirf diye hue fields badalta hai aur pura
  // updated session wapas deta hai (iske andar nayi chatState hoti hai).
  const updated = await updateChatSessionState(sessionId, {
    learningMode: 'lesson',
    currentSubjectId: 'science',
    currentSectionId: 'physics',
    currentChapterId: 'science.physics.chapter-03',
    lastDoubtTopic: 'electric current',
    lastDoubtQuestion: 'electric current kya hai',
    sessionTopicsProgress: ['science.physics.chapter-03.topic-04'],
  });

  const state = updated.chatState;
  assert(state.learningMode === 'lesson', 'Learning mode was not updated.');
  assert(
    state.currentChapterId === 'science.physics.chapter-03',
    'Chapter was not updated.'
  );
  assert(
    state.sessionTopicsProgress.length === 1,
    'Session topics progress was not saved.'
  );
  assert(
    state.lastDoubtTopic === 'electric current',
    'Last doubt topic was not saved.'
  );

  console.log('Chat DB model tests passed.');
  console.log(
    JSON.stringify(
      {
        sessionId,
        chatHistoryMessages: history.length,
        currentChapterId: state.currentChapterId,
        learningMode: state.learningMode,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(`Chat DB model tests failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Test ne jo bhi banaya tha use DB se hata do (session ke andar chatState bhi
  // session ke saath hi delete ho jaati hai — alag se mitane ki zaroorat nahi).
  if (sessionId) {
    await deleteSessionHistory(sessionId);
    await deleteSessionById(sessionId);
  }

  await disconnectDB();
}
