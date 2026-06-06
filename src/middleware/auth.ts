import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "../../shared/auth";
import { debugLog } from "../../shared/log";

export type AuthVariables = {
  userId: string;
};

function sessionCookieOptions() {
  const crossOrigin =
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.FORCE_CROSS_ORIGIN_COOKIES === "1";

  return {
    path: "/",
    secure: crossOrigin,
    sameSite: crossOrigin ? ("None" as const) : ("Lax" as const),
  };
}

export function setSessionCookie(c: Parameters<typeof setCookie>[0], userId: string): void {
  setCookie(c, SESSION_COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    ...sessionCookieOptions(),
  });
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions());
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  const userId = verifySessionToken(token);

  if (!userId) {
    debugLog("auth", "Authentication required — missing or invalid session cookie", {
      hasCookie: Boolean(token),
      path: c.req.path,
    });
    throw new HTTPException(401, { message: "Authentication required." });
  }

  c.set("userId", userId);
  await next();
});

export const optionalAuth = createMiddleware<{ Variables: Partial<AuthVariables> }>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    const userId = verifySessionToken(token);
    if (userId) {
      c.set("userId", userId);
    }
    await next();
  },
);
