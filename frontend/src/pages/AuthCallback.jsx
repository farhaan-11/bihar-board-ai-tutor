import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { setCredentials, setError } from '../store/slices/authSlice.js';
import { getMe, exchangeAuthCode, claimGuestProgress } from '../services/axios/authService.js';
import { getGuestIdHeader, clearGuestToken } from '../utils/guestToken.js';
import { resetGuestTurnCount } from '../utils/guestLimit.js';
import ZunoMark from '../components/ZunoMark.jsx';

// Friendly messages for known Google OAuth error codes
const ERROR_MESSAGES = {
  account_exists: 'Yeh email already registered hai. Please login karo.',
  google_failed: 'Google sign-in fail hua. Please dobara try karo.',
  google_cancelled: 'Google sign-in cancel ho gaya. Dobara try karo.',
  account_disabled: 'Aapka account disabled hai. Support se contact karo.',
};

// Handles the redirect back from Google OAuth.
// Backend sends: /auth/callback?code=<one-time-exchange-code> (30s TTL, single-use)
// Error case:    /auth/callback?error=account_exists | google_failed
// On success: POSTs /auth/exchange with the code to receive the access token in JSON.
function AuthCallback() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [statusText, setStatusText] = useState('Logging you in...');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    const codeParam = params.get('code');

    const handleCallback = async () => {
      if (errorParam) {
        const message =
          ERROR_MESSAGES[errorParam] || 'Login fail hua. Please dobara try karo.';
        dispatch(setError(message));
        navigate('/login', { state: { toastError: message } });
        return;
      }

      if (codeParam) {
        try {
          // Step 1: Exchange one-time code for access token (token never was in the URL)
          const accessToken = await exchangeAuthCode(codeParam);
          // Step 2: Fetch user profile using the received token
          const user = await getMe(accessToken);

          const guestToken = getGuestIdHeader();
          if (guestToken) {
            await claimGuestProgress(accessToken, guestToken);
            clearGuestToken();
          }

          resetGuestTurnCount();
          dispatch(setCredentials({ user, accessToken }));
          navigate('/chat', { replace: true, state: { toastSuccess: 'Google se login successful!' } });
        } catch {
          setStatusText('Login mein error aaya. Please dobara try karo.');
          setTimeout(() => { navigate('/login', { state: { toastError: 'Login mein error aaya. Please dobara try karo.' } }); }, 2000);
        }
        return;
      }

      // Neither code nor error — unexpected state, send to login
      navigate('/login');
    };

    handleCallback();
  }, [dispatch, navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card-single" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="auth-logo-row">
          <ZunoMark />
          <span className="auth-logo-text">Zuno</span>
        </div>
        <p className="auth-subtext" style={{ margin: 0 }}>{statusText}</p>
      </div>
    </div>
  );
}

export default AuthCallback;
