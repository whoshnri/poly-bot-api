import { describe, expect, test } from "bun:test";
import type { EssentialGammaMarket } from "../types/polymarket";
import {
  extractTokenIdsFromGammaMarket,
  mergeTokenIdsIntoShortlist,
  MissingTradeTokenIdError,
  primaryTokenIdFromCandidate,
  requireTradeTokenId,
} from "./marketTokens";

describe("marketTokens", () => {
  test("extractTokenIdsFromGammaMarket reads outcome token ids", () => {
    const market: EssentialGammaMarket = {
      id: "m1",
      outcomes: [
        { name: "Yes", tokenId: "token-yes" },
        { name: "No", tokenId: "token-no" },
      ],
    };

    expect(extractTokenIdsFromGammaMarket(market)).toEqual(["token-yes", "token-no"]);
  });

  test("primaryTokenIdFromCandidate returns first non-empty token", () => {
    expect(
      primaryTokenIdFromCandidate({
        marketId: "m1",
        tokenIds: ["", "token-yes"],
      }),
    ).toBe("token-yes");
  });

  test("mergeTokenIdsIntoShortlist preserves existing ids and adds new ones", () => {
    const merged = mergeTokenIdsIntoShortlist(
      [
        { marketId: "m1", question: "Q1", tokenIds: ["existing"] },
        { marketId: "m2", question: "Q2" },
      ],
      new Map([
        ["m1", ["existing", "new"]],
        ["m2", ["token-2"]],
      ]),
    );

    expect(merged?.[0]?.tokenIds).toEqual(["existing", "new"]);
    expect(merged?.[1]?.tokenIds).toEqual(["token-2"]);
  });

  test("requireTradeTokenId prefers explicit and shortlist values", async () => {
    await expect(
      requireTradeTokenId({
        marketId: "m1",
        preferredTokenId: "preferred",
        knownTokenIds: ["shortlist"],
      }),
    ).resolves.toBe("preferred");

    await expect(
      requireTradeTokenId({
        marketId: "m1",
        knownTokenIds: ["shortlist-token"],
      }),
    ).resolves.toBe("shortlist-token");
  });

  test("requireTradeTokenId throws MissingTradeTokenIdError when lookup would be needed", async () => {
    await expect(requireTradeTokenId({ marketId: "missing-market" })).rejects.toBeInstanceOf(
      MissingTradeTokenIdError,
    );
  });
});
