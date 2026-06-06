export function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function errorHaystack(error: unknown): string {
  const message = readErrorMessage(error).toLowerCase();
  if (!error || typeof error !== "object") {
    return message;
  }

  try {
    return `${message} ${JSON.stringify(error).toLowerCase()}`;
  } catch {
    return message;
  }
}

const NON_USER_FACING_PATTERNS = [
  /\b429\b/,
  /\b503\b/,
  /rate limit/,
  /too many requests/,
  /quota exceeded/,
  /exceeded your current quota/,
  /resource_exhausted/,
  /resource exhausted/,
  /requests per minute/,
  /tokens per minute/,
  /rpm limit/,
  /capacity limit/,
  /circuit breaker/,
  /turn limit reached/,
  /graph turn limit/,
  /graph recursion limit/,
  /graph_recursion_limit/,
  /recursion limit/,
];

export function isNonUserFacingError(error: unknown): boolean {
  const haystack = errorHaystack(error);
  return NON_USER_FACING_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function isNonUserFacingErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const stripped = normalized
    .replace(/^something went wrong:\s*/i, "")
    .replace(/^you chose:\s*/i, "");

  return NON_USER_FACING_PATTERNS.some((pattern) => pattern.test(stripped));
}

export function shouldEmitRunErrorToUi(error: unknown): boolean {
  return !isNonUserFacingError(error);
}
