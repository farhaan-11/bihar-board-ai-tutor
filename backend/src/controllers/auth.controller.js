import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import redis from '../config/redisClient.js';
import User from '../models/user.model.js';
import ApiError from '../utils/ApiError.js';
import { sendResponse } from '../utils/sendResponse.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../auth/emailHelpers.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../auth/tokenHelpers.js';
import { generateGuestToken, verifyGuestToken } from '../auth/guestTokenHelpers.js';
import { claimGuestData } from '../services/chapterProgress.service.js';
import { getAppBaseUrl } from '../utils/appUrl.js';

// Just a shape check. The real proof is the verification mail.
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// All in seconds. Short on purpose: a live link sitting in an inbox is risky.
const VERIFY_EMAIL_TTL = 60 * 60 * 24;
const RESET_PASSWORD_TTL = 60 * 15;
const OAUTH_CODE_TTL = 30;

// The password rules, in one place. Gives back the first problem it finds, or
// null if the password is fine. The caller decides how to report it.
const passwordProblem = (password) => {
  if (password.length < 8) return 'Password kam se kam 8 characters ka hona chahiye.';
  if (!/\d/.test(password)) return 'Password mein kam se kam ek number hona chahiye.';
  if (!/[A-Z]/.test(password)) return 'Password mein kam se kam ek uppercase letter hona chahiye.';
  return null;
};

// How hard bcrypt works. Higher is slower to crack and slower to log in.
const getSaltRounds = () => Number(process.env.BCRYPT_SALT_ROUNDS) || 12;

// Check what the student typed and give back the tidied name and email.
// Throws the first problem it finds.
const readSignupInput = ({ name, email, password }) => {
  if (!name || !email || !password) {
    throw new ApiError(400, 'Name, email aur password teeno zaroori hain.');
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!isValidEmail(cleanEmail)) {
    throw new ApiError(400, 'Valid email address dalo.');
  }

  const weakPassword = passwordProblem(password);
  if (weakPassword) {
    throw new ApiError(400, weakPassword);
  }

  return { cleanName, cleanEmail };
};

// Mail the verification link. If the mail does not go out, the whole signup is
// undone, so nobody is left with an account they can never verify.
const sendVerificationLink = async (user, email) => {
  const token = crypto.randomBytes(32).toString('hex');
  const userId = user._id.toString();

  // verifyEmail reads the first key. Nothing reads the second (BACKLOG O24).
  await redis.set(`verify_email:${token}`, userId, 'EX', VERIFY_EMAIL_TTL);
  await redis.set(`verify_email:${userId}`, token, 'EX', VERIFY_EMAIL_TTL);

  try {
    await sendVerificationEmail(email, token);
  } catch (emailError) {
    await User.deleteOne({ _id: user._id });
    await redis.del(`verify_email:${token}`);
    await redis.del(`verify_email:${userId}`);
    console.error('[Register] Email send failed, rolling back user creation:', emailError);
    throw new ApiError(500, 'Verification email nahi bheja ja saka. Thodi der baad dobara try karo.');
  }
};

// POST /api/v1/auth/register
// Save the user as unverified and mail a link. Mail fails, user is deleted.
export const register = async (req, res, next) => {
  try {
    const { password } = req.body;
    const { cleanName, cleanEmail } = readSignupInput(req.body);

    // Only for a clean error message. The unique index is the real guard.
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      throw new ApiError(400, 'Yeh email already registered hai.');
    }

    const passwordHash = await bcrypt.hash(password, getSaltRounds());

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      authProvider: 'email',
      isEmailVerified: false,
    });

    await sendVerificationLink(user, cleanEmail);

    return sendResponse(res, 201, {
      message: 'Registration successful! Please check your email to verify your account.',
    });

  } catch (err) {
    // Two signups in the same second: the index stops the later one.
    if (err.code === 11000) {
      return next(new ApiError(400, 'Yeh email already registered hai.'));
    }
    next(err);
  }
};

// A fake hash nothing matches. Comparing costs the same ~100ms as a real check,
// so a wrong email and a wrong password take the same time from outside.
const DUMMY_HASH = '$2b$12$KIXBnNGSPXV5zxNWEJZRPOqQmIJdZZqXP5kVXEzpAFgOYF0qOdVVa';

// 7 days. Cookie wants milliseconds, Redis wants seconds. Easy to mix up.
const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_REDIS_TTL = 7 * 24 * 60 * 60;

// Seconds. The old refresh token still works this long after a swap, so two
// tabs refreshing together do not log each other out. Logout clears it.
const REFRESH_TOKEN_GRACE_TTL = 20;

// Settings for the refresh cookie, used everywhere it is set or cleared.
// HttpOnly so page scripts cannot read it. In production the frontend is on
// another domain: SameSite=none, which needs Secure. CSRF is covered by CORS.
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
});

// Hand the refresh token to the browser.
const setRefreshCookie = (res, token) =>
  res.cookie('refreshToken', token, { ...refreshCookieOptions(), maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE });

// Log a student in: refresh token into Redis and into the cookie, access token
// back to the caller. Used by both password login and Google login.
const startSession = async (res, userId) => {
  const accessToken = generateAccessToken(userId);
  const refreshToken = generateRefreshToken(userId);

  await redis.set(`refresh_token:${userId}`, refreshToken, 'EX', REFRESH_TOKEN_REDIS_TTL);
  setRefreshCookie(res, refreshToken);

  return accessToken;
};

// Why this account cannot log in with a password. Null means it can.
const loginBlockedReason = (user) => {
  // Google users have no password saved.
  if (user.authProvider === 'google') {
    return new ApiError(401, 'This email is registered with Google. Please sign in with Google.');
  }
  if (!user.isEmailVerified) {
    return new ApiError(401, 'Please verify your email before logging in.');
  }
  if (!user.isActive) {
    return new ApiError(403, 'Your account has been disabled. Please contact support.');
  }
  return null;
};

// POST /api/v1/auth/login
// Password in. Access token in the reply, refresh token in a cookie.
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, 'Email and password are required.');
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      throw new ApiError(400, 'Please enter a valid email address.');
    }

    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      // Waste the same ~100ms a real check takes. See DUMMY_HASH above.
      await bcrypt.compare(password, DUMMY_HASH);
      throw new ApiError(401, 'Invalid credentials.');
    }

    const blocked = loginBlockedReason(user);
    if (blocked) throw blocked;

    const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordCorrect) {
      throw new ApiError(401, 'Invalid credentials.');
    }

    const userId = user._id.toString();
    const accessToken = await startSession(res, userId);

    console.log('[Auth] Login successful:', cleanEmail);

    // Only these five fields leave the server. Never passwordHash.
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

// POST /api/v1/auth/verify-email
// Token from the mail comes back, Redis says whose it is, mark them verified.
export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw new ApiError(400, 'Verification token missing hai.');
    }

    const userId = await redis.get(`verify_email:${token}`);

    if (!userId) {
      throw new ApiError(400, 'Verification link expire ho gaya hai ya invalid hai.');
    }

    const user = await User.findById(userId);
    if (!user) {
      // Token is in Redis but the user row is gone.
      await redis.del(`verify_email:${token}`);
      throw new ApiError(400, 'User nahi mila. Dobara register karo.');
    }

    user.isEmailVerified = true;
    await user.save();

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

// POST /api/v1/auth/logout
// Delete the refresh token from Redis and clear the cookie.
export const logout = async (req, res, next) => {
  try {
    // User id comes from the cookie, so logout works on an expired access token.
    const token = req.cookies?.refreshToken;
    if (token) {
      const decoded = verifyRefreshToken(token);
      if (decoded?.userId) {
        // Both slots, so nothing keeps working after a logout.
        await Promise.all([
          redis.del(`refresh_token:${decoded.userId}`),
          redis.del(`refresh_token_prev:${decoded.userId}`),
        ]).catch((redisErr) => {
          console.error('[Logout] Redis DEL failed:', redisErr);
        });
      }
    }

    res.clearCookie('refreshToken', { ...refreshCookieOptions(), path: '/' });

    return sendResponse(res, 200, { message: 'Logged out successfully.' });

  } catch (err) {
    next(err);
  }
};

// Is this the refresh token we are holding for this student? The one from just
// before a swap also counts, so two tabs refreshing together stay logged in.
const isKnownRefreshToken = async (userId, token, storedToken) => {
  if (storedToken === token) return true;

  const prevToken = await redis.get(`refresh_token_prev:${userId}`);
  return prevToken === token;
};

// POST /api/v1/auth/refresh
// Refresh cookie in, new access token out. The refresh token is swapped too.
export const refreshAccessToken = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return sendResponse(res, 401, { message: 'No refresh token.' });

    const decoded = verifyRefreshToken(token);
    if (!decoded || !decoded.userId) {
      return sendResponse(res, 401, { message: 'Invalid refresh token.' });
    }

    const userId = decoded.userId;
    const storedToken = await redis.get(`refresh_token:${userId}`);

    if (!await isKnownRefreshToken(userId, token, storedToken)) {
      return storedToken
        ? sendResponse(res, 401, { message: 'Invalid session.' })
        : sendResponse(res, 401, { message: 'Session expired. Please login again.' });
    }

    const accessToken = generateAccessToken(userId);
    const newRefreshToken = generateRefreshToken(userId);

    // Keep the old token usable for a few seconds before replacing it.
    if (storedToken) {
      await redis.set(`refresh_token_prev:${userId}`, storedToken, 'EX', REFRESH_TOKEN_GRACE_TTL);
    }
    await redis.set(`refresh_token:${userId}`, newRefreshToken, 'EX', REFRESH_TOKEN_REDIS_TTL);

    setRefreshCookie(res, newRefreshToken);

    return sendResponse(res, 200, { message: 'Token refreshed.', data: { accessToken } });

  } catch (err) {
    console.error('refreshAccessToken error:', err);
    return sendResponse(res, 500, { message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/v1/auth/forgot-password
// The reply is the same for a known and an unknown email, so nobody can use
// this to find out who has an account.
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

// POST /api/v1/auth/reset-password
// Sets the new password and logs the user out everywhere.
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return sendResponse(res, 400, { message: 'Token aur naya password dono zaroori hain.' });
    }

    const weakPassword = passwordProblem(newPassword);
    if (weakPassword) {
      return sendResponse(res, 400, { message: weakPassword });
    }

    const userId = await redis.get(`reset_password:${token}`);
    if (!userId) {
      return sendResponse(res, 400, { message: 'Reset link expired or invalid.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, getSaltRounds());

    await User.findByIdAndUpdate(userId, { passwordHash });

    await redis.del(`reset_password:${token}`);
    // A new password must end every old session at once.
    await redis.del(`refresh_token:${userId}`);
    await redis.del(`refresh_token_prev:${userId}`);

    return sendResponse(res, 200, { message: 'Password reset successful. Please login again.' });

  } catch (err) {
    console.error('resetPassword error:', err);
    return sendResponse(res, 500, { message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/v1/auth/google
// Sends the user to Google's sign-in screen.
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

// GET /api/v1/auth/me
// requireAuth already loaded the user, so there is no DB call here.
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

// Ask Google who this student is. Null means the sign-in did not work out.
const getGoogleProfile = async (code) => {
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  const { tokens } = await client.getToken(code);
  const idToken = tokens.id_token;
  if (!idToken) return null;

  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const googleId = payload.sub;
  const email = payload.email?.toLowerCase().trim();
  const name = payload.name || email.split('@')[0];
  if (!email) return null;

  return { googleId, email, name };
};

// Find the account for this Google profile, or make a new one. An error string
// means the student cannot sign in this way.
const findOrCreateGoogleUser = async ({ googleId, email, name }) => {
  const user = await User.findOne({ email });

  if (!user) {
    const created = await User.create({
      name,
      email,
      authProvider: 'google',
      googleId,
      isEmailVerified: true,
      passwordHash: null,
    });
    return { user: created };
  }

  if (user.authProvider !== 'google') return { error: 'account_exists' };
  if (!user.isActive) return { error: 'account_disabled' };
  return { user };
};

// Log the student in and hand back a one-time code. The access token never
// travels in the URL, so the frontend posts this code to /auth/exchange.
const startGoogleSession = async (res, user) => {
  const accessToken = await startSession(res, user._id.toString());

  const oauthCode = crypto.randomBytes(32).toString('hex');
  await redis.set(`oauth_code:${oauthCode}`, accessToken, 'EX', OAUTH_CODE_TTL);
  console.log('[GoogleCallback] OAuth exchange code generated.');
  return oauthCode;
};

// GET /api/v1/auth/google/callback
// Google sends the user back here. Find or create the account, start a session,
// then hand the frontend a one-time code.
export const googleCallback = async (req, res) => {
  // One origin to send the user back to. The FRONTEND_URL env var is the CORS
  // list and can hold many, so it cannot be used here. See utils/appUrl.js.
  const appBaseUrl = getAppBaseUrl();
  const backToApp = (query) => res.redirect(`${appBaseUrl}/auth/callback?${query}`);

  try {
    const { code } = req.query;
    if (!code) return backToApp('error=google_cancelled');

    const profile = await getGoogleProfile(code);
    if (!profile) return backToApp('error=google_failed');

    const { user, error } = await findOrCreateGoogleUser(profile);
    if (error) return backToApp(`error=${error}`);

    const oauthCode = await startGoogleSession(res, user);
    return backToApp(`code=${oauthCode}`);

  } catch (err) {
    console.error('[GoogleCallback] Error:', err);
    return backToApp('error=google_failed');
  }
};

// POST /api/v1/auth/exchange
// Trades the one-time code from the Google redirect for the real access token.
// Works once, and only within 30 seconds.
export const exchangeOAuthCode = async (req, res, next) => {
  try {
    const { code } = req.body;

    // Check the shape before touching Redis.
    const CODE_REGEX = /^[0-9a-f]{64}$/;
    if (!code || !CODE_REGEX.test(code)) {
      return next(new ApiError(400, 'Invalid request.'));
    }

    // GET then DEL, so this works on every Redis version.
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

// POST /api/v1/auth/guest
// Gives the browser a signed guest id, sent back as the X-Guest-Id header.
// Signed, so a guest cannot invent a new id to get past the free limit.
export const issueGuestToken = async (_req, res) => {
  return sendResponse(res, 200, {
    message: 'Guest token issued.',
    data: { guestToken: generateGuestToken() },
  });
};

// POST /api/v1/auth/claim-guest-progress
// Runs once right after login. Moves everything the guest studied onto the new
// account. No guest id is fine, not an error. The id must come from the signed
// header, never the body, or one user could claim another user's work.
export const claimGuestProgress = async (req, res, next) => {
  try {
    const guestId = verifyGuestToken(req.headers['x-guest-id']);

    if (!guestId) {
      return sendResponse(res, 200, {
        message: 'No valid guest identity — nothing to claim.',
        data: { chaptersTransferred: 0, chaptersMerged: 0, chatSessionsTransferred: 0 },
      });
    }

    const result = await claimGuestData(req.user.id, guestId);

    return sendResponse(res, 200, {
      message: 'Guest progress claimed.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
