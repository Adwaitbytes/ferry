import app from './index.js';

/** Web-standard handlers for the Vercel Node runtime; Hono does the routing. */
const handle = (request: Request): Response | Promise<Response> => app.fetch(request);
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const OPTIONS = handle;
