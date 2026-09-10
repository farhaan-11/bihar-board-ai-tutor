/**
 * support.controller.js
 *
 * HTTP handlers for the /api/v1/support routes.
 * Submit is open to guests + logged-in users; list/update are admin-only.
 */

import { SupportRequest } from '../models/supportRequest.model.js';
import { SUPPORT_CATEGORIES } from '../constants/supportCategories.js';
import { sendResponse } from '../utils/sendResponse.js';
import ApiError from '../utils/ApiError.js';
import { sendSupportNotificationEmail } from '../auth/emailHelpers.js';

const extractIdentity = (req) => ({
  userId:  req.user?.id  || null,
  guestId: req.guest?.id || null, // req.guest set by attachGuest, null when req.user present
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_SUBJECT_LENGTH = 3;
const MIN_DESCRIPTION_LENGTH = 15;

// ─── POST /api/v1/support ─────────────────────────────────────────────────────

export const submitSupportRequest = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);
    const { category, subject, description, email, sessionId } = req.body;

    if (!category || !SUPPORT_CATEGORIES.includes(category)) {
      return next(new ApiError(400, `category is required and must be one of: ${SUPPORT_CATEGORIES.join(', ')}`));
    }
    if (!subject || subject.trim().length < MIN_SUBJECT_LENGTH) {
      return next(new ApiError(400, `subject must be at least ${MIN_SUBJECT_LENGTH} characters.`));
    }
    if (!description || description.trim().length < MIN_DESCRIPTION_LENGTH) {
      return next(new ApiError(400, `description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`));
    }

    // Logged-in users' email comes from their account, never from the body —
    // prevents a logged-in user from submitting under a spoofed email.
    const resolvedEmail = req.user ? req.user.email : email;
    if (!resolvedEmail || !EMAIL_REGEX.test(resolvedEmail)) {
      return next(new ApiError(400, 'A valid email is required.'));
    }

    const doc = await SupportRequest.create({
      category,
      subject: subject.trim(),
      description: description.trim(),
      email: resolvedEmail,
      userId,
      guestId,
      sessionId: sessionId || null,
    });

    // Fire-and-forget — the ticket is already saved, so a notification failure
    // (Brevo/SMTP down) must not fail the student's submission.
    sendSupportNotificationEmail(doc).catch((err) => {
      console.error('[Support] Notification email failed:', err.message);
    });

    return sendResponse(res, 201, {
      message: 'Support request submitted. Hum jaldi respond karenge.',
      data: { supportRequest: doc },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/v1/support (admin only) ─────────────────────────────────────────

export const listSupportRequests = async (req, res, next) => {
  try {
    const { status, category, page = '1', limit = '20' } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;

    const parsedPage  = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(parseInt(limit, 10) || 20, 50);
    const skip = (parsedPage - 1) * parsedLimit;

    const [requests, total] = await Promise.all([
      SupportRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit),
      SupportRequest.countDocuments(filter),
    ]);

    return sendResponse(res, 200, {
      message: 'Support requests fetched.',
      data: {
        requests,
        pagination: { page: parsedPage, limit: parsedLimit, total },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── PATCH /api/v1/support/:id (admin only) ───────────────────────────────────

const ALLOWED_STATUSES = new Set(['open', 'resolved', 'closed']);

export const updateSupportRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (status && !ALLOWED_STATUSES.has(status)) {
      return next(new ApiError(400, `status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`));
    }

    const update = {};
    if (status) update.status = status;
    if (adminNotes !== undefined) update.adminNotes = adminNotes;

    const doc = await SupportRequest.findByIdAndUpdate(id, update, { new: true });

    if (!doc) {
      return next(new ApiError(404, `Support request '${id}' not found.`));
    }

    return sendResponse(res, 200, {
      message: 'Support request updated.',
      data: { supportRequest: doc },
    });
  } catch (error) {
    next(error);
  }
};
