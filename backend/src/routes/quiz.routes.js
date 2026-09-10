import { Router } from 'express';
import { optionalAuth } from '../auth/authMiddleware.js';
import { attachGuest } from '../auth/guestMiddleware.js';
import { quizGenerateLimiter, quizSubmitLimiter, quizHistoryLimiter } from '../middlewares/rateLimiters.js';
import { generateQuizController, submitQuizController, historyListController, historyDetailController } from '../controllers/quiz.controller.js';

const router = Router();

// optionalAuth attaches req.user for logged-in users without blocking guests;
// attachGuest then resolves the X-Guest-Id header into req.guest. Both run before
// the quiz limiters (identityKeyGenerator reads req.guest). Same pattern as the
// chapterProgress and ask routes.
router.use(optionalAuth);
router.use(attachGuest);

router.post('/generate', quizGenerateLimiter, generateQuizController); // POST /api/v1/quiz/generate
router.post('/submit', quizSubmitLimiter, submitQuizController);       // POST /api/v1/quiz/submit
router.get('/history', quizHistoryLimiter, historyListController);     // GET  /api/v1/quiz/history
router.get('/history/:attemptId', quizHistoryLimiter, historyDetailController); // GET /api/v1/quiz/history/:attemptId

export default router;
