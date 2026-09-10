// Server-minted guest identity token.
//
// The browser used to generate its own guest id (crypto.randomUUID) and store it
// under `zuno-guest-id`. Now the server issues a signed token via
// POST /api/v1/auth/guest and we store THAT under the same key — so every place
// that already reads `zuno-guest-id` and sends it as the X-Guest-Id header keeps
// working, it just carries a token instead of a raw UUID.

const GUEST_KEY = 'zuno-guest-id';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

// A JWT has two dots; a bare legacy UUID has none. Used only to detect a stale
// pre-migration value that needs replacing with a real token.
const isToken = (v) => typeof v === 'string' && v.split('.').length === 3;

// The current X-Guest-Id header value: a signed token, or null for a brand-new
// visitor before the first mint lands.
export const getGuestIdHeader = () => {
  const v = localStorage.getItem(GUEST_KEY);
  return isToken(v) ? v : null;
};

export const clearGuestToken = () => localStorage.removeItem(GUEST_KEY);

// Ensures a server-signed guest token is in localStorage. Idempotent and safe to
// call on every app load. On failure it leaves storage untouched and returns
// null, so it never blocks the app — the next call retries.
let inFlight = null;
export const ensureGuestToken = () => {
  const current = localStorage.getItem(GUEST_KEY);
  if (isToken(current)) return Promise.resolve(current);

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}',
      });
      if (!res.ok) return null;

      const data = await res.json();
      const token = data?.data?.guestToken;
      if (token) {
        localStorage.setItem(GUEST_KEY, token);
        return token;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};
