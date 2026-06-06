import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "pm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 3;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.WAKE_API_TOKEN;
  if (!secret) {
    throw new Error("SESSION_SECRET (or WAKE_API_TOKEN) is required for auth cookies.");
  }
  return secret;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const encodedUserId = encodeURIComponent(userId);
  const payload = `${encodedUserId}.${expiresAt}`;
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) {
    return null;
  }

  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) {
    return null;
  }

  const signature = token.slice(lastDot + 1);
  const rest = token.slice(0, lastDot);
  const separator = rest.lastIndexOf(".");
  if (separator === -1) {
    return null;
  }

  const encodedUserId = rest.slice(0, separator);
  const expiresAtRaw = rest.slice(separator + 1);
  if (!encodedUserId || !expiresAtRaw || !signature) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const payload = `${encodedUserId}.${expiresAtRaw}`;
  const expected = signPayload(payload);

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return decodeURIComponent(encodedUserId);
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 12,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
