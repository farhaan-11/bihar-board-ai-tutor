import './styles/theme.css';
import './styles/global.css';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { HelmetProvider } from 'react-helmet-async';

import App from './App.jsx';
import AppInitializer from './components/AppInitializer.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { store, persistor } from './store/store.js';
import { injectStore } from './services/axios/axiosInstance.js';
import { ensureGuestToken } from './utils/guestToken.js';
import zunoTheme from './theme/zunoTheme.js';

// Wire Redux store into axiosInstance before any components mount
injectStore(store);

// Mint / upgrade the server-signed guest token as early as possible so it is in
// place before the first guest request. Fire-and-forget — never blocks render.
ensureGuestToken();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* BrowserRouter must be outermost so useNavigate works anywhere in the tree */}
    <BrowserRouter>
      <HelmetProvider>
        <GoogleOAuthProvider
          clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}
        >
          <Provider store={store}>
            <PersistGate loading={null} persistor={persistor}>
              <ThemeProvider theme={zunoTheme}>
                <CssBaseline />

                {/* Silently restores user session on page load — renders nothing */}
                <AppInitializer />

                <ErrorBoundary>
                  <App />
                </ErrorBoundary>

              </ThemeProvider>
            </PersistGate>
          </Provider>
        </GoogleOAuthProvider>
      </HelmetProvider>
    </BrowserRouter>
  </StrictMode>
);