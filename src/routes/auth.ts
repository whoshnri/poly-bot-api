import type { Context } from "hono";
import { authenticateUser, getUserByUserId, registerUser } from "../../db/auth";
import { jsonFail, jsonOk } from "../../shared/apiResponse";
import { clearSessionCookie, setSessionCookie } from "../middleware/auth";

export async function register(c: Context) {
  const body = (await c.req.json()) as { userId?: string; password?: string };
  if (!body.userId || !body.password) {
    return jsonFail(c, "userId and password are required.", 400);
  }

  try {
    const user = await registerUser({ userId: body.userId, password: body.password });
    setSessionCookie(c, user.userId);
    return jsonOk(
      c,
      {
        userId: user.userId,
        createdAt: user.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return jsonFail(
      c,
      error instanceof Error ? error.message : "Registration failed.",
      400,
    );
  }
}

export async function login(c: Context) {
  const body = (await c.req.json()) as { userId?: string; password?: string };
  if (!body.userId || !body.password) {
    return jsonFail(c, "userId and password are required.", 400);
  }

  try {
    const user = await authenticateUser({ userId: body.userId, password: body.password });
    setSessionCookie(c, user.userId);
    return jsonOk(c, {
      userId: user.userId,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    return jsonFail(c, error instanceof Error ? error.message : "Login failed.", 401);
  }
}

export async function logout(c: Context) {
  clearSessionCookie(c);
  return jsonOk(c, {});
}

export async function me(c: Context) {
  const userId = c.get("userId");
  const user = await getUserByUserId(userId);
  if (!user) {
    return jsonFail(c, "User not found.", 401);
  }

  return jsonOk(c, {
    userId: user.userId,
    createdAt: user.createdAt.toISOString(),
  });
}
