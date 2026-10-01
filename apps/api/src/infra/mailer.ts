import nodemailer from 'nodemailer';
import type { Logger } from 'pino';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** SMTP delivery (Mailpit in development, Resend/Postmark SMTP in production). */
export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Development fallback without SMTP: logs the message (links included) instead of sending. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  async send(message: MailMessage): Promise<void> {
    this.logger.info({ to: message.to, subject: message.subject }, `[mail] ${message.text}`);
  }
}

/** Test double that records messages. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}
