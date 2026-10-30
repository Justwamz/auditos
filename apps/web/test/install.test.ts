import { describe, expect, test } from 'vitest';
import { shouldOfferInstall } from '../lib/install';

describe('shouldOfferInstall', () => {
  test('true only when offered, not dismissed and not already installed', () => {
    for (const hasPrompt of [true, false])
      for (const dismissed of [true, false])
        for (const standalone of [true, false])
          expect(shouldOfferInstall({ hasPrompt, dismissed, standalone })).toBe(hasPrompt && !dismissed && !standalone);
  });
});
