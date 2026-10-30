import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import askRoutes             from './routes/ask.routes.js';
import authRoutes            from './routes/auth.routes.js';
import chapterProgressRoutes from './routes/chapterProgress.routes.js';
import healthRoutes          from './routes/health.routes.js';
import quizRoutes            from './routes/quiz.routes.js';
import sessionRoutes         from './routes/session.routes.js';
import studyMapRoutes        from './routes/studyMap.routes.js';
import supportRoutes         from './routes/support.routes.js';
import ApiError from './utils/ApiError.js';
import { sendResponse } from './utils/sendResponse.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { globalApiLimiter } from './middlewares/rateLimiters.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));

// FRONTEND_URL supports a comma-separated list so staging/prod/local dev
// origins can all be whitelisted without loosening this to a wildcard.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header = same-origin or non-browser client (curl, server-to-server) — allow.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Logged so a frontend/backend origin mismatch (e.g. Vite auto-picking a
    // different port) is diagnosable from server logs instead of surfacing
    // only as a generic frontend error.
    console.error(`[CORS] Blocked request from unlisted origin: ${origin}. Allowed: ${allowedOrigins.join(', ')}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/', (_req, res) => {
  return sendResponse(res, 200, {
    message: 'Bihar Board AI Tutor backend is running.',
  });
});

app.use('/health', healthRoutes);

// Apply global rate limiter only to API routes------
app.use('/api', globalApiLimiter);

app.use('/api/v1/ask',              askRoutes);
app.use('/api/v1/study-map',       studyMapRoutes);
app.use('/api/v1/auth',            authRoutes);
app.use('/api/v1/sessions',        sessionRoutes);
app.use('/api/v1/chapter-progress', chapterProgressRoutes);
app.use('/api/v1/support',          supportRoutes);
app.use('/api/v1/quiz',             quizRoutes);

app.use((req, _res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
});

app.use(errorHandler);




export default app;
