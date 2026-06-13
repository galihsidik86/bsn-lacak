// SSE endpoint. EventSource can't set Authorization headers, so the access
// token rides as a `?token=` query param. Heartbeat every 25s keeps
// proxies/load-balancers from closing the long-lived stream.

import { Router, type Request, type Response } from 'express';
import { verify, type JwtPayload } from '../auth.js';
import { bus, type BsnEvent } from '../lib/events.js';
import { logger } from '../lib/logger.js';

const router = Router();

const HEARTBEAT_MS = 25_000;

router.get('/', (req: Request, res: Response) => {
  // Auth via query param — EventSource doesn't support custom headers.
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  if (!token) return res.status(401).end();

  let user: JwtPayload;
  try { user = verify(token); }
  catch { return res.status(401).end(); }

  // SSE handshake headers.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');         // disable nginx buffering
  res.flushHeaders();

  // Initial event so the browser confirms a working connection.
  res.write(`event: ready\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  const send = (ev: BsnEvent) => {
    // User filter: if userIds is set, only deliver to those users.
    if (ev.userIds && ev.userIds.length > 0 && !ev.userIds.includes(user.sub)) return;
    res.write(`id: ${ev.id}\nevent: ${ev.topic}\ndata: ${JSON.stringify(ev.data)}\n\n`);
  };

  const unsubscribe = bus.subscribe(send);

  // Heartbeat comment frame — won't trigger an event in EventSource, but
  // keeps the TCP connection alive through intermediaries.
  const beat = setInterval(() => {
    if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(beat);
    unsubscribe();
    if (!res.writableEnded) res.end();
  };

  req.on('close', cleanup);
  req.on('error', cleanup);

  logger.debug({ userId: user.sub, subscribers: bus.size }, 'sse_client_connected');
});

export default router;
