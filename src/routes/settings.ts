import type { Context } from "hono";
import {
  applyRuntimeBotConfigForUser,
  assertSessionOwnedByUser,
  assertUserCanRunBot,
  getUserRunReadiness,
  getUserSettings,
  updateUserSettings,
} from "../../db/users";
import { jsonFail, jsonOk } from "../../shared/apiResponse";

export async function readSettings(c: Context) {
  const userId = c.get("userId");
  const settings = await getUserSettings(userId);
  return jsonOk(c, settings as Record<string, unknown>);
}

export async function readRunReadiness(c: Context) {
  const userId = c.get("userId");
  const readiness = await getUserRunReadiness(userId);
  return jsonOk(c, readiness as Record<string, unknown>);
}

export async function writeSettings(c: Context) {
  const userId = c.get("userId");
  const body = await c.req.json();
  const settings = await updateUserSettings(userId, body);
  return jsonOk(c, settings as Record<string, unknown>);
}

export async function assertOwned(sessionId: string, userId: string): Promise<boolean> {
  try {
    await assertSessionOwnedByUser(sessionId, userId);
    return true;
  } catch {
    return false;
  }
}

export { applyRuntimeBotConfigForUser };
