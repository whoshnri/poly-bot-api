import { describe, expect, test } from "bun:test";
import { formatFeedbackAnswer } from "./feedback";

describe("formatFeedbackAnswer", () => {
  test("allows selecting more than two shortlist markets", () => {
    const options = Array.from({ length: 5 }, (_, index) => `[m${index + 1}] Market ${index + 1}`);

    const formatted = formatFeedbackAnswer(
      {
        type: "multi_select",
        question: "Pick markets",
        options,
        minSelections: 1,
        maxSelections: 5,
      },
      {
        selectedOptions: options.slice(0, 3),
      },
    );

    expect(formatted).toBe(`You chose: ${options.slice(0, 3).join(" | ")}`);
  });

  test("rejects multi-select answers above maxSelections", () => {
    const options = ["[m1] One", "[m2] Two", "[m3] Three"];

    expect(() =>
      formatFeedbackAnswer(
        {
          type: "multi_select",
          question: "Pick markets",
          options,
          minSelections: 1,
          maxSelections: 2,
        },
        {
          selectedOptions: options,
        },
      ),
    ).toThrow("Select no more than 2 options.");
  });

  test("accepts mcq textAnswer as custom direction", () => {
    expect(
      formatFeedbackAnswer(
        {
          type: "mcq",
          question: "Approve?",
          options: ["Yes, place order", "No, cancel"],
        },
        { textAnswer: "Focus on a different market" },
      ),
    ).toBe("Custom note: Focus on a different market");
  });
});
