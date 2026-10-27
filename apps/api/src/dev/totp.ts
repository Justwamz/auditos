import { readFileSync } from 'node:fs';
import { stepOf, totpAt } from '../security/totp';

/** Dev helper: prints the current TOTP code for a seeded user. Usage: pnpm totp partner@kangethe.example.test */
const email = process.argv[2];
const file = JSON.parse(readFileSync('.seed-credentials.local.json', 'utf8')) as { users: { email: string; totpSecret: string }[] };
const u = file.users.find((x) => x.email === email);
if (!u) {
  console.error(`No seeded user ${email}. Known: ${file.users.map((x) => x.email).join(', ')}`);
  process.exit(1);
}
console.log(totpAt(u.totpSecret, stepOf(Date.now())));
