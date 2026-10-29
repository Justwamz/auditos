const API_URL = process.env.API_URL ?? (process.env.API_HOSTPORT ? `http://${process.env.API_HOSTPORT}` : 'http://localhost:4010');

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  transpilePackages: ['@auditos/brand'],
  // The browser only ever talks to this origin; the API is reached through /api so cookies stay same-origin.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};
