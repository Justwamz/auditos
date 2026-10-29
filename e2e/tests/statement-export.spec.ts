import { expect, test } from '@playwright/test';
import { freshCode, signIn } from '../helpers';

// Exported statements always say "Powered by AuditOS". The main firm (Kangethe) has no branding saved and this
// spec never saves any, so its export shows the firm name and the AuditOS line but no contact line.
const partner = 'grace.kangethe@kangethe.example.test';

/** The text drawn on the PDF pages (pdfkit writes it as hex strings). */
function pdfText(buf: Buffer): string {
  const hex = (x: string) => Buffer.from(x, 'hex').toString('latin1');
  const out: string[] = [];
  for (const m of buf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    if (m[1] !== undefined) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hex(x[1]!)).join(''));
    else out.push(hex(m[2]!));
  }
  return out.join('\n');
}

test('an exported PDF carries the firm name and Powered by AuditOS, and no contact line for an unbranded firm', async ({ page }) => {
  await signIn(page, partner);
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await expect(page.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
  // The seeded engagement needs last year's closing figures carried forward before statements can be built.
  await page.getByRole('tab', { name: 'Financial statements' }).click();
  const carry = page.getByRole('button', { name: 'Carry forward from last year' });
  if (await carry.isVisible({ timeout: 5000 }).catch(() => false)) {
    await carry.click();
    await expect(page.getByText('Carried forward')).toBeVisible();
  }
  const id = /engagements\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const csrf = ((await (await page.request.get('/api/auth/csrf')).json()) as { token: string }).token;
  const headers = { 'x-csrf-token': csrf };
  const got = (await (await page.request.get(`/api/engagements/${id}/mapping`)).json()) as { mapping: Record<string, string>; suggestions: Record<string, string> };
  const put = await page.request.put(`/api/engagements/${id}/mapping`, { headers, data: { mapping: { ...got.mapping, ...got.suggestions } } });
  expect(put.ok(), await put.text()).toBe(true);
  const step = await page.request.post('/api/auth/stepup', { headers, data: { code: await freshCode(partner) } });
  expect(step.ok()).toBe(true);
  const res = await page.request.post(`/api/engagements/${id}/export`, { headers, data: { format: 'pdf' } });
  expect(res.status(), await res.text()).toBe(200);
  const text = pdfText(await res.body());
  expect(text).toContain('Powered by AuditOS');
  expect(text).toContain('Mwangaza Traders Ltd');
  expect(text).not.toContain('Tel:');
});
