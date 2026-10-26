import { expect, test } from 'vitest';
import { resolveApiUrl } from '../lib/apiUrl';

test('API_URL wins, then the private-network host and port, then the local dev API', () => {
  expect(resolveApiUrl({ API_URL: 'http://x:1', API_HOSTPORT: 'auditos-api:10000' })).toBe('http://x:1');
  expect(resolveApiUrl({ API_HOSTPORT: 'auditos-api:10000' })).toBe('http://auditos-api:10000');
  expect(resolveApiUrl({})).toBe('http://localhost:4010');
});
