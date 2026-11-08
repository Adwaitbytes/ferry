import { getRequestListener } from '@hono/node-server';
import app from './index.js';

/** Node (req, res) handler for the Vercel function emitted by scripts/bundle.mjs. */
export default getRequestListener(app.fetch);
