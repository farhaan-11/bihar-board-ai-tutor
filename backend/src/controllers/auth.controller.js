import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import redis from '../config/redisClient.js';
import User from '../models/user.model.js';
import ApiError from '../utils/ApiError.js';
import { sendResponse } from '../utils/sendResponse.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../auth/emailHelpers.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../auth/tokenHelpers.js';
import { generateGuestToken } from '../auth/guestTokenHelpers.js';
import { claimGuestData } from '../services/chapterProgress.service.js';

// Simple email format check — not too strict, just catches obvious mistakes
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// TTL constants
const VERIFY_EMAIL_TTL = 60 * 60 * 24; // 24 hours in seconds
const RESET_PASSWORD_TTL = 60 * 15;    // 15 minutes in seconds
const OAUTH_CODE_TTL = 30;             // 30 seconds — one-time Google OAuth exchange code

/**
 * POST /api/v1/auth/register
 * Register a new user with email + password.
 * Sends a verification email before confirming success.
 */
export const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // --- Validation ---
    if (!name || !email || !password) {
      throw new ApiError(400, 'Name, email aur password teeno zaroori hain.');
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      throw new ApiError(400, 'Valid email address dalo.');
    }

    if (password.length < 8) {
      throw new ApiError(400, 'Password kam se kam 8 characters ka hona chahiye.');
    }
    if (!/\d/.test(password)) {
      throw new ApiError(400, 'Password mein kam se kam ek number hona chahiye.');
    }
    if (!/[A-Z]/.test(password)) {
      throw new ApiError(400, 'Password mein kam se kam ek uppercase letter hona chahiye.');
    }

    // --- Check duplicate email ---
    // Note: We also catch the MongoDB unique index error below as a safety net
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      throw new ApiError(400, 'Yeh email already registered hai.');
    }

    // --- Hash password ---
    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // --- Save user (unverified) ---
    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      authProvider: 'email',
      isEmailVerified: false,
    });

    // --- Generate verification token ---
    const token = crypto.randomBytes(32).toString('hex');
    const userId = user._id.toString();

    // --- Store in Redis (2 keys for forward + reverse lookup) ---
    await redis.set(`verify_email:${token}`, userId, 'EX', VERIFY_EMAIL_TTL);
    await redis.set(`verify_email:${userId}`, token, 'EX', VERIFY_EMAIL_TTL);

    // --- Send verification email ---
   
    // If this fails, rollback: delete user from DB so they can register again cleanly
    
    try {
      await sendVerificationEmail(cleanEmail, token);
    } catch (emailError) {
      // Rollback: remove the user we just created
      await User.deleteOne({ _id: user._id });
      // Also clean up Redis keys
      await redis.del(`verify_email:${token}`);
      await redis.del(`verify_email:${userId}`);
      console.error('[Register] Email send failed, rolling back user creation:', emailError);
      throw new ApiError(500, 'Verification email nahi bheja ja saka. Thodi der baad dobara try karo.');
    }
    

    

    return sendResponse(res, 201, {
      message: 'Registration successful! Please check your email to verify your account.',
    });

  } catch (err) {
    // Catch MongoDB duplicate key error (race condition safety net)
    if (err.code === 11000) {
      return next(new ApiError(400, 'Yeh email already registered hai.'));
    }
    next(err);
  }
};

// A valid bcrypt hash used as a dummy for timing-safe "user not found" case.
// bcrypt.compare() against this hash will always return false,
// but it takes the same ~100ms as a real comparison — preventing timing attacks.
const DUMMY_HASH = '$2b$12$KIXBnNGSPXV5zxNWEJZRPOqQmIJdZZqXP5kVXEzpAFgOYF0qOdVVa';

// Cookie maxAge and Redis TTL for refresh token — 7 days
const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // milliseconds (for cookie)
const REFRESH_TOKEN_REDIS_TTL = 7 * 24 * 60 * 60;             // seconds (for Redis EX)

// Grace window for the immediately-previous refresh token after rotation —
// absorbs the race when multiple tabs/requests refresh near-simultaneously
// (e.g. several tabs restored at once). Cleared immediately on logout/password
// reset so it never outlives an explicit invalidation.
const REFRESH_TOKEN_GRACE_TTL = 20; // seconds

/**
 * POST /api/v1/auth/login
 * Authenticate a user with email and password.
 * Returns an access token in the response body and sets a refresh token as an HttpOnly cookie.
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // --- Step 1: Basic validation ---
    if (!email || !password) {
      throw new ApiError(400, 'Email and password are required.');
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      throw new ApiError(400, 'Please enter a valid email address.');
    }

    // --- Step 2: Find user by email ---
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      // Run dummy bcrypt compare to prevent timing attacks.
      // Without this, "user not found" returns instantly while "wrong password"
      // takes ~100ms — an attacker can detect which emails are registered.
      await bcrypt.compare(password, DUMMY_HASH);
      throw new ApiError(401, 'Invalid credentials.');
    }

    // --- Step 3: Check auth provider ---
    // If the user registered via Google, they cannot login with a password.
    if (user.authProvider === 'google') {
      throw new ApiError(401, 'This email is registered with Google. Please sign in with Google.');
    }

    // --- Step 4: Check email verification ---
    if (!user.isEmailVerified) {
      throw new ApiError(401, 'Please verify your email before logging in.');
    }

    // --- Step 5: Check account status ---
    if (!user.isActive) {
      throw new ApiError(403, 'Your account has been disabled. Please contact support.');
    }

    // --- Step 6: Verify password ---
    const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordCorrect) {
      throw new ApiError(401, 'Invalid credentials.');
    }

    // --- Step 7: Generate tokens ---
    const userId = user._id.toString();
    const accessToken = generateAccessToken(userId);
    const refreshToken = generateRefreshToken(userId);

    // --- Step 8: Store refresh token in Redis (whitelist) ---
    // EX sets TTL in seconds — do not use milliseconds here
    await redis.set(`refresh_token:${userId}`, refreshToken, 'EX', REFRESH_TOKEN_REDIS_TTL);

    // --- Step 9: Set refresh token as HttpOnly cookie ---
    // HttpOnly: JS cannot read this cookie (XSS safe)
    // secure: only sent over HTTPS in production
    // sameSite: 'none' in production (cross-domain frontend/backend) + Secure=true required by spec.
    // sameSite: 'lax' in development (localhost, no real cross-site risk).
    // CSRF is handled by CORS origin allowlist — not by sameSite alone.
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
    });

    // --- Step 10: Return access token and safe user object ---
    // Never return passwordHash or other sensitive fields
    console.log('[Auth] Login successful:', cleanEmail);

    return sendResponse(res, 200, {
      message: 'Login successful.',
      data: {
        accessToken,
        user: {
          id: userId,
          name: user.name,
          email: user.email,
          role: user.role,
          plan: user.plan,
        },
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/verify-email
 * Verify email using the token sent in the verification email.
 */
export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw new ApiError(400, 'Verification token missing hai.');
    }

    // --- Look up token in Redis ---
    const userId = await redis.get(`verify_email:${token}`);

    if (!userId) {
      throw new ApiError(400, 'Verification link expire ho gaya hai ya invalid hai.');
    }

    // --- Find user in DB ---
    const user = await User.findById(userId);
    if (!user) {
      // Rare: Redis has token but user deleted from DB
      await redis.del(`verify_email:${token}`);
      throw new ApiError(400, 'User nahi mila. Dobara register karo.');
    }

    // --- Mark email as verified ---
    user.isEmailVerified = true;
    await user.save();

    // --- Clean up both Redis keys ---
    await redis.del(`verify_email:${token}`);
    await redis.del(`verify_email:${userId}`);

    console.log('[Auth] Email verified:', user.email);

    return sendResponse(res, 200, {
      message: 'Email verify ho gaya! Ab login karo.',
    });

  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/logout
 * Invalidates the refresh token and clears the cookie.
 */
export const logout = async (req, res, next) => {
  try {
    // Get userId from the refresh cookie itself — not from Bearer token.
    // This way logout works even if the access token is expired.
    const token = req.cookies?.refreshToken;
    if (token) {
      const decoded = verifyRefreshToken(token);
      if (decoded?.userId) {
        // Clear both the active token and the rotation grace slot — logout
        // must be a hard, immediate invalidation with no leftover window.
        await Promise.all([
          redis.del(`refresh_token:${decoded.userId}`),
          redis.del(`refresh_token_prev:${decoded.userId}`),
        ]).catch((redisErr) => {
          console.error('[Logout] Redis DEL failed:', redisErr);
        });
      }
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
    });

    return sendResponse(res, 200, { message: 'Logged out successfully.' });

  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/refresh
 * Issues a new access token using a valid refresh token cookie.
 */
export const refreshToken = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return sendResponse(res, 401, { message: 'No refresh token.' });

    const decoded = verifyRefreshToken(token);
    if (!decoded || !decoded.userId) {
      return sendResponse(res, 401, { message: 'Invalid refresh token.' });
    }

    const userId = decoded.userId;
    const storedToken = await redis.get(`refresh_token:${userId}`);

    let isValid = storedToken === token;

    // Not the current token — check the short-lived grace slot before
    // rejecting. Covers multiple tabs/requests refreshing near-simultaneously
    // (e.g. several tabs restored at once): the one that loses the rotation
    // race still holds the immediately-previous token, which is still
    // accepted for a few seconds instead of silently logging that tab out.
    if (!isValid) {
      const prevToken = await redis.get(`refresh_token_prev:${userId}`);
      isValid = prevToken === token;
    }

    if (!isValid) {
      if (!storedToken) {
        return sendResponse(res, 401, { message: 'Session expired. Please login again.' });
      }
      return sendResponse(res, 401, { message: 'Invalid session.' });
    }

    const accessToken = generateAccessToken(userId);
    const newRefreshToken = generateRefreshToken(userId);

    // Demote the current token into the grace slot before replacing it —
    // whichever token was valid a moment ago stays acceptable briefly.
    if (storedToken) {
      await redis.set(`refresh_token_prev:${userId}`, storedToken, 'EX', REFRESH_TOKEN_GRACE_TTL);
    }
    await redis.set(`refresh_token:${userId}`, newRefreshToken, 'EX', REFRESH_TOKEN_REDIS_TTL);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
    });

    return sendResponse(res, 200, { message: 'Token refreshed.', data: { accessToken } });

  } catch (err) {
    console.error('refreshToken error:', err);
    return sendResponse(res, 500, { message: 'Something went wrong. Please try again.' });
  }
};

/**
 * POST /api/v1/auth/forgot-password
 * Sends a password reset email if the email is registered with email auth.
 * Always returns the same safe response to prevent email enumeration.
 */
export const forgotPassword = async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const safeResponse = 'If this email is registered, a password reset link has been sent.';

    if (!email) {
      return sendResponse(res, 400, { message: 'Email daalna zaroori hai.' });
    }

    const user = await User.findOne({ email });

    if (!user || user.authProvider !== 'email') {
      return sendResponse(res, 200, { message: safeResponse });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const userId = user._id.toString();

    await redis.set(`reset_password:${token}`, userId, 'EX', RESET_PASSWORD_TTL);

    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (emailErr) {
      console.error('[ForgotPassword] Email send failed:', emailErr);
    }

    return sendResponse(res, 200, { message: safeResponse });

  } catch (err) {
    console.error('forgotPassword error:', err);
    return sendResponse(res, 500, { message: 'Something went wrong. Please try again.' });
  }
};

/**
 * POST /api/v1/auth/reset-password
 * Resets the user's password using a valid reset token.
 * Invalidates the reset token and existing refresh token after success.
 */
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return sendResponse(res, 400, { message: 'Token aur naya password dono zaroori hain.' });
    }

    if (newPassword.length < 8) {
      return sendResponse(res, 400, { message: 'Password kam se kam 8 characters ka hona chahiye.' });
    }
    if (!/\d/.test(newPassword)) {
      return sendResponse(res, 400, { message: 'Password mein kam se kam ek number hona chahiye.' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return sendResponse(res, 400, { message: 'Password mein kam se kam ek uppercase letter hona chahiye.' });
    }

    const userId = await redis.get(`reset_password:${token}`);
    if (!userId) {
      return sendResponse(res, 400, { message: 'Reset link expired or invalid.' });
    }

    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    await User.findByIdAndUpdate(userId, { passwordHash });

    await redis.del(`reset_password:${token}`);
    // Password change must kill every session immediately — clear both the
    // active token and the rotation grace slot, no leftover window.
    await redis.del(`refresh_token:${userId}`);
    await redis.del(`refresh_token_prev:${userId}`);

    return sendResponse(res, 200, { message: 'Password reset successful. Please login again.' });

  } catch (err) {
    console.error('resetPassword error:', err);
    return sendResponse(res, 500, { message: 'Something went wrong. Please try again.' });
  }
};

/**
 * GET /api/v1/auth/google
 * Redirects the user to Google's OAuth consent screen.
 */
export const googleAuth = (req, res) => {
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['email', 'profile'],
    prompt: 'select_account',
  });

  return res.redirect(url);
};

/**
 * GET /api/v1/auth/me
 * Returns the authenticated user's profile.
 * req.user is the full Mongoose document attached by requireAuth — no DB call needed.
 */
export const getMe = async (req, res) => {
  try {
    const { _id, name, email, role, plan, isEmailVerified, authProvider } = req.user;
    return sendResponse(res, 200, {
      data: {
        user: {
          id: _id.toString(),
          name,
          email,
          role,
          plan,
          isEmailVerified,
          authProvider,
        },
      },
    });
  } catch (err) {
    console.error('getMe error:', err);
    return sendResponse(res, 500, { message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/auth/google/callback
 * Handles the OAuth callback from Google, finds or creates the user,
 * issues tokens, and redirects to the frontend with the access token.
 */
export const googleCallback = async (req, res) => {
  // FRONTEND_URL might be a comma-separated list. We take the first one for the redirect.
  // E.g. "https://bihar-board-ai-tutor.vercel.app,http://localhost:5173" -> "https://bihar-board-ai-tutor.vercel.app"
  const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();

  try {
    // 1. Check code exists
    const { code } = req.query;
    if (!code) {
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=google_cancelled`);
    }

    // 2. Exchange code for tokens
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );

    const { tokens } = await client.getToken(code);
    const idToken = tokens.id_token;

    if (!idToken) {
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=google_failed`);
    }

    // 3. Verify ID token and extract user info
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email?.toLowerCase().trim();
    const name = payload.name || email.split('@')[0];

    if (!email) {
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=google_failed`);
    }

    // 4. Find or create user
    let user = await User.findOne({ email });

    if (user) {
      if (user.authProvider !== 'google') {
        return res.redirect(`${FRONTEND_URL}/auth/callback?error=account_exists`);
      }
      if (!user.isActive) {
        return res.redirect(`${FRONTEND_URL}/auth/callback?error=account_disabled`);
      }
    } else {
      user = await User.create({
        name,
        email,
        authProvider: 'google',
        googleId,
        isEmailVerified: true,
        passwordHash: null,
      });
    }

    // 5. Generate tokens
    const userId = user._id.toString();
    const accessToken = generateAccessToken(userId);
    const refreshToken = generateRefreshToken(userId);

    // 6. Store refresh token in Redis (TTL: 7 days = 604800 seconds)
    await redis.set(`refresh_token:${userId}`, refreshToken, 'EX', 604800);

    // 7. Set HttpOnly cookie — identical options to login()
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
    });

    // 8. Generate one-time exchange code — token never goes in the URL.
    // Frontend POSTs /auth/exchange with this code to receive the access token in JSON.
    const oauthCode = crypto.randomBytes(32).toString('hex');
    await redis.set(`oauth_code:${oauthCode}`, accessToken, 'EX', OAUTH_CODE_TTL);
    console.log('[GoogleCallback] OAuth exchange code generated.');
    return res.redirect(`${FRONTEND_URL}/auth/callback?code=${oauthCode}`);

  } catch (err) {
    console.error('[GoogleCallback] Error:', err);
    return res.redirect(`${FRONTEND_URL}/auth/callback?error=google_failed`);
  }
};

/**
 * POST /api/v1/auth/exchange
 * Exchanges a one-time OAuth code (from Google callback URL) for the actual access token.
 * Code is valid for 30 seconds and single-use — deleted from Redis on first successful exchange.
 */
export const exchangeOAuthCode = async (req, res, next) => {
  try {
    const { code } = req.body;

    // Validate format before hitting Redis — must be exactly 64 hex chars
    const CODE_REGEX = /^[0-9a-f]{64}$/;
    if (!code || !CODE_REGEX.test(code)) {
      return next(new ApiError(400, 'Invalid request.'));
    }

    // GET then DEL — safe across all Redis versions
    const accessToken = await redis.get(`oauth_code:${code}`);
    if (accessToken) {
      await redis.del(`oauth_code:${code}`);
    }

    if (!accessToken) {
      return next(new ApiError(400, 'Code expired ya invalid hai. Please dobara Google se login karo.'));
    }

    return sendResponse(res, 200, {
      message: 'Token exchange successful.',
      data: { accessToken },
    });
  } catch (err) {
    next(err);
  }
};

// Same UUID format guestRateLimit.js validates on the way in.
const GUEST_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/auth/guest
 * Issues a server-signed guest identity token. The browser stores it and sends
 * it as the X-Guest-Id header instead of a self-generated UUID, so guest ids can
 * no longer be fabricated or rotated to bypass the guest turn limit.
 *
 * Optional body { legacyGuestId }: during the transition window a browser that
 * still holds an old client-generated UUID passes it here once, so its existing
 * guest progress (chapter_progress, quiz history) is preserved under the new
 * signed token. Ignored unless it is a well-formed UUID.
 *
 * IP-rate-limited (guestMintLimiter). Stateless — no DB write. Never fails: the
 * worst case for the caller is retrying.
 */
export const issueGuestToken = async (req, res) => {
  const legacy = req.body?.legacyGuestId;
  const adoptGid =
    typeof legacy === 'string' && GUEST_ID_REGEX.test(legacy.trim())
      ? legacy.trim()
      : undefined;

  const guestToken = generateGuestToken(adoptGid);

  return sendResponse(res, 200, {
    message: 'Guest token issued.',
    data: { guestToken },
  });
};

/**
 * POST /api/v1/auth/claim-guest-progress
 * Called once, right after login/register/OAuth success, with the guestId
 * that was sitting in the browser's localStorage. Transfers that guest's
 * chapter_progress + study_events onto the now-authenticated user so a
 * student who studied as a guest doesn't lose progress on signing up.
 * Never blocks or fails the login flow — an invalid/missing guestId is a
 * harmless no-op, not an error.
 */
export const claimGuestProgress = async (req, res, next) => {
  try {
    const { guestId } = req.body;

    if (!guestId || !GUEST_ID_REGEX.test(String(guestId).trim())) {
      return sendResponse(res, 200, {
        message: 'No valid guestId — nothing to claim.',
        data: { chaptersTransferred: 0, chaptersMerged: 0 },
      });
    }

    const result = await claimGuestData(req.user.id, guestId.trim());

    return sendResponse(res, 200, {
      message: 'Guest progress claimed.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
