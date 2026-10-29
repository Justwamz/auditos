import { createHash } from 'node:crypto';

/** What the tax-submission provider needs to know about an issued invoice. */
export interface SubmittableInvoice {
  id: string;
  tenantId: string;
  number: string;
  totalCents: bigint;
  issueDate: string;
  clientName: string;
  clientPin: string | null;
}

export interface TaxSubmission {
  provider: string;
  /** True when no real tax authority was contacted. The invoice then carries a visible warning everywhere it is shown. */
  simulated: boolean;
  status: 'simulated' | 'submitted' | 'not_configured' | 'failed';
  controlNumber?: string;
  qrPayload?: string;
  submittedAt: string;
  message: string;
}

export interface TaxProvider {
  name: string;
  submit(invoice: SubmittableInvoice): Promise<TaxSubmission>;
}

/** Stands in for KRA eTIMS. Makes up a recognisable control number and says so; it never claims to have submitted anything. */
export class SimulationTaxProvider implements TaxProvider {
  readonly name = 'simulation';
  async submit(inv: SubmittableInvoice): Promise<TaxSubmission> {
    const digest = createHash('sha256').update(`${inv.tenantId}|${inv.number}`).digest('hex').slice(0, 10).toUpperCase();
    return {
      provider: 'simulation',
      simulated: true,
      status: 'simulated',
      controlNumber: `SIM-${digest}`,
      qrPayload: `SIMULATION|${inv.number}|${inv.totalCents.toString()}`,
      submittedAt: new Date().toISOString(),
      message: 'PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice.',
    };
  }
}

/**
 * The real KRA eTIMS connection. It needs a registered taxpayer PIN and eTIMS credentials from KRA, which this firm does not have yet,
 * so it is an empty slot that refuses to submit rather than pretend.
 */
export class KraEtimsProvider implements TaxProvider {
  readonly name = 'kra';
  constructor(private readonly env: NodeJS.ProcessEnv) {}
  async submit(invoice: SubmittableInvoice): Promise<TaxSubmission> {
    void this.env;
    void invoice;
    return {
      provider: 'kra',
      simulated: false,
      status: 'not_configured',
      submittedAt: new Date().toISOString(),
      message: 'KRA eTIMS is not configured. The invoice was issued but has not been submitted to KRA.',
    };
  }
}

export function createTaxProvider(env: NodeJS.ProcessEnv = process.env): TaxProvider {
  return env.TAX_PROVIDER === 'kra' ? new KraEtimsProvider(env) : new SimulationTaxProvider();
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  name: string;
  send(message: OutgoingEmail): Promise<{ provider: string; delivered: boolean }>;
}

/** Sends nothing. The message is kept in the outbox so it can be seen. */
export class SimulationEmailProvider implements EmailProvider {
  readonly name = 'simulation';
  async send(message: OutgoingEmail): Promise<{ provider: string; delivered: boolean }> {
    void message;
    return { provider: 'simulation', delivered: false };
  }
}

/** A real email service (Resend or similar) goes here once there is an account and a verified sending domain. */
export class UnconfiguredEmailProvider implements EmailProvider {
  constructor(readonly name: string) {}
  async send(message: OutgoingEmail): Promise<{ provider: string; delivered: boolean }> {
    void message;
    return { provider: this.name, delivered: false };
  }
}

export function createEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const name = env.EMAIL_PROVIDER;
  return name && name !== 'simulation' ? new UnconfiguredEmailProvider(name) : new SimulationEmailProvider();
}
