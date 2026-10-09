// Creates an admin account, or promotes an existing user / resets an
// admin's password.
//
//   npm run admin:create -- --phone 01712345678 --name "Rahim Uddin"
//
// The password is typed at a hidden prompt (twice), hashed with argon2 and
// never printed or stored in plain text. Admin login then needs the
// password AND an OTP sent to this phone.
import 'dotenv/config';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeBdPhone } from '../src/common/phone.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const MIN_PASSWORD = 12;

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

// Piped input (CI, scripts): one shared reader, one line per prompt.
let pipedLines: AsyncIterator<string> | undefined;

/** Reads one line without echoing it (TTY), or a plain line from a pipe. */
async function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    pipedLines ??= createInterface({ input: stdin })[Symbol.asyncIterator]();
    const next = await pipedLines.next();
    // Windows PowerShell pipes add a BOM and \r.
    return next.done ? '' : next.value.replace(/^﻿/, '').replace(/\r$/, '');
  }
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (raw: string) => {
      // Drop terminal escape sequences, e.g. bracketed-paste markers
      // (ESC[200~ … ESC[201~) that VS Code / Windows Terminal add on paste.
      // oxlint-disable-next-line no-control-regex -- matching ESC is the point
      const chunk = raw.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
      for (const ch of chunk) {
        // Windows sends Enter as \r\n: a stray \n left over from the previous
        // prompt must not submit an empty answer.
        if ((ch === '\r' || ch === '\n') && value === '') continue;
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130); // Ctrl+C
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch; // ignore other control characters
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const { values } = parseArgs({
    options: { phone: { type: 'string' }, name: { type: 'string' } },
  });
  const phone = values.phone ? normalizeBdPhone(values.phone) : null;
  if (!phone) fail('Pass --phone with a Bangladeshi mobile number, e.g. --phone 01712345678');
  const name = values.name?.trim() || null;

  const password = await askHidden(`Password for ${phone} (min ${MIN_PASSWORD} chars): `);
  if (password.length < MIN_PASSWORD) fail(`Password must be at least ${MIN_PASSWORD} characters.`);
  const again = await askHidden('Repeat password: ');
  if (again !== password) fail('Passwords do not match.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const passwordHash = await hash(password);
    const existing = await prisma.user.findUnique({ where: { phone } });
    await prisma.user.upsert({
      where: { phone },
      create: { phone, name, role: 'admin', passwordHash },
      update: { role: 'admin', passwordHash, ...(name ? { name } : {}) },
    });
    // A new password ends every existing session for this account.
    if (existing) await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log(
      existing
        ? `✔ ${phone} is an admin; password updated and old sessions ended.`
        : `✔ Admin ${phone} created.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
