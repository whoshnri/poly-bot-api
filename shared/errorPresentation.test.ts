import { describe, expect, test } from "bun:test";
import {
  isNonUserFacingError,
  isNonUserFacingErrorMessage,
  shouldEmitRunErrorToUi,
} from "./errorPresentation";

describe("errorPresentation", () => {
  test("treats provider rate limits as non-user-facing", () => {
    expect(isNonUserFacingError(new Error("429 Too Many Requests"))).toBe(true);
    expect(
      isNonUserFacingError(new Error("Resource exhausted. Quota exceeded for metric generativelanguage.googleapis.com")),
    ).toBe(true);
    expect(shouldEmitRunErrorToUi(new Error("Rate limit exceeded"))).toBe(false);
  });

  test("treats graph guard errors as non-user-facing", () => {
    expect(isNonUserFacingError(new Error("Circuit breaker tripped after 6 operation failure(s)."))).toBe(
      true,
    );
    expect(isNonUserFacingError(new Error("Graph turn limit reached (12/12). Aborting this run."))).toBe(
      true,
    );
  });

  test("allows normal workflow errors through", () => {
    expect(isNonUserFacingError(new Error("No pending feedback request for this session."))).toBe(
      false,
    );
    expect(
      isNonUserFacingErrorMessage("Something went wrong: Session not found."),
    ).toBe(false);
  });
});
