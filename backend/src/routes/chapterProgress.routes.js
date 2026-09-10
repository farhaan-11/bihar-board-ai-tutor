import { Router } from 'express';
import { optionalAuth } from '../auth/authMiddleware.js';
import { attachGuest } from '../auth/guestMiddleware.js';
import {
  getChapterProgressController,
  listChapterProgressController,
  chapterActionController,
} from '../controllers/chapterProgress.controller.js';

const router = Router();

// optionalAuth attaches req.user for logged-in users without blocking guests;
// attachGuest then resolves the X-Guest-Id header into req.guest.
router.use(optionalAuth);
router.use(attachGuest);

router.get('/',              listChapterProgressController);       // GET  /api/v1/chapter-progress
router.get('/:chapterId',    getChapterProgressController);        // GET  /api/v1/chapter-progress/:chapterId
router.post('/:chapterId/action', chapterActionController);        // POST /api/v1/chapter-progress/:chapterId/action

export default router;
