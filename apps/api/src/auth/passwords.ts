import argon2 from 'argon2';

/** OWASP-recommended argon2id parameters (ROADMAP 1.1): m = 19 MiB, t = 2, p = 1. */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/** Equalizes timing when the email doesn't exist (no user enumeration via latency). */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('focusguard-timing-equalizer');
  await verifyPassword(await dummyHash, password);
}
