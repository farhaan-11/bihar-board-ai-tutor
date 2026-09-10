import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { loginUser, claimGuestProgress } from '../services/axios/authService';
import { setCredentials } from '../store/slices/authSlice';
import { clearSessionId } from '../utils/session';
import { getGuestIdHeader, clearGuestToken } from '../utils/guestToken';
import { resetGuestTurnCount } from '../utils/guestLimit';
import Toast from '../components/Toast';
import { useToast } from '../hooks/useToast';

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    '& fieldset': { borderColor: 'var(--border)' },
    '&:hover fieldset': { borderColor: 'var(--border-strong)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--primary)', borderWidth: '1.5px' },
    backgroundColor: 'var(--bg-input)',
  },
  '& .MuiInputLabel-root': { color: 'var(--text-muted)' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--primary)' },
  '& .MuiInputBase-input': { color: 'var(--text-primary)' },
  '& .MuiInputAdornment-root': { color: 'var(--text-muted)' },
};

const GOOGLE_G = (
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
    <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>
);

function validateEmail(value) {
  if (!value.trim()) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Enter a valid email address';
  return '';
}

function validatePassword(value) {
  if (!value) return 'Password is required';
  return '';
}

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { toast, showToast, hideToast } = useToast();

  useEffect(() => {
    const redirectMsg = sessionStorage.getItem('zuno.authRedirect');
    if (redirectMsg) {
      showToast(redirectMsg, 'error');
      sessionStorage.removeItem('zuno.authRedirect');
    } else if (location.state?.toastError) {
      showToast(location.state.toastError, 'error');
    } else if (location.state?.toastSuccess) {
      showToast(location.state.toastSuccess, 'success');
    }
    if (location.state) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const hasErrors = !!(errors.email || errors.password);
  const hasEmpty = !email.trim() || !password;
  const isDisabled = hasErrors || hasEmpty || loading;

  function handleBlurEmail() {
    setErrors(e => ({ ...e, email: validateEmail(email) }));
  }
  function handleBlurPassword() {
    setErrors(e => ({ ...e, password: validatePassword(password) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const emailErr = validateEmail(email);
    const pwErr = validatePassword(password);
    setErrors({ email: emailErr, password: pwErr });
    if (emailErr || pwErr) return;

    setLoading(true);
    try {
      const data = await loginUser({ email: email.trim(), password });
      const accessToken = data.data?.accessToken || data.accessToken;
      const user = data.data?.user;

      const guestToken = getGuestIdHeader();
      if (guestToken) {
        await claimGuestProgress(accessToken, guestToken);
        clearGuestToken();
      }

      clearSessionId();
      resetGuestTurnCount();
      dispatch(setCredentials({ user, accessToken }));
      navigate('/chat', { state: { toastSuccess: 'Login ho gaya! Padhai shuru karo.' } });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Login — Zuno AI Tutor</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="auth-page">
      <div className="auth-card">

        {/* Left — brand panel */}
        <div className="auth-split-left">
          <div className="auth-brand-z">Z</div>
          <div className="auth-brand-name">Zuno</div>
          <div className="auth-brand-tag">apni boli mein</div>
          <ul className="auth-vp-list">
            <li className="auth-vp-item"><div className="auth-vp-dot" />Bihar Board Class 10 syllabus</li>
            <li className="auth-vp-item"><div className="auth-vp-dot" />Hinglish mein seedha jawab</li>
            <li className="auth-vp-item"><div className="auth-vp-dot" />Focus mode — chapter-wise padhai</li>
            <li className="auth-vp-item"><div className="auth-vp-dot" />Bilkul free</li>
          </ul>
        </div>

        {/* Right — form panel */}
        <div className="auth-split-right">
          <h2 className="auth-heading">Wapas aa gaye. Chalte hain.</h2>
          <p className="auth-subtext">Class 10 ka sawaal pooch — seedha jawab milega, apni boli mein.</p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-fields">
              <div className="auth-field-wrap">
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onBlur={handleBlurEmail}
                  error={!!errors.email}
                  fullWidth
                  variant="outlined"
                  size="small"
                  sx={FIELD_SX}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <MailOutlineRounded sx={{ fontSize: 17 }} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                {errors.email && <span className="auth-field-error">{errors.email}</span>}
              </div>

              <div className="auth-field-wrap">
                <TextField
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onBlur={handleBlurPassword}
                  error={!!errors.password}
                  fullWidth
                  variant="outlined"
                  size="small"
                  sx={FIELD_SX}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockOutlined sx={{ fontSize: 17 }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowPassword(v => !v)}
                            edge="end"
                            size="small"
                            tabIndex={-1}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            sx={{ color: 'var(--text-muted)' }}
                          >
                            {showPassword
                              ? <VisibilityOffRounded fontSize="small" />
                              : <VisibilityRounded fontSize="small" />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                {errors.password && <span className="auth-field-error">{errors.password}</span>}
              </div>
            </div>

            <div style={{ textAlign: 'right', marginTop: '6px', marginBottom: '16px' }}>
              <span
                className="auth-bottom-link"
                style={{ fontSize: '0.8rem', cursor: 'pointer' }}
                onClick={() => navigate('/forgot-password')}
              >
                Forgot password?
              </span>
            </div>

            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={isDisabled}
              endIcon={<ArrowForwardRounded sx={{ fontSize: '16px !important' }} />}
              sx={{
                py: '10px',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                '&:hover': { backgroundColor: 'var(--primary-hover)', boxShadow: 'none' },
                '&.Mui-disabled': { backgroundColor: 'var(--primary)', opacity: 0.5, color: '#ffffff' },
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.9rem',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'none',
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="auth-divider">or</div>

          <button
            type="button"
            className="btn-google"
            disabled={loading}
            onClick={() => {
              window.location.href = `${import.meta.env.VITE_API_BASE_URL}/api/v1/auth/google`;
            }}
          >
            {GOOGLE_G}
            Continue with Google
          </button>

          <div className="auth-bottom-link">
            Don't have an account?{' '}
            <a role="button" tabIndex={0} onClick={() => navigate('/register')} onKeyDown={e => e.key === 'Enter' && navigate('/register')}>Sign up</a>
          </div>
        </div>

      </div>
      <Toast open={toast.open} message={toast.message} severity={toast.severity} onClose={hideToast} />
      </div>
    </>
  );
}

export default LoginPage;
