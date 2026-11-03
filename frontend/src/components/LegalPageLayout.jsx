import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ZunoMark from './ZunoMark.jsx';
import SiteFooter from './SiteFooter.jsx';

// Shared shell for the Privacy and Terms pages: sticky brand header, a
// readable centered column, and the site footer. The app shell sets
// #root { overflow: hidden }, so this layout owns its own vertical scroll
// (height: 100vh + overflowY: auto) rather than relying on the page scrolling.

function LegalPageLayout({ title, lastUpdated, canonicalPath, metaTitle, children }) {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>{metaTitle}</title>
        <link rel="canonical" href={`https://learnzuno.in${canonicalPath}`} />
      </Helmet>

      <Box sx={{ height: '100vh', overflowY: 'auto', bgcolor: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
        <Box
          component="header"
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '54px',
            px: { xs: 2, sm: 3 },
            bgcolor: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ZunoMark />
            <Typography sx={{ fontFamily: 'var(--font-brand)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
              Zuno
            </Typography>
          </Box>
          <Box
            role="button"
            tabIndex={0}
            onClick={() => navigate(-1)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(-1)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              '&:hover': { color: 'var(--text-primary)' },
            }}
          >
            <ArrowBackRounded sx={{ fontSize: 16 }} />
            Wapas
          </Box>
        </Box>

        <Box
          component="main"
          sx={{ flex: 1, width: '100%', maxWidth: 720, mx: 'auto', px: { xs: 2.5, sm: 3 }, py: { xs: 3.5, sm: 5 } }}
        >
          <Typography
            component="h1"
            sx={{ fontSize: { xs: '1.6rem', sm: '1.9rem' }, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', mb: 0.5 }}
          >
            {title}
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'var(--text-muted)', mb: 3 }}>
            Last updated: {lastUpdated}
          </Typography>
          {children}
        </Box>

        <SiteFooter />
      </Box>
    </>
  );
}

// ── Shared presentational pieces, so Privacy and Terms stay consistent ──

// Hinglish "chhota matlab" summary callout (orange tint).
export function LegalTldr({ children }) {
  return (
    <Box
      sx={{
        bgcolor: 'var(--primary-tint)',
        border: '1px solid var(--primary-border)',
        borderLeft: '4px solid var(--primary)',
        borderRadius: 'var(--radius-lg)',
        p: { xs: 2, sm: 2.25 },
        mb: 3.5,
      }}
    >
      <Box sx={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary-label)', mb: 1 }}>
        Chhota matlab (Hinglish)
      </Box>
      <Typography sx={{ fontSize: '0.92rem', lineHeight: 1.7, color: '#4A2A08', m: 0, '& b': { fontWeight: 700 } }}>
        {children}
      </Typography>
    </Box>
  );
}

// Intro paragraph under the title.
export function LegalIntro({ children }) {
  return (
    <Typography sx={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-secondary)', mb: 3 }}>
      {children}
    </Typography>
  );
}

// A numbered section. highlight=true boxes it (used for the sensitive
// minors / age clause so it stands out).
export function LegalSection({ n, title, highlight = false, children }) {
  return (
    <Box
      sx={{
        mb: 3,
        ...(highlight && {
          bgcolor: 'var(--bg-input)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          p: { xs: 2, sm: 2.25 },
        }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.1, mb: 1 }}>
        <Box component="span" sx={{ fontFamily: 'var(--font-brand)', fontWeight: 800, fontSize: '0.95rem', color: 'var(--primary)', flexShrink: 0, minWidth: 18 }}>
          {n}
        </Box>
        <Typography component="h2" sx={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', m: 0, lineHeight: 1.35 }}>
          {title}
        </Typography>
      </Box>
      <Box
        sx={{
          pl: '27px',
          '& p': { fontSize: '0.92rem', lineHeight: 1.75, color: 'var(--text-secondary)', m: '0 0 8px' },
          '& p:last-child': { mb: 0 },
          '& ul': { m: '0 0 8px', pl: '18px' },
          '& li': { fontSize: '0.92rem', lineHeight: 1.75, color: 'var(--text-secondary)', mb: '6px' },
          '& b': { color: 'var(--text-primary)', fontWeight: 600 },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

// The support email, rendered as a tappable mailto chip.
export function LegalEmail() {
  return (
    <Box
      component="a"
      href="mailto:farhan@learnzuno.in"
      sx={{
        display: 'inline-block',
        fontWeight: 600,
        color: 'var(--primary-label)',
        bgcolor: 'var(--primary-tint)',
        border: '1px solid var(--primary-border)',
        borderRadius: 'var(--radius-full)',
        px: 1.1,
        py: '1px',
        fontSize: '0.86rem',
        textDecoration: 'none',
        '&:hover': { borderColor: 'var(--primary)' },
      }}
    >
      farhan@learnzuno.in
    </Box>
  );
}

export default LegalPageLayout;
