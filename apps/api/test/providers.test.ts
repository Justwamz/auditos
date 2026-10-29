import { describe, expect, test } from 'vitest';
import { createEmailProvider, createTaxProvider, KraEtimsProvider, SimulationEmailProvider, SimulationTaxProvider } from '../src/billing/providers';

const invoice = { id: 'i1', tenantId: 't1', number: 'KA-2026-0001', totalCents: 11_600_000n, issueDate: '2026-11-10', clientName: 'Mwangaza Traders Ltd', clientPin: null };

describe('tax-submission providers', () => {
  test('the simulation says plainly that nothing was sent to KRA', async () => {
    const r = await new SimulationTaxProvider().submit(invoice);
    expect(r).toMatchObject({ provider: 'simulation', simulated: true, status: 'simulated' });
    expect(r.message).toMatch(/has not been sent to KRA/i);
    expect(r.message).toMatch(/not a valid tax invoice/i);
  });

  test('the control number is made up, recognisable and stable for the same invoice', async () => {
    const a = await new SimulationTaxProvider().submit(invoice);
    const b = await new SimulationTaxProvider().submit(invoice);
    expect(a.controlNumber).toMatch(/^SIM-[0-9A-F]{10}$/);
    expect(a.controlNumber).toBe(b.controlNumber);
    expect((await new SimulationTaxProvider().submit({ ...invoice, number: 'KA-2026-0002' })).controlNumber).not.toBe(a.controlNumber);
    expect(a.qrPayload).toContain('SIMULATION');
  });

  test('the real KRA provider is an unconfigured slot: it refuses to pretend', async () => {
    const r = await new KraEtimsProvider({}).submit(invoice);
    expect(r).toMatchObject({ provider: 'kra', simulated: false, status: 'not_configured' });
    expect(r.controlNumber).toBeUndefined();
  });

  test('the provider is chosen by TAX_PROVIDER and defaults to the simulation', () => {
    expect(createTaxProvider({}).name).toBe('simulation');
    expect(createTaxProvider({ TAX_PROVIDER: 'kra' }).name).toBe('kra');
    expect(createTaxProvider({ TAX_PROVIDER: 'something-else' }).name).toBe('simulation');
  });
});

describe('email providers', () => {
  test('the simulation keeps the message instead of sending it', async () => {
    const r = await new SimulationEmailProvider().send({ to: 'a@example.test', subject: 'Invoice', body: 'Hello' });
    expect(r).toEqual({ provider: 'simulation', delivered: false });
  });
  test('the real provider slot is unconfigured', async () => {
    const r = await createEmailProvider({ EMAIL_PROVIDER: 'resend' }).send({ to: 'a@example.test', subject: 'x', body: 'y' });
    expect(r).toMatchObject({ provider: 'resend', delivered: false });
    expect(createEmailProvider({}).name).toBe('simulation');
  });
});
