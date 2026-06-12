import twilio, { type Twilio } from 'twilio';
import type { BlastGateway, SendArgs, SendResult } from './index.js';
import { logger } from '../logger.js';

interface Cfg {
  sid: string;
  token: string;
  fromSms?: string;
  fromWa?: string;       // WhatsApp Business sender — expects "whatsapp:+62..." format
}

export class TwilioGateway implements BlastGateway {
  private client: Twilio;
  constructor(private cfg: Cfg) {
    this.client = twilio(cfg.sid, cfg.token);
  }

  async send(args: SendArgs): Promise<SendResult> {
    const isWa = args.channel === 'WA';
    const from = isWa ? this.cfg.fromWa : this.cfg.fromSms;
    if (!from) return { ok: false, error: `from_not_configured:${args.channel}` };

    const to = normalize(args.to, isWa);
    try {
      const msg = await this.client.messages.create({
        from,
        to,
        body: args.body,
      });
      return { ok: true, providerMessageId: msg.sid };
    } catch (err: any) {
      logger.error({ err: err?.message, code: err?.code, channel: args.channel }, 'twilio_send_failed');
      return { ok: false, error: err?.message ?? 'twilio_send_failed' };
    }
  }
}

function normalize(hp: string, wa: boolean): string {
  // Convert "08xx-xxxx-xxxx" (Indonesian local) to E.164 "+628xx...".
  let n = hp.replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  const e164 = '+' + n;
  return wa ? `whatsapp:${e164}` : e164;
}
