import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

// All auth calls use a plain axios instance — NOT axiosInstance.
// Reason: auth calls don't need a Bearer token, and using axiosInstance would
// risk the response interceptor triggering a refresh loop on auth failures.
const authAxios = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // needed to send/receive the HttpOnly refresh token cookie
});

export const loginUser = async ({ email, password }) => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/login', { email, password });
    return data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Login fail hua. Please dobara try karo.'
    );
  }
};

export const registerUser = async ({ name, email, password }) => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/register', { name, email, password });
    return data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Registration fail hui. Please dobara try karo.'
    );
  }
};

export const logoutUser = async () => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/logout');
    return data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Logout fail hua.'
    );
  }
};

export const refreshAccessToken = async () => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/refresh');
    return data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Session expire ho gayi. Please login karo.'
    );
  }
};

export const getMe = async (accessToken) => {
  try {
    const { data } = await authAxios.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Backend returns { success, data: { user: {...} } }
    // Normalize here so all callers get the user object directly
    return data?.data?.user || data?.data || data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'User info load nahi hui.'
    );
  }
};

// POST /api/v1/auth/exchange
// Exchanges the one-time OAuth code (from Google callback URL) for an access token
export const exchangeAuthCode = async (code) => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/exchange', { code });
    return data?.data?.accessToken;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Login fail hua. Please dobara Google se login karo.'
    );
  }
};

// POST /api/v1/auth/claim-guest-progress
// Transfers a guest's chapter progress + quiz history + chat sessions onto the
// now-authenticated user. The guest identity travels in the X-Guest-Id header
// (a server-signed token, or a legacy UUID mid-transition) — the backend reads
// it there, not from the body. Best-effort — never throws, so a failure here
// can't block the login flow.
export const claimGuestProgress = async (accessToken, guestIdOrToken) => {
  try {
    const { data } = await authAxios.post(
      '/api/v1/auth/claim-guest-progress',
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(guestIdOrToken ? { 'X-Guest-Id': guestIdOrToken } : {}),
        },
      }
    );
    return data?.data || null;
  } catch (error) {
    console.error('[claimGuestProgress] failed (non-critical):', error.message);
    return null;
  }
};

// POST /api/v1/auth/verify-email
// token: string from URL query param
export const verifyEmailToken = async (token) => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/verify-email', { token });
    return data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Email verify nahi ho saka. Please dobara try karo.'
    );
  }
};

// POST /api/v1/auth/forgot-password
export const forgotPasswordRequest = async (email) => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/forgot-password', { email });
    return data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Request fail hui. Please dobara try karo.'
    );
  }
};

// POST /api/v1/auth/reset-password
// token: from URL query param, newPassword: user input
export const resetPasswordRequest = async (token, newPassword) => {
  try {
    const { data } = await authAxios.post('/api/v1/auth/reset-password', { token, newPassword });
    return data;
  } catch (error) {
    throw new Error(
      error.response?.data?.message || 'Password reset nahi hua. Please dobara try karo.'
    );
  }
};
