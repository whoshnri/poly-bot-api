import { z } from "zod";

/**
 * Tools the LLM may request during phased workflow turns.
 */
export const modelDecisionToolSchema = z.enum([
  "get-markets",
  "web_research",
  "get-market-by-id",
  "get-market-price",
  "request_feedback",
]).describe("Tool names the model may request in the current workflow phase.");

const getMarketsToolMetadataSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe("Max active markets to fetch."),
  order: z.string().min(1).optional().describe("Gamma order field."),
  ascending: z.boolean().optional().describe("Sort ascending when true."),
  closed: z.boolean().optional().describe("Fetch closed markets when true."),
});

const getMarketPriceToolMetadataSchema = z.object({
  tokenId: z.string().min(1).describe("CLOB token ID for the outcome being priced."),
  side: z.enum(["BUY", "SELL"]).describe("Order side whose executable price is needed."),
});

const getMarketByIdToolMetadataSchema = z.object({
  marketId: z.string().min(1).describe("Gamma market ID to fetch full market details for."),
});

const webResearchToolMetadataSchema = z.object({
  topic: z
    .string()
    .min(1)
    .describe("Research topic only — Tavily search/crawl parameters are set server-side."),
});

const requestFeedbackToolMetadataSchema = z
  .object({
    type: z.enum(["mcq", "text", "mcq_or_custom", "multi_select"]).describe("How the operator should respond."),
    question: z.string().min(1).describe("The question to ask the operator."),
    options: z.array(z.string().min(1)).optional().describe("Choices for mcq and mcq_or_custom."),
    minSelections: z.number().int().min(1).optional().describe("Minimum selections for multi_select."),
    maxSelections: z.number().int().min(1).optional().describe("Maximum selections for multi_select."),
  })
  .superRefine((value, ctx) => {
    if (value.type !== "text" && (!value.options || value.options.length < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "At least two options are required for non-text feedback.",
      });
    }
  });

export const modelToolCallSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("get-markets"),
    reason: z.string().min(1).describe("Why active market discovery is needed before shortlist selection."),
    metadata: getMarketsToolMetadataSchema,
  }),
  z.object({
    tool: z.literal("get-market-price"),
    reason: z.string().min(1).describe("Why this price is needed before acting."),
    metadata: getMarketPriceToolMetadataSchema,
  }),
  z.object({
    tool: z.literal("get-market-by-id"),
    reason: z.string().min(1).describe("Why full market details are needed for evaluation."),
    metadata: getMarketByIdToolMetadataSchema,
  }),
  z.object({
    tool: z.literal("web_research"),
    reason: z.string().min(1).describe("Why external research is needed to inform the market decision."),
    metadata: webResearchToolMetadataSchema,
  }),
  z.object({
    tool: z.literal("request_feedback"),
    reason: z.string().min(1).describe("Why operator input is needed before proceeding."),
    metadata: requestFeedbackToolMetadataSchema,
  }),
]);

export const MODEL_TOOL_SLUGS = modelDecisionToolSchema.options;
