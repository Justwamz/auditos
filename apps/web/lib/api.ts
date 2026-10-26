export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** The server wants a fresh second factor before it will do this. Callers show the step-up prompt and retry. */
export class StepUpRequired extends ApiError {
  constructor(body: Record<string, unknown>) {
    super(401, 'step_up_required', body);
    this.name = 'StepUpRequired';
  }
}

export interface ApiDeps {
  fetchFn: typeof fetch;
  getCookie: (name: string) => string | undefined;
  onUnauthorized: () => void;
}

const BASE = '/api';

export function createApiClient(deps: ApiDeps) {
  const ensureCsrf = async (): Promise<string> => {
    const existing = deps.getCookie('aos_csrf');
    if (existing) return existing;
    const res = await deps.fetchFn(`${BASE}/auth/csrf`, { credentials: 'same-origin' });
    const data = (await res.json()) as { token: string };
    return deps.getCookie('aos_csrf') ?? data.token;
  };

  async function parse(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async function request<T>(method: string, path: string, body?: unknown, raw?: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== 'GET') headers['x-csrf-token'] = await ensureCsrf();
    let payload: BodyInit | undefined;
    if (raw) payload = raw;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await deps.fetchFn(`${BASE}${path}`, { method, headers, body: payload, credentials: 'same-origin' });
    if (res.ok) return (await parse(res)) as T;
    const data = await parse(res);
    const code = typeof data.error === 'string' ? data.error : `http_${res.status}`;
    if (res.status === 401 && code === 'step_up_required') throw new StepUpRequired(data);
    if (res.status === 401 && !path.startsWith('/auth/')) deps.onUnauthorized();
    throw new ApiError(res.status, code, data);
  }

  return {
    get: <T = Record<string, unknown>>(path: string) => request<T>('GET', path),
    post: <T = Record<string, unknown>>(path: string, body: unknown = {}) => request<T>('POST', path, body),
    put: <T = Record<string, unknown>>(path: string, body: unknown) => request<T>('PUT', path, body),
    patch: <T = Record<string, unknown>>(path: string, body: unknown) => request<T>('PATCH', path, body),
    upload: <T = Record<string, unknown>>(path: string, form: FormData) => request<T>('POST', path, undefined, form),
    /** For exports: returns the file as a blob. */
    async download(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-csrf-token': await ensureCsrf() };
      const res = await deps.fetchFn(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin' });
      if (!res.ok) {
        const data = await parse(res);
        const code = typeof data.error === 'string' ? data.error : `http_${res.status}`;
        if (res.status === 401 && code === 'step_up_required') throw new StepUpRequired(data);
        throw new ApiError(res.status, code, data);
      }
      const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
      return { blob: await res.blob(), filename: match?.[1] ?? 'download' };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

const readCookie = (name: string): string | undefined => {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : undefined;
};

/** Browser singleton. A 401 sends the user to the sign-in page. */
export const api: ApiClient = createApiClient({
  fetchFn: (...a) => fetch(...a),
  getCookie: readCookie,
  onUnauthorized: () => {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.assign('/login');
  },
});
