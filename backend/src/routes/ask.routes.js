import { Router } from 'express';

import { askQuestionController } from '../controllers/ask.controller.js';
import { optionalAuth } from '../auth/authMiddleware.js';
import { attachGuest } from '../auth/guestMiddleware.js';
import { queryCountMiddleware } from '../middlewares/queryCount.js';
import { guestRateLimit } from '../middlewares/guestRateLimit.js';
import { askApiLimiter } from '../middlewares/rateLimiters.js';

const router = Router();

// attachGuest must sit between optionalAuth and askApiLimiter: it needs req.user
// (from optionalAuth) and askApiLimiter's identityKeyGenerator needs req.guest.
router.post('/', optionalAuth, attachGuest, askApiLimiter, guestRateLimit, queryCountMiddleware, askQuestionController);

export default router;
