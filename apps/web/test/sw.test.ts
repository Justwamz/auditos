import { describe, expect, test } from 'vitest';

type Handler = (e: unknown) => void;
import { swSource } from '../lib/swSource';

const src = swSource('b1');
const ALLOWED = /^\/(offline|icons\/[\w.-]+|_next\/static\/(?!webpack\/).+)$/;
const ORIGIN = 'http://localhost:3100';

function load(network: (r: Request) => Promise<Response>, code = src) {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  const pathOf = (r: Request | string) => (typeof r === 'string' ? r : new URL(r.url).pathname);
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
    open: async (k: string) => {
      const c = store.get(k) ?? new Map<string, Response>();
      store.set(k, c);
      return {
        addAll: async (reqs: Request[]) => {
          for (const r of reqs) c.set(pathOf(r), await doFetch(r));
        },
        put: async (r: Request | string, res: Response) => void c.set(pathOf(r), res),
        match: async (r: Request | string) => c.get(pathOf(r))?.clone(),
      };
    },
    match: async (r: Request | string) => {
      for (const c of store.values()) if (c.has(pathOf(r))) return c.get(pathOf(r))?.clone();
      return undefined;
    },
  };
  const self = {
    addEventListener: (t: string, h: Handler) => void (handlers[t] = h),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    location: { origin: ORIGIN },
  };
  const doFetch = (r: Request) => {
    fetched.push(pathOf(r));
    return network(r);
  };
  // A worker resolves relative addresses against its own address; this does the same.
  class WorkerRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, ORIGIN).href : input, init);
    }
  }
  new Function('self', 'caches', 'fetch', 'Request', code)(self, caches, doFetch, WorkerRequest);
  return { handlers, store, fetched };
}

const basic = (body: string, status = 200) => {
  const r = new Response(body, { status });
  Object.defineProperty(r, 'type', { value: 'basic' });
  return r;
};
const online = async () => basic('net');
const offline = async (): Promise<Response> => {
  throw new TypeError('offline');
};

function dispatch(h: Handler, req: Request): Promise<Response> | undefined {
  let responded: Promise<Response> | undefined;
  h({ request: req, respondWith: (p: Promise<Response>) => void (responded = p), waitUntil: () => undefined });
  return responded;
}
const mk = (path: string, init: RequestInit = {}, origin = ORIGIN, navigate = false) => {
  const r = new Request(origin + path, init);
  if (navigate) Object.defineProperty(r, 'mode', { value: 'navigate' });
  return r;
};

describe('service worker', () => {
  test('uses one cache name, precaches only public files, deletes other caches on activate', async () => {
    expect(src).toContain("const VERSION = 'aos-shell-b1'");
    const { handlers, store } = load(online);
    let installing: Promise<unknown> | undefined;
    handlers['install']!({ waitUntil: (p: Promise<unknown>) => void (installing = p) });
    await installing;
    expect([...store.get('aos-shell-b1')!.keys()].sort()).toEqual(['/icons/auditos-192.png', '/icons/auditos-512.png', '/icons/auditos.svg', '/offline']);
    store.set('aos-shell-v0', new Map());
    let done: Promise<unknown> | undefined;
    handlers['activate']!({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect([...store.keys()]).toEqual(['aos-shell-b1']);
  });

  test('does not intercept /api, /me, the manifest, data, the worker, other origins or non-GET', () => {
    const { handlers } = load(online);
    for (const p of ['/api/me', '/me', '/api/branding/logo/abc', '/api/branding/icon/abc', '/site.webmanifest', '/clients', '/_next/static/webpack/x.js', '/_next/data/x.json', '/sw.js'])
      expect(dispatch(handlers['fetch']!, mk(p)), p).toBeUndefined();
    expect(dispatch(handlers['fetch']!, mk('/icons/auditos-192.png', { method: 'POST' }))).toBeUndefined();
    expect(dispatch(handlers['fetch']!, mk('/_next/static/a.js', {}, 'http://evil.example'))).toBeUndefined();
    expect(dispatch(handlers['fetch']!, mk('/api/me', { method: 'POST' }))).toBeUndefined();
  });

  test('a navigation that carries data (query string) still only gets the network or the offline page, never stored', async () => {
    const { handlers, store } = load(online);
    const res = await dispatch(handlers['fetch']!, mk('/clients?q=Mwangaza', {}, ORIGIN, true))!;
    expect(await res.text()).toBe('net');
    expect(store.size).toBe(0);
  });

  test('an offline navigation gets the offline page', async () => {
    const { handlers, store } = load(offline);
    store.set('aos-shell-b1', new Map([['/offline', new Response('offline page')]]));
    const res = await dispatch(handlers['fetch']!, mk('/clients', {}, ORIGIN, true))!;
    expect(await res.text()).toBe('offline page');
  });

  test('static files are cache-first; only basic ok responses are stored; everything stored is allowed', async () => {
    const { handlers, store, fetched } = load(online);
    expect(await (await dispatch(handlers['fetch']!, mk('/icons/auditos-192.png'))!).text()).toBe('net');
    expect(await (await dispatch(handlers['fetch']!, mk('/_next/static/chunks/a.js'))!).text()).toBe('net');
    const again = await dispatch(handlers['fetch']!, mk('/icons/auditos-192.png'))!;
    expect(await again.text()).toBe('net');
    expect(fetched).toEqual(['/icons/auditos-192.png', '/_next/static/chunks/a.js']);
    const keys = [...store.get('aos-shell-b1')!.keys()];
    expect(keys.length).toBe(2);
    for (const k of keys) expect(k).toMatch(ALLOWED);

    const bad = load(async () => basic('nope', 404));
    await dispatch(bad.handlers['fetch']!, mk('/icons/missing.png'))!;
    expect(bad.store.get('aos-shell-b1')?.size ?? 0).toBe(0);
  });

  test('two builds give two different worker versions and cache names', () => {
    expect(swSource('b2')).toContain("const VERSION = 'aos-shell-b2'");
    expect(swSource('b2')).not.toBe(swSource('b1'));
    expect(swSource('b1')).not.toContain('__BUILD_ID__');
  });

  test('activating removes caches of older builds, with their static entries, and keeps the current one', async () => {
    const { handlers, store } = load(online);
    store.set('aos-shell-b0', new Map([['/_next/static/chunks/old.js', basic('old')], ['/offline', basic('old offline')]]));
    store.set('aos-shell-b1', new Map([['/_next/static/chunks/new.js', basic('new')]]));
    let done: Promise<unknown> | undefined;
    handlers['activate']!({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect([...store.keys()]).toEqual(['aos-shell-b1']);
    expect([...store.get('aos-shell-b1')!.keys()]).toContain('/_next/static/chunks/new.js');
  });

  test('installing fetches the offline page fresh from the network, not from the browser cache', async () => {
    const seen: string[] = [];
    const { handlers } = load(async (r) => {
      seen.push(new URL(r.url).pathname + ':' + r.cache);
      return basic('x');
    });
    let installing: Promise<unknown> | undefined;
    handlers['install']!({ waitUntil: (p: Promise<unknown>) => void (installing = p) });
    await installing;
    expect(seen).toContain('/offline:reload');
  });

  test('an offline navigation with nothing stored still answers with a response', async () => {
    const { handlers } = load(offline);
    const res = await dispatch(handlers['fetch']!, mk('/clients', {}, ORIGIN, true))!;
    expect(res).toBeInstanceOf(Response);
  });

  test('client-side page data requests and redirected static responses are not kept', async () => {
    const { handlers, store } = load(online);
    expect(dispatch(handlers['fetch']!, mk('/clients?_rsc=x'))).toBeUndefined();
    const redirected = load(async () => {
      const r = basic('moved');
      Object.defineProperty(r, 'redirected', { value: true });
      return r;
    });
    await dispatch(redirected.handlers['fetch']!, mk('/icons/auditos.svg'))!;
    expect(redirected.store.get('aos-shell-b1')?.size ?? 0).toBe(0);
    expect(store.size).toBe(0);
  });
});
