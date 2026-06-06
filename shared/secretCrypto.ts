import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export const ENCRYPTED_SECRET_PREFIX = "enc:v1:";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_SALT = "polymarket-bot-user-config-v1";

function getEncryptionKey(): Buffer {
  const secret = process.env.CONFIG_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("CONFIG_ENCRYPTION_KEY or SESSION_SECRET is required to protect user secrets.");
  }

  return scryptSync(secret, KEY_SALT, 32);
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_SECRET_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    throw new Error("Cannot encrypt an empty secret.");
  }
  if (isEncryptedSecret(trimmed)) {
    return trimmed;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_SECRET_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(stored: string): string {
  const trimmed = stored.trim();
  if (!trimmed) {
    throw new Error("Cannot decrypt an empty secret.");
  }

  if (!isEncryptedSecret(trimmed)) {
    return trimmed;
  }

  const payload = trimmed.slice(ENCRYPTED_SECRET_PREFIX.length);
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Encrypted secret payload is malformed.");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const encrypted = Buffer.from(dataPart, "base64url");

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function encryptSecretIfPresent(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return encryptSecret(trimmed);
}

export function decryptSecretIfPresent(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  return decryptSecret(value);
}

export function hasStoredSecret(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}
