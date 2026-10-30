import { describe, expect, test } from 'vitest';
import { AUDITOS_THEME, buildManifest, iconLinks } from '../lib/appIcons';

describe('buildManifest', () => {
  test('signed out gives the AuditOS app', () => {
    const m = buildManifest(null);
    expect(m.name).toBe('AuditOS');
    expect(m.short_name).toBe('AuditOS');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.background_color).toBe('#f3f6f0');
    expect(m.theme_color).toBe('#2e6b4c');
    expect(AUDITOS_THEME).toBe('#2e6b4c');
    expect(m.icons).toEqual([
      { src: '/icons/auditos-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/auditos-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/auditos-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  test('a firm gives its own name; short name only when short', () => {
    const a = buildManifest({ name: 'Kangethe', logoId: null, themeColor: '#123456' });
    expect(a.name).toBe('Kangethe');
    expect(a.short_name).toBe('Kangethe');
    expect(a.theme_color).toBe('#123456');
    const b = buildManifest({ name: 'Kangethe and Partners LLP', logoId: null, themeColor: '#123456' });
    expect(b.short_name).toBe('AuditOS');
  });

  test('a firm with a logo gets its own icon routes', () => {
    const m = buildManifest({ name: 'Kangethe and Associates', logoId: 'abc', themeColor: '#123456' });
    expect(m.name).toBe('Kangethe and Associates');
    expect(m.short_name).toBe('AuditOS');
    expect(m.theme_color).toBe('#123456');
    expect(m.icons).toEqual([
      { src: '/api/branding/icon/abc/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/api/branding/icon/abc/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/api/branding/icon/abc/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    expect(buildManifest({ name: 'Wamz & Co', logoId: 'abc', themeColor: '#123456' }).short_name).toBe('Wamz & Co');
    expect(buildManifest({ name: 'Wamz & Co', logoId: null, themeColor: '#123456' }).icons?.[0]?.src).toBe('/icons/auditos-192.png');
  });
});

describe('iconLinks', () => {
  test('AuditOS icons when there is no logo', () => {
    const l = iconLinks(null);
    expect(l.icon[0]).toEqual({ url: '/icons/auditos-32.png', sizes: '32x32', type: 'image/png' });
    expect(l.icon[1]).toEqual({ url: '/icons/auditos.svg', type: 'image/svg+xml' });
    expect(l.apple).toEqual([{ url: '/icons/auditos-180.png', sizes: '180x180' }]);
  });

  test('a logo gives the firm routes for the tab and the home screen', () => {
    const l = iconLinks('abc');
    expect(l.icon[0]).toEqual({ url: '/api/branding/icon/abc/32', sizes: '32x32', type: 'image/png' });
    expect(l.apple).toEqual([{ url: '/api/branding/icon/abc/180', sizes: '180x180' }]);
  });
});
