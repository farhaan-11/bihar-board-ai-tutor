// Resolves the single canonical frontend origin this backend sends users to —
// used for the OAuth login redirect and for links inside emails.
//
// This is deliberately SEPARATE from FRONTEND_URL. FRONTEND_URL is the CORS
// allow-list and may legitimately be a comma-separated list of origins (e.g.
// a docker frontend on :8080 and a vite dev server on :5173). But one running
// backend can only redirect an OAuth login — or point an email link — at ONE
// frontend, so that target needs its own single-value setting. Overloading the
// list for both roles is what sent local Google logins to the wrong port.
//
// APP_BASE_URL (preferred): the exact single origin, e.g. http://localhost:5173
// in dev, http://localhost:8080 for the docker stack, or https://learnzuno.in
// in production.
//
// Fallback (APP_BASE_URL unset): the first entry of FRONTEND_URL — the original
// behavior — so any environment that has not set APP_BASE_URL yet keeps working
// exactly as before.
export function getAppBaseUrl() {
  const explicit = (process.env.APP_BASE_URL || '').trim();
  const base =
    explicit || (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
  return base.replace(/\/+$/, '');
}
