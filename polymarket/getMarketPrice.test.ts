import { describe, expect, test } from "bun:test";
import { getMarketPrice } from "./getMarketPrice";

describe("getMarketPrice", () => {
  test("parses string price from CLOB", async () => {
    const tokenId =
      "19239676013860700691088049092452970929374202302906885826905266414962485495014";
    const result = await getMarketPrice({ tokenId, side: "BUY" });
    expect(result.source).toBe("clob");
    expect(typeof result.price).toBe("number");
    expect(Number.isFinite(result.price)).toBe(true);
    expect(result.price).toBeGreaterThanOrEqual(0);
    expect(result.price).toBeLessThanOrEqual(1);
  });

  test("throws when no price source available", async () => {
    await expect(
      getMarketPrice({
        tokenId: "99999999999999999999999999999999999999999999999999999999999999999",
        side: "BUY",
      }),
    ).rejects.toThrow();
  });
});
