import { describe, expect, test } from "bun:test";
import {
  normalizeMarkdownInput,
  stripMarkdownForPreview,
} from "../../frontend/src/lib/markdown.ts";

describe("markdown normalization", () => {
  test("closes dangling code fences and trailing emphasis", () => {
    expect(normalizeMarkdownInput("Hello **world")).toBe("Hello world");
    expect(normalizeMarkdownInput("```ts\nconst x = 1")).toBe("```ts\nconst x = 1\n```");
  });

  test("strips markdown for previews", () => {
    expect(stripMarkdownForPreview("**Bold** _text_ and `code`")).toBe("Bold text and code");
  });
});
