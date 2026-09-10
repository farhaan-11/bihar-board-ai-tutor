import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { clearCredentials } from '../store/slices/authSlice.js';
import { logoutUser } from '../services/axios/authService.js';
import { clearSessionId } from '../utils/session.js';
import { ensureGuestToken } from '../utils/guestToken.js';

// Shared by the desktop account menu and the mobile account sheet.
export function useLogout() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  return useCallback(async () => {
    try {
      await logoutUser();
    } catch {
      // Even if API call fails, clear local state and redirect
    }
    clearSessionId();
    localStorage.removeItem('zuno-guest-id');
    // Give the now-logged-out visitor a fresh guest identity (no page reload here).
    ensureGuestToken();
    dispatch(clearCredentials());
    navigate('/');
  }, [dispatch, navigate]);
}
