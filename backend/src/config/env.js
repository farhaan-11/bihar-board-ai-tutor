import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');

dotenv.config({
  path: path.resolve(backendRoot, '.env'),
});

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 5000),
  mongodbUri: process.env.MONGODB_URI || process.env.MONGO_URI || '',
  sessionTokenLimit: toNumber(process.env.SESSION_TOKEN_LIMIT, 15000),
  sessionsListLimit: toNumber(process.env.SESSIONS_LIST_LIMIT, 20),
  guestTurnLimit: toNumber(process.env.GUEST_TURN_LIMIT, 5),
  // Phase 3: max casual/off-topic turns before hard block per session.
  // Math.max(1,...) guards against 0 or negative values in .env.
  maxNonAcademicTurns: Math.max(1, toNumber(process.env.MAX_NON_ACADEMIC_TURNS, 10)),
};

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const VALID_PROVIDERS = ['groq', 'openai', 'google'];

// Maps each provider to its required API key(s).
// To add a new provider: add one entry here — no other logic changes needed.
const PROVIDER_KEY_MAP = {
  groq: ['GROQ_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY'], // GEMINI_API_KEY accepted as fallback (see hasProviderKey)
};

// Mirrors the isUsableApiKey check in geminiEmbeddings.js — rejects placeholder
// values like "...", "your_key_here", and anything suspiciously short.
const isRealKey = (value) =>
  typeof value === 'string' &&
  value.trim().length > 10 &&
  !value.includes('your_') &&
  value !== '...';

// Returns true if the required key for this provider has a real (non-placeholder) value.
// Handles the google special case where GEMINI_API_KEY is accepted as a fallback
// (mirrors the behaviour in chatModel.js and geminiEmbeddings.js).
const hasProviderKey = (provider, key) => {
  if (provider === 'google' && key === 'GOOGLE_API_KEY') {
    return isRealKey(process.env.GOOGLE_API_KEY) || isRealKey(process.env.GEMINI_API_KEY);
  }
  return isRealKey(process.env[key]);
};

/**
 * Validates all required environment variables before the server starts.
 * Collects every missing variable, then logs them together and exits.
 * Call this as the very first thing in server.js.
 */
export const validateEnv = () => {
  const missing = [];

  // MongoDB — MONGO_URI accepted as fallback (mirrors existing env.mongodbUri logic)
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    missing.push('MONGODB_URI');
  }

  // Embeddings key — required key depends on EMBEDDING_PROVIDER
  // EMBEDDING_PROVIDER=openai  → needs OPENAI_API_KEY
  // EMBEDDING_PROVIDER=google (default) → needs GEMINI_API_KEY or GOOGLE_API_KEY
  const embeddingProvider = (process.env.EMBEDDING_PROVIDER || 'google').toLowerCase();
  if (embeddingProvider === 'openai') {
    if (!isRealKey(process.env.OPENAI_API_KEY)) {
      missing.push('OPENAI_API_KEY (required when EMBEDDING_PROVIDER=openai)');
    }
  } else {
    if (!isRealKey(process.env.GEMINI_API_KEY) && !isRealKey(process.env.GOOGLE_API_KEY)) {
      missing.push('GEMINI_API_KEY');
    }
  }

  // LLM provider presence and validity
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (!provider) {
    missing.push('LLM_PROVIDER');
  } else if (!VALID_PROVIDERS.includes(provider)) {
    missing.push(
      `LLM_PROVIDER — got "${provider}", must be one of: ${VALID_PROVIDERS.join(', ')}`
    );
  } else {
    // Provider-specific API key check
    for (const key of PROVIDER_KEY_MAP[provider] ?? []) {
      if (!hasProviderKey(provider, key)) {
        missing.push(key);
      }
    }
  }

  // Email — required for sending verification and reset emails
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_HOST.trim()) {
    missing.push('EMAIL_HOST (e.g. smtp.gmail.com)');
  }
  if (!process.env.EMAIL_USER || !process.env.EMAIL_USER.trim()) {
    missing.push('EMAIL_USER');
  }
  if (!process.env.EMAIL_PASS || !process.env.EMAIL_PASS.trim()) {
    missing.push('EMAIL_PASS');
  }

  // Frontend URL — required for building email links
  if (!process.env.FRONTEND_URL || !process.env.FRONTEND_URL.trim()) {
    missing.push('FRONTEND_URL');
  }

  // JWT — required for issuing/verifying access + refresh tokens (login, register,
  // Google OAuth, refresh all sign tokens with these). Presence only, not isRealKey():
  // isRealKey()'s length>10 threshold is tuned for API-key placeholders and would
  // reject legitimate short secrets — a separate weak-secret warning below covers that.
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_ACCESS_SECRET.trim()) {
    missing.push('JWT_ACCESS_SECRET');
  }
  if (!process.env.JWT_REFRESH_SECRET || !process.env.JWT_REFRESH_SECRET.trim()) {
    missing.push('JWT_REFRESH_SECRET');
  }

  // Guest identity token secret — signs the server-minted guest tokens that
  // replace client-generated guest ids (see auth/guestTokenHelpers.js). Same
  // class as the JWT secrets above: presence-checked, not isRealKey() (a short
  // but real secret is legitimate; the weak-secret warning below covers length).
  if (!process.env.GUEST_TOKEN_SECRET || !process.env.GUEST_TOKEN_SECRET.trim()) {
    missing.push('GUEST_TOKEN_SECRET');
  }

  // Google OAuth — required for the "Continue with Google" flow. If missing, the
  // failure is silent (no thrown error — google-auth-library happily builds a URL
  // with an empty client_id), so this is the one auth flow that fails without ever
  // producing a server-side log line. Must be caught here instead.
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_ID.trim()) {
    missing.push('GOOGLE_CLIENT_ID');
  }
  if (!process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_CLIENT_SECRET.trim()) {
    missing.push('GOOGLE_CLIENT_SECRET');
  }
  if (!process.env.GOOGLE_CALLBACK_URL || !process.env.GOOGLE_CALLBACK_URL.trim()) {
    missing.push('GOOGLE_CALLBACK_URL');
  }

  if (missing.length > 0) {
    console.error(
      '\n[Zuno] ❌ Server startup failed — missing required environment variables:\n\n' +
        missing.map((k) => `  * ${k}`).join('\n') +
        '\n\nFix these in backend/.env and restart.\n'
    );
    process.exit(1);
  }

  // Weak-secret warning — non-blocking. A short JWT secret still works (server
  // starts, tokens sign/verify fine), it's just easier to brute-force. Warn instead
  // of failing so an existing short-but-functional secret doesn't suddenly block startup.
  const MIN_JWT_SECRET_LENGTH = 32;
  if (process.env.JWT_ACCESS_SECRET.trim().length < MIN_JWT_SECRET_LENGTH) {
    console.warn(
      `[Zuno] ⚠️  JWT_ACCESS_SECRET is only ${process.env.JWT_ACCESS_SECRET.trim().length} characters — ` +
        `recommend at least ${MIN_JWT_SECRET_LENGTH} random characters for production.`
    );
  }
  if (process.env.JWT_REFRESH_SECRET.trim().length < MIN_JWT_SECRET_LENGTH) {
    console.warn(
      `[Zuno] ⚠️  JWT_REFRESH_SECRET is only ${process.env.JWT_REFRESH_SECRET.trim().length} characters — ` +
        `recommend at least ${MIN_JWT_SECRET_LENGTH} random characters for production.`
    );
  }
  if (process.env.GUEST_TOKEN_SECRET.trim().length < MIN_JWT_SECRET_LENGTH) {
    console.warn(
      `[Zuno] ⚠️  GUEST_TOKEN_SECRET is only ${process.env.GUEST_TOKEN_SECRET.trim().length} characters — ` +
        `recommend at least ${MIN_JWT_SECRET_LENGTH} random characters for production.`
    );
  }
};
