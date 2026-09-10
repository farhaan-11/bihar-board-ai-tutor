import axios from 'axios';
import { clearCredentials, setCredentials } from '../../store/slices/authSlice.js';
import { getGuestIdHeader } from '../../utils/guestToken.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

// Store is injected after creation to avoid circular dependency
// (store imports authSlice → axiosInstance imports store would be circular)
let storeRef = null;
export const injectStore = (store) => { storeRef = store; };

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // send HttpOnly refresh token cookie on every request
});

// Tracks whether a token refresh is in progress
let isRefreshing = false;
// Requests that arrived while a refresh was in progress, waiting to be retried
let failedQueue = [];

// Resolve or reject all queued requests once refresh completes
const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Retry the original request with the new access token
const retryRequest = (originalRequest, token) => {
  originalRequest.headers['Authorization'] = `Bearer ${token}`;
  return axiosInstance(originalRequest);
};

// Attach Bearer token to outgoing requests if we have one in the store.
// Otherwise attach the server-minted guest token (utils/guestToken.js) as
// X-Guest-Id so an unauthenticated visitor's progress is tracked. Null only for
// the brief window before ensureGuestToken() (called from main.jsx) resolves.
axiosInstance.interceptors.request.use((config) => {
  const token = storeRef?.getState().auth.accessToken;
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  } else {
    const guestId = getGuestIdHeader();
    if (guestId) config.headers['X-Guest-Id'] = guestId;
  }
  return config;
});

// Handle 401 responses by attempting a silent token refresh, then retrying
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // Auth calls must never trigger a refresh retry — that would cause infinite loops
    if (
      originalRequest.url.includes('/auth/refresh') ||
      originalRequest.url.includes('/auth/login')
    ) {
      return Promise.reject(error);
    }

    // If a refresh is already underway, queue this request and wait
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => retryRequest(originalRequest, token))
        .catch((err) => Promise.reject(err));
    }

    isRefreshing = true;

    try {
      // Use plain axios here — NOT axiosInstance — to avoid the response interceptor
      // triggering again on the refresh call itself
      const { data } = await axios.post(
        `${API_BASE_URL}/api/v1/auth/refresh`,
        {},
        { withCredentials: true }
      );
      const newToken = data.data?.accessToken || data.accessToken;

      storeRef?.dispatch(
        setCredentials({
          user: storeRef.getState().auth.user,
          accessToken: newToken,
        })
      );

      processQueue(null, newToken);
      return retryRequest(originalRequest, newToken);
    } catch (refreshError) {
      processQueue(refreshError, null);
      storeRef?.dispatch(clearCredentials());
      sessionStorage.setItem('zuno.authRedirect', 'Session expire ho gayi. Dobara login karo.');
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default axiosInstance;
