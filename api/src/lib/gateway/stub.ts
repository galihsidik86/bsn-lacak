import type { BlastGateway, SendArgs, SendResult } from './index.js';
import { logger } from '../logger.js';

export class StubGateway implements BlastGateway {
  async send(args: SendArgs): Promise<SendResult> {
    logger.info({ channel: args.channel, to: redact(args.to), len: args.body.length }, 'blast_stub_sent');
    // Pretend the provider returned a synthetic ID so the rest of the pipeline
    // still exercises the success path.
    return { ok: true, providerMessageId: 'stub-' + Date.now().toString(36) };
  }
}

function redact(hp: string) {
  if (hp.length < 6) return '***';
  return hp.slice(0, 3) + '***' + hp.slice(-2);
}
