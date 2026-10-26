import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export interface Scanner {
  scan(data: Buffer): Promise<{ clean: boolean }>;
}

/** Local-disk store for development. Swap for an S3-compatible store (with object lock) in hosting. */
export class LocalBlobStore implements BlobStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private pathFor(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'wx' });
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }
}

/** Placeholder until a real malware scanner (e.g. ClamAV) is wired in. Always reports clean. */
export class StubScanner implements Scanner {
  async scan(): Promise<{ clean: boolean }> {
    return { clean: true };
  }
}
