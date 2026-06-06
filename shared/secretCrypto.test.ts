import { afterEach, describe, expect, test } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  ENCRYPTED_SECRET_PREFIX,
  isEncryptedSecret,
} from "./secretCrypto";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("secretCrypto", () => {
  test("encrypts and decrypts a secret", () => {
    process.env.SESSION_SECRET = "test-session-secret";
    const encrypted = encryptSecret("sk-live-user-key");
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe("sk-live-user-key");
  });

  test("reads legacy plaintext secrets during migration", () => {
    process.env.SESSION_SECRET = "test-session-secret";
    expect(decryptSecret("plain-text-key")).toBe("plain-text-key");
  });

  test("does not double-encrypt", () => {
    process.env.SESSION_SECRET = "test-session-secret";
    const encrypted = encryptSecret("abc123");
    expect(encryptSecret(encrypted)).toBe(encrypted);
    expect(encrypted.startsWith(ENCRYPTED_SECRET_PREFIX)).toBe(true);
  });
});
