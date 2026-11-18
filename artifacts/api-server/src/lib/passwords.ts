import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key as Buffer);
    });
  });
}

export type PasswordDigest = {
  hash: string;
  salt: string;
};

export async function hashPassword(password: string): Promise<PasswordDigest> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt);
  return { hash: derived.toString("hex"), salt: salt.toString("hex") };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  saltHex: string,
): Promise<boolean> {
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const derived = await deriveKey(password, salt);
  return timingSafeEqual(derived, expected);
}

export function secureStringEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
