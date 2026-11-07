import app from './app.js';
import { env, validateEnv } from './config/env.js';
import { connectDB, disconnectDB } from './db/mongooseClient.js';
import { Chunk } from './models/chunk.model.js';
import { connectRedis } from './config/redisClient.js';
import { connectMailer } from './auth/emailHelpers.js';

validateEnv();

let server;

try {
  await connectDB();

  // No chunks means retrieval cannot work at all, so I would rather the boot fail
  // loudly here than have every student question come back empty.
  const totalVectors = await Chunk.countDocuments();
  console.log(`[Zuno] MongoDB vector chunks connected. Total chunks indexed: ${totalVectors}`);

  // Auth needs Redis for tokens and sessions, so losing it is fatal in production.
  // In dev I only warn, so the rest of the app still runs without it.
  try {
    await connectRedis();
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Redis] Startup failed — exiting');
      process.exit(1);
    }
    console.warn('[Redis] Connection failed — auth features will not work:', err.code || err.message || err);
    console.warn('[Redis] Check REDIS_URL in .env and verify your Upstash instance is active.');
  }

  // I open the port before anything optional, because Render kills a deploy that
  // does not start listening quickly enough.
  server = app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });

  // SMTP is checked in the background, so a slow mail host cannot delay the port.
  connectMailer().catch((err) => {
    console.warn('[Mailer] SMTP connection verification failed:', err.message);
  });
} catch (error) {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
}

const shutdown = async (signal) => {
  console.log(`${signal} received. Shutting down server.`);

  const exit = async () => {
    await disconnectDB();
    process.exit(0);
  };

  if (server) {
    server.close(exit);
    return;
  }

  await exit();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
