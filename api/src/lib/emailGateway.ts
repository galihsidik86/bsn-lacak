import { env } from '../env.js';
import { logger } from './logger.js';

// Provider-agnostic email gateway. Routes are oblivious to which provider
// actually delivers the message — only env config picks the backend.

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

export interface EmailResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface EmailGateway {
  send(msg: EmailMessage): Promise<EmailResult>;
}

class StubEmailGateway implements EmailGateway {
  async send(msg: EmailMessage): Promise<EmailResult> {
    const to = Array.isArray(msg.to) ? msg.to.join(', ') : msg.to;
    logger.info({
      provider: 'stub', to, subject: msg.subject,
      attachments: msg.attachments?.map(a => a.filename) ?? [],
    }, 'email_stub_sent');
    return { ok: true, providerMessageId: 'stub-' + Date.now() };
  }
}

class SmtpEmailGateway implements EmailGateway {
  // Imported lazily so the @types/nodemailer dep stays optional in dev
  // until someone actually flips EMAIL_PROVIDER=smtp.
  private transporter: any = null;

  private async ensureTransporter() {
    if (this.transporter) return this.transporter;
    if (!env.SMTP_HOST) {
      throw new Error('SMTP_HOST required when EMAIL_PROVIDER=smtp');
    }
    const nodemailer = await import('nodemailer');
    this.transporter = nodemailer.default.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    return this.transporter;
  }

  async send(msg: EmailMessage): Promise<EmailResult> {
    try {
      const t = await this.ensureTransporter();
      const info = await t.sendMail({
        from: env.EMAIL_FROM,
        to: Array.isArray(msg.to) ? msg.to.join(', ') : msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments,
      });
      return { ok: true, providerMessageId: info.messageId };
    } catch (err: any) {
      logger.error({ err: err?.message }, 'smtp_send_failed');
      return { ok: false, error: err?.message ?? 'smtp_send_failed' };
    }
  }
}

function selectGateway(): EmailGateway {
  if (env.EMAIL_PROVIDER === 'smtp') {
    if (!env.SMTP_HOST) {
      logger.warn('EMAIL_PROVIDER=smtp tapi SMTP_HOST kosong — fallback ke stub');
      return new StubEmailGateway();
    }
    return new SmtpEmailGateway();
  }
  return new StubEmailGateway();
}

export const emailGateway: EmailGateway = selectGateway();
