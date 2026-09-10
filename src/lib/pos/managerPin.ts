// Phase 3C — manager override PIN: hashing and verification.
//
// Uses Node's built-in `crypto.scrypt`, not a new dependency (bcrypt/
// bcryptjs). scrypt is a well-regarded, memory-hard KDF included in every
// Node runtime — reaching for a new npm package for this would be exactly
// the kind of unannounced architecture change the project asked to be
// flagged first, and it's unnecessary: Node already ships what's needed.
//
// A PIN is short (4-6 digits) and this is a physical-presence control, not
// a login — a manager types it standing at the counter, immediately after
// a cashier asks them to. It is not the gym's account password and must
// never be treated as one; it authorises a single void/refund/discount
// action, nothing more.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const KEY_LEN = 64;
const SALT_LEN = 16;

/** Produces a `salt:hash` string, both hex, suitable for
 *  system_users.manager_pin_hash. */
export async function hashManagerPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = (await scrypt(pin, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Constant-time comparison — never short-circuits on the first differing
 *  byte, so response timing can't leak how much of a guessed PIN was
 *  correct. */
export async function verifyManagerPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(pin, salt, KEY_LEN)) as Buffer;

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** A minimal shape for PIN checking against a pool of managers — the PIN
 *  pad doesn't ask "which manager", it asks "which manager's PIN is this",
 *  matching the counter reality of "go get a manager, they type their own
 *  PIN". */
export interface PinCandidate {
  id: string;
  fullName: string;
  managerPinHash: string | null;
}

/** Checks a PIN against every candidate and returns the first match, or
 *  null. Runs sequentially — the candidate pool is a handful of managers
 *  at most, so there's no meaningful timing signal to worry about between
 *  candidates (only within a single comparison, which verifyManagerPin
 *  already protects). */
export async function findMatchingManager(
  pin: string,
  candidates: PinCandidate[]
): Promise<PinCandidate | null> {
  for (const c of candidates) {
    if (!c.managerPinHash) continue;
    if (await verifyManagerPin(pin, c.managerPinHash)) return c;
  }
  return null;
}
