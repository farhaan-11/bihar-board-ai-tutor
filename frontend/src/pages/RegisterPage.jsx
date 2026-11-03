import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, Link } from 'react-router-dom';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import { registerUser } from '../services/axios/authService';
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

const BrandPanel = () => (
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
);

function getPasswordStrength(password) {
  const len = password.length;
  const hasNumber = /\d/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  if (len >= 10 && hasNumber && hasUpper && hasSpecial) {
    return { label: 'Strong', color: '#22c55e', width: '100%' };
  }
  if (len >= 8 && hasNumber && hasUpper) {
    return { label: 'Good', color: '#84cc16', width: '75%' };
  }
  if (len >= 6) {
    return { label: 'Fair', color: '#f97316', width: '50%' };
  }
  return { label: 'Weak', color: '#ef4444', width: '25%' };
}

function validateName(value) {
  if (!value.trim()) return 'Name is required';
  if (value.trim().length < 2) return 'Name must be at least 2 characters';
  if (value.trim().length > 50) return 'Name is too long';
  return '';
}

function validateEmail(value) {
  if (!value.trim()) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Enter a valid email address';
  return '';
}

function validatePassword(value) {
  if (!value) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (!/\d/.test(value)) return 'Password must contain at least one number';
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter';
  return '';
}

function RegisterPage() {
  const navigate = useNavigate();
  const { toast, showToast, hideToast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const strength = password ? getPasswordStrength(password) : null;
  const hasErrors = !!(errors.name || errors.email || errors.password);
  const hasEmpty = !name.trim() || !email.trim() || !password;
  const isDisabled = hasErrors || hasEmpty || loading || !agreed;

  function handleBlurName() {
    setErrors(e => ({ ...e, name: validateName(name) }));
  }
  function handleBlurEmail() {
    setErrors(e => ({ ...e, email: validateEmail(email) }));
  }
  function handleBlurPassword() {
    setErrors(e => ({ ...e, password: validatePassword(password) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const nameErr = validateName(name);
    const emailErr = validateEmail(email);
    const pwErr = validatePassword(password);
    setErrors({ name: nameErr, email: emailErr, password: pwErr });
    if (nameErr || emailErr || pwErr) return;

    setLoading(true);
    try {
      await registerUser({ name: name.trim(), email: email.trim(), password });
      setSubmitted(true);
      showToast('Verification email sent! Please check your inbox.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <BrandPanel />
          <div className="auth-split-right">
            <div className="auth-success-body">
              <CheckCircleOutlineRounded sx={{ fontSize: 48, color: 'var(--primary)', mb: 1.5 }} />
              <h2 className="auth-heading" style={{ textAlign: 'center' }}>Check your email</h2>
              <p className="auth-subtext" style={{ textAlign: 'center' }}>
                We've sent a verification link to your email address. The link is valid for 24 hours.
              </p>
              <div className="auth-bottom-link">
                <a role="button" tabIndex={0} onClick={() => navigate('/login')} onKeyDown={e => e.key === 'Enter' && navigate('/login')}>Login pe jaao →</a>
              </div>
            </div>
          </div>
        </div>
        <Toast open={toast.open} message={toast.message} severity={toast.severity} onClose={hideToast} />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Account Banao — Zuno AI Tutor</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="auth-page">
      <div className="auth-card">

        {/* Left — brand panel */}
        <BrandPanel />

        {/* Right — form panel */}
        <div className="auth-split-right">
          <h2 className="auth-heading">Ruko mat. Pooch lo.</h2>
          <p className="auth-subtext">Sawaal apni boli mein — jawab bhi apni boli mein.</p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-fields">
              <div className="auth-field-wrap">
                <TextField
                  label="Full Name"
                  autoComplete="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={handleBlurName}
                  error={!!errors.name}
                  fullWidth
                  variant="outlined"
                  size="small"
                  sx={FIELD_SX}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonOutlineRounded sx={{ fontSize: 17 }} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                {errors.name && <span className="auth-field-error">{errors.name}</span>}
              </div>

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
                  autoComplete="new-password"
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
                {password && strength && (
                  <div className="auth-strength">
                    <div className="password-strength-bar-track">
                      <div
                        className="password-strength-bar-fill"
                        style={{ width: strength.width, backgroundColor: strength.color }}
                      />
                    </div>
                    <span className="password-strength-label">{strength.label}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Consent — ADR-013: one required checkbox gates signup; age/parent clause lives inside Terms */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16 }}>
              <Checkbox
                id="agree-terms"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                size="small"
                sx={{ p: 0, mt: '1px', color: 'var(--border-strong)', '&.Mui-checked': { color: 'var(--primary)' } }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Main{' '}
                <Link to="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Terms of Use</Link>
                {' '}aur{' '}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Privacy Policy</Link>
                {' '}se agree karta hoon
              </span>
            </div>

            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={isDisabled}
              endIcon={<ArrowForwardRounded sx={{ fontSize: '16px !important' }} />}
              sx={{
                mt: '20px',
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
              {loading ? 'Creating account...' : 'Create Account'}
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

          {/* Google can create a new account from here or from Login, so it carries the
              same visible consent notice (ADR-013). The checkbox above gates the email form. */}
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
            Google se continue karke tum{' '}
            <Link to="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Terms</Link>
            {' '}&{' '}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Privacy</Link>
            {' '}se agree karte ho
          </p>

          <div className="auth-bottom-link">
            Already have an account?{' '}
            <a role="button" tabIndex={0} onClick={() => navigate('/login')} onKeyDown={e => e.key === 'Enter' && navigate('/login')}>Sign in</a>
          </div>
        </div>

      </div>
      <Toast open={toast.open} message={toast.message} severity={toast.severity} onClose={hideToast} />
      </div>
    </>
  );
}

export default RegisterPage;
