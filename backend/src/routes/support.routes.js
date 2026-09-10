import { Router } from 'express';
import { optionalAuth, requireAdmin } from '../auth/authMiddleware.js';
import { attachGuest } from '../auth/guestMiddleware.js';
import { supportApiLimiter } from '../middlewares/rateLimiters.js';
import {
  submitSupportRequest,
  listSupportRequests,
  updateSupportRequest,
} from '../controllers/support.controller.js';

const router = Router();

// optionalAuth first so supportApiLimiter can key off req.user for its guest/logged-in
// split; attachGuest then resolves req.guest for the controller's extractIdentity.
router.post('/', optionalAuth, attachGuest, supportApiLimiter, submitSupportRequest); // POST  /api/v1/support
router.get('/', requireAdmin, listSupportRequests);                     // GET   /api/v1/support
router.patch('/:id', requireAdmin, updateSupportRequest);               // PATCH /api/v1/support/:id

export default router;
