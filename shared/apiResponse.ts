import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiSuccessBody = { success: true } & Record<string, unknown>;
export type ApiFailureBody = { success: false; error: string; details?: string };

export function jsonOk(
  c: Context,
  data: Record<string, unknown>,
  status: ContentfulStatusCode = 200,
) {
  return c.json({ success: true, ...data }, status);
}

export function jsonFail(
  c: Context,
  error: string,
  status: ContentfulStatusCode = 400,
  details?: string,
) {
  return c.json(
    {
      success: false,
      error,
      ...(details ? { details } : {}),
    } satisfies ApiFailureBody,
    status,
  );
}
