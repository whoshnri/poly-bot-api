import type { Context } from "hono";
import { jsonFail, jsonOk } from "../../shared/apiResponse";
import type { WakeRequestBody } from "../../types/server";

function verifyWakeToken(c: Context): boolean {
  const expected = process.env.WAKE_API_TOKEN;
  if (!expected) {
    return true;
  }

  const authHeader = c.req.header("Authorization");
  return authHeader === `Bearer ${expected}`;
}


export function getHealth(c: Context) {
  return jsonOk(c, {
    status: "ok",
    now: new Date().toISOString(),
  });
}
