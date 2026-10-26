/**
 * Where the web server reaches the API. On Render the blueprint supplies API_HOSTPORT (private network),
 * locally it falls back to the dev API on port 4010.
 */
export function resolveApiUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.API_URL) return env.API_URL;
  if (env.API_HOSTPORT) return `http://${env.API_HOSTPORT}`;
  return 'http://localhost:4010';
}
