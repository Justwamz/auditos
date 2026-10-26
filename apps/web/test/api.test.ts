import { describe, expect, test, vi } from 'vitest';
import { createApiClient, StepUpRequired, ApiError } from '../lib/api';

type FetchArgs = [string, RequestInit];

function client(responses: Array<{ status: number; body?: unknown; setCookie?: string }>, cookie = '') {
  const calls: FetchArgs[] = [];
  let jar = cookie;
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const r = responses.shift() ?? { status: 200, body: {} };
    if (r.setCookie) jar = r.setCookie;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  const onUnauthorized = vi.fn();
  const api = createApiClient({ fetchFn: fetchFn as unknown as typeof fetch, getCookie: (n) => (n === 'aos_csrf' ? jar.split('=')[1] : undefined), onUnauthorized });
  return { api, calls, onUnauthorized };
}

describe('apiClient', () => {
  test('sends the CSRF token header on state-changing requests', async () => {
    const { api, calls } = client([{ status: 200, body: { ok: true } }], 'aos_csrf=abc123');
    await api.post('/engagements', { a: 1 });
    expect((calls[0]![1].headers as Record<string, string>)['x-csrf-token']).toBe('abc123');
    expect(calls[0]![0]).toBe('/api/engagements');
    expect(calls[0]![1].credentials).toBe('same-origin');
  });

  test('fetches a CSRF cookie first when there is none', async () => {
    const { api, calls } = client([{ status: 200, body: { token: 'fresh' }, setCookie: 'aos_csrf=fresh' }, { status: 200, body: {} }]);
    await api.post('/auth/login', { email: 'a@b.c', password: 'x' });
    expect(calls[0]![0]).toBe('/api/auth/csrf');
    expect((calls[1]![1].headers as Record<string, string>)['x-csrf-token']).toBe('fresh');
  });

  test('does not send a CSRF header on GET requests', async () => {
    const { api, calls } = client([{ status: 200, body: {} }]);
    await api.get('/me');
    expect((calls[0]![1].headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  test('a 401 triggers the unauthorized callback', async () => {
    const { api, onUnauthorized } = client([{ status: 401, body: { error: 'unauthenticated' } }]);
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  test('a step-up 401 throws StepUpRequired and does not log the user out', async () => {
    const { api, onUnauthorized } = client([{ status: 401, body: { error: 'step_up_required' } }], 'aos_csrf=t');
    await expect(api.post('/items/1/signoff', {})).rejects.toBeInstanceOf(StepUpRequired);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  test('login failures (401 on /auth routes) do not trigger the unauthorized callback', async () => {
    const { api, onUnauthorized } = client([{ status: 401, body: { error: 'invalid_credentials' } }], 'aos_csrf=t');
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  test('errors carry status, code and body', async () => {
    const { api } = client([{ status: 409, body: { error: 'gate_blocked', blockers: [{ gate: 'x' }] } }], 'aos_csrf=t');
    await expect(api.post('/engagements/1/transition', {})).rejects.toMatchObject({ status: 409, code: 'gate_blocked', body: { blockers: [{ gate: 'x' }] } });
  });

  test('upload sends multipart without forcing a JSON content type', async () => {
    const { api, calls } = client([{ status: 201, body: { id: '1' } }], 'aos_csrf=t');
    const fd = new FormData();
    fd.append('file', new Blob(['x']), 'a.pdf');
    await api.upload('/engagements/1/evidence', fd);
    const headers = calls[0]![1].headers as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
    expect(headers['x-csrf-token']).toBe('t');
    expect(calls[0]![1].body).toBe(fd);
  });

  test('a non-JSON error body still produces an ApiError', async () => {
    const calls: FetchArgs[] = [];
    const api = createApiClient({
      fetchFn: (async (u: string, i: RequestInit) => { calls.push([u, i]); return new Response('<html>bad gateway</html>', { status: 502 }); }) as unknown as typeof fetch,
      getCookie: () => 't',
      onUnauthorized: () => undefined,
    });
    await expect(api.get('/me')).rejects.toMatchObject({ status: 502, code: 'http_502' });
  });
});
