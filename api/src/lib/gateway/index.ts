// Provider-agnostic blast gateway. Routes are oblivious to which provider
// actually sends the message; only env config swaps the implementation.

import { env } from '../../env.js';
import { logger } from '../logger.js';
import type { BlastChannel } from '@prisma/client';
import { StubGateway } from './stub.js';
import { TwilioGateway } from './twilio.js';

export interface SendArgs {
  channel: BlastChannel;
  to: string;            // E.164 ideally; provider may normalize
  body: string;
}

export type SendResult =
  | { ok: true;  providerMessageId: string }
  | { ok: false; error: string };

export interface BlastGateway {
  send(args: SendArgs): Promise<SendResult>;
}

function selectGateway(): BlastGateway {
  if (env.BLAST_PROVIDER === 'twilio') {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      logger.warn('BLAST_PROVIDER=twilio tapi TWILIO_ACCOUNT_SID/TOKEN kosong — fallback ke stub');
      return new StubGateway();
    }
    return new TwilioGateway({
      sid: env.TWILIO_ACCOUNT_SID,
      token: env.TWILIO_AUTH_TOKEN,
      fromSms: env.TWILIO_FROM_SMS,
      fromWa: env.TWILIO_WA_FROM,
    });
  }
  return new StubGateway();
}

export const gateway: BlastGateway = selectGateway();
