// Server-minted guest identity token.
//
// Before Phase 5 the browser generated its own guest id (crypto.randomUUID) and
// stored it under `zuno-guest-id`. Now the server issues a signed token via
// POST /api/v1/auth/guest and we store THAT under the same key — so every place
// that already reads `zuno-guest-id` and sends it as the X-Guest-Id header keeps
// working, it just carries a token instead of a raw UUID.
//
// The backend accepts both during the transition window, so a stale UUID in
// localStorage still works until ensureGuestToken() upgrades it.

const GUEST_KEY = 'zuno-guest-id';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The current X-Guest-Id header value: a signed token, or (briefly, mid-upgrade)
// a legacy UUID, or null for a brand-new visitor before the first mint lands.
export const getGuestIdHeader = () => localStorage.getItem(GUEST_KEY) || null;

export const clearGuestToken = () => localStorage.removeItem(GUEST_KEY);

// Ensures a server-signed guest token is in localStorage. Idempotent and safe to
// call on every app load. If a legacy UUID is already stored it is handed to the
// server for one-time adoption so the guest keeps their existing progress.
// On any failure it leaves whatever was there (the backend still accepts a
// legacy UUID during the transition), so this never blocks the app.
let inFlight = null;
export const ensureGuestToken = () => {
  const current = localStorage.getItem(GUEST_KEY);

  // Already a token (anything that isn't a bare UUID) — nothing to do.
  if (current && !UUID_RE.test(current)) return Promise.resolve(current);

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const legacyGuestId = current && UUID_RE.test(current) ? current : undefined;
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(legacyGuestId ? { legacyGuestId } : {}),
      });
      if (!res.ok) return current || null;

      const data = await res.json();
      const token = data?.data?.guestToken;
      if (token) {
        localStorage.setItem(GUEST_KEY, token);
        return token;
      }
      return current || null;
    } catch {
      return current || null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};
