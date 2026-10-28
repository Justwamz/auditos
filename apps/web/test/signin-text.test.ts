import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findJargon } from '../lib/plain';
import { MESSAGES } from '../lib/text';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('sign-in wording', () => {
  test('step-up prompt uses the plain sentence and no software words', () => {
    const s = src('components/StepUp.tsx');
    expect(s).toContain('This is recorded in the activity history. Enter the 6-digit code from your phone.');
    expect(findJargon(s.match(/<p className="muted">([^<]*)<\/p>/)![1]!)).toEqual([]);
  });
  test('generic and lock message text is unchanged', () => {
    expect(MESSAGES.invalid_credentials).toBe('The email or password is wrong, or the account is temporarily locked.');
  });
});
