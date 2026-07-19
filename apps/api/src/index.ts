import cors from 'cors';
import express from 'express';
import { API_VERSION, APP_NAME } from '@pothole/shared';
import { config } from './config';
import { errorHandler, notFoundHandler } from './http';
import { attachUser, authenticate } from './middleware/auth';
import { ensureStorageDirs } from './services/storage';
import { adminRouter } from './routes/admin';
import { communityRouter } from './routes/community';
import { dashboardRouter } from './routes/dashboard';
import { earningsRouter } from './routes/earnings';
import { mediaRouter } from './routes/media';
import { metaRouter } from './routes/meta';
import { modelsRouter } from './routes/models';
import { samplesRouter } from './routes/samples';
import { usersRouter } from './routes/users';

const app = express();
app.disable('x-powered-by');

app.use(
  cors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
  }),
);

const base = `/api/${API_VERSION}`;

// Public (no auth): health + version.
app.use(base, metaRouter);

// JSON body parsing for everything except the raw chunk endpoint (which
// registers its own express.raw parser; express.json ignores non-JSON bodies).
app.use(express.json({ limit: '10mb' }));

// Authenticated API.
const authChain = [...authenticate(), attachUser];
app.use(base, authChain, usersRouter);
app.use(base, authChain, dashboardRouter);
app.use(base, authChain, samplesRouter);
app.use(base, authChain, mediaRouter);
app.use(base, authChain, earningsRouter);
app.use(base, authChain, communityRouter);
app.use(base, authChain, modelsRouter);
app.use(`${base}/admin`, authChain, adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function main(): Promise<void> {
  await ensureStorageDirs();
  app.listen(config.port, () => {
    console.log(`${APP_NAME} API listening on http://localhost:${config.port}${base}`);
    if (!config.auth0Domain && config.devAuthBypass) {
      console.warn('[auth] running with DEV_AUTH_BYPASS — do not use in production');
    }
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
