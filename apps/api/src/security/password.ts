import { hash, verify } from '@node-rs/argon2';

// Argon2id (library default) with OWASP-recommended minimum parameters.
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, PARAMS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Verifies against a throwaway hash so unknown emails cost the same as wrong passwords. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummy, password);
}
