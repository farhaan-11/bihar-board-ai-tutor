import React from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// Shared footer — © + legal/support links. Used on the legal pages (via
// LegalPageLayout) and on the Landing page. Links use react-router so they
// stay client-side.
const linkSx = {
  fontSize: '0.8rem',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  '&:hover': { color: 'var(--primary)' },
};

function SiteFooter() {
  return (
    <Box
      component="footer"
      sx={{ borderTop: '1px solid var(--border)', bgcolor: 'var(--bg-surface)', flexShrink: 0 }}
    >
      <Box
        sx={{
          maxWidth: 720,
          mx: 'auto',
          px: { xs: 2.5, sm: 3 },
          py: 2.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.25,
        }}
      >
        <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          © {new Date().getFullYear()} Zuno
        </Typography>
        <Box sx={{ display: 'flex', gap: 2.25 }}>
          <Box component={Link} to="/privacy" sx={linkSx}>Privacy</Box>
          <Box component={Link} to="/terms" sx={linkSx}>Terms</Box>
          <Box component={Link} to="/support" sx={linkSx}>Support</Box>
        </Box>
      </Box>
    </Box>
  );
}

export default SiteFooter;
