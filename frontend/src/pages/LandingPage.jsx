import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, Link } from 'react-router-dom';
import BoltRounded from '@mui/icons-material/BoltRounded';
import LoginRounded from '@mui/icons-material/LoginRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ZunoMark from '../components/ZunoMark.jsx';

function LandingPage() {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>Zuno — Bihar Board Class 10 Science AI Tutor | Hindi Mein Padho</title>
        <meta
          name="description"
          content="Zuno AI Tutor se Bihar Board Class 10 Science ke doubts poochho — Hindi aur Hinglish mein. Physics, Chemistry, Biology — sab kuch Bihar Board syllabus se grounded jawab."
        />
        <link rel="canonical" href="https://learnzuno.in/" />
      </Helmet>
      <div className="landing-page">
      <div className="landing-card">

        <div className="landing-brand-mark"><ZunoMark size={96} /></div>
        <h1 className="landing-brand-name">Zuno</h1>
        <div className="landing-brand-tag">apni boli mein</div>

        <div className="landing-feat-row">
          <span className="landing-feat">🎓 Bihar Board Class 10</span>
          <span className="landing-feat">💬 Hinglish mein jawab</span>
          <span className="landing-feat">🎯 Focus mode</span>
        </div>

        <p className="landing-desc">
          Jo bhi sawaal ho — seedha poochho.<br />
          Apni boli mein. Bilkul free.
        </p>

        <div className="landing-cta-stack">

          <button className="landing-cta landing-cta-primary" onClick={() => navigate('/register')}>
            <div className="landing-cta-icon">
              <BoltRounded style={{ fontSize: 18 }} />
            </div>
            <div className="landing-cta-body">
              <div className="landing-cta-title">Free account banao</div>
              <div className="landing-cta-sub">Chats save hongi · History milegi · Koi card nahi chahiye</div>
            </div>
            <ArrowForwardRounded className="landing-cta-arrow" style={{ fontSize: 17 }} />
          </button>

          <div className="landing-or-row">
            <div className="landing-or-line" />
            <span className="landing-or-text">pehle se ho?</span>
            <div className="landing-or-line" />
          </div>

          <button className="landing-cta landing-cta-secondary" onClick={() => navigate('/login')}>
            <div className="landing-cta-icon">
              <LoginRounded style={{ fontSize: 18 }} />
            </div>
            <div className="landing-cta-body">
              <div className="landing-cta-title">Wapas aa gaye — login karo</div>
              <div className="landing-cta-sub">Apni purani chats aur progress wahan milegi</div>
            </div>
            <ArrowForwardRounded className="landing-cta-arrow" style={{ fontSize: 17 }} />
          </button>

          <button className="landing-cta landing-cta-ghost" onClick={() => navigate('/chat')}>
            <div className="landing-cta-icon">
              <VisibilityRounded style={{ fontSize: 16 }} />
            </div>
            <div className="landing-cta-body">
              <div className="landing-cta-title">Pehle try karna hai?</div>
              <div className="landing-cta-sub">5 sawaal poochho — account ki zaroorat nahi</div>
            </div>
            <ChevronRightRounded className="landing-cta-arrow" style={{ fontSize: 17 }} />
          </button>

        </div>

        <div className="landing-trust">
          <span>Bihar Board syllabus only</span>
          <span className="landing-trust-sep">·</span>
          <span>Bilkul free</span>
          <span className="landing-trust-sep">·</span>
          <span>Instant access</span>
        </div>

        {/* Legal links — F1/F2: Privacy + Terms reachable from the public home */}
        <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center', fontSize: 11.5 }}>
          <Link to="/privacy" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Privacy Policy</Link>
          <span style={{ color: 'var(--border-strong)' }}>·</span>
          <Link to="/terms" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Terms of Use</Link>
        </div>

      </div>
      </div>
    </>
  );
}

export default LandingPage;
