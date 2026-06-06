import { z } from "zod";
import { modelDecisionToolSchema, modelToolCallSchema } from "./modelSchemas";

export { modelDecisionToolSchema, modelToolCallSchema, MODEL_TOOL_SLUGS } from "./modelSchemas";

/** @deprecated Use modelDecisionToolSchema */
export const decisionToolSchema = modelDecisionToolSchema;

/** @deprecated Use modelToolCallSchema */
export const toolCallSchema = modelToolCallSchema;

/**
 * Canonical stage actions used by the AI orchestration flow.
 */
export const stageActionSchema = z.enum([
  "START_TRADE",
  "END_TRADE",
  "WAIT",
  "SKIP",
  "CLARIFY",
]).describe("Terminal action to execute after this reasoning turn, or null when more tool data is needed.");

const startTradeActionDataSchema = z.object({
  reason: z.string().min(1).describe("Concise rationale for opening the trade now."),
  resumeAt: z.iso.datetime().describe("ISO datetime when the bot should wake to monitor or close this trade."),
  order: z.object({
    tokenId: z.string().min(1).describe("CLOB token ID to trade."),
    side: z.enum(["BUY", "SELL"]).describe("Order side."),
    price: z.number().positive().describe("Limit price in USDC probability terms, e.g. 0.42."),
    shareSize: z.number().positive().describe("Number of outcome shares/contracts to trade. For BUY, estimated spend is price * shareSize."),
    orderType: z.enum(["GTC", "GTD"]).default("GTC").describe("Limit order type. Use GTD only when expiration is provided."),
    postOnly: z.boolean().default(false).describe("Whether the order must rest on the book instead of taking liquidity."),
    expiration: z.number().int().positive().optional().describe("Unix seconds expiration for GTD orders."),
  }).describe("Limit order the graph should submit if guardrails and market constraints pass."),
});

const endTradeActionDataSchema = z.object({
  reason: z.string().min(1).describe("Concise rationale for ending the active trade."),
});

const waitActionDataSchema = z.object({
  reason: z.string().min(1).describe("Why waiting is better than trading now."),
  resumeAt: z.iso.datetime().describe("ISO datetime for the next wake cycle."),
});

const skipActionDataSchema = z.object({
  reason: z.string().min(1).describe("Why this session or opportunity should be skipped."),
});

const clarifyActionDataSchema = z.object({
  reason: z.string().min(1).describe("Why operator input is required."),
  userMessageHtml: z.string().min(1).describe("HTML message to show the operator."),
  resumeAt: z.iso.datetime().describe("ISO datetime to wake again if no operator response arrives."),
});

/**
 * Single next-stage payload. This stores only the next stage, never previous/future lists.
 */
export const nextStageSchema = z.object({
  summary: z.string().min(1).describe("Short persistent summary of what was decided in this stage."),
  todo: z.string().min(1).describe("Concrete next thing the bot should do on the following wake or model turn."),
  stageAction: stageActionSchema.nullable().describe("Action to execute now. Use null only when toolCalls are needed first."),
  stageActionData: z.union([
    startTradeActionDataSchema,
    endTradeActionDataSchema,
    waitActionDataSchema,
    skipActionDataSchema,
    clarifyActionDataSchema,
    z.null(),
  ]).describe("Payload for stageAction. Must be null when stageAction is null."),
});

/**
 * Structured AI response consumed by the graph.
 */
export const aiModelResponseSchema = z
  .object({
    message: z.string().min(1).describe("Plain-language decision update for the operator. Avoid repeating nextStage fields verbatim."),
    reasoning: z.string().min(1).describe("Concise rationale using observed market data, guardrails, and risk considerations."),
    isTradeActive: z.boolean().describe("Whether the bot currently believes this session has an active trade or open order."),
    toolCalls: z.array(modelToolCallSchema).default([]).describe("Decision-support tool calls needed before choosing a terminal stageAction."),
    nextStage: nextStageSchema.describe("Persistent state transition for the session."),
  })
  .superRefine((value, ctx) => {
    const { stageAction, stageActionData } = value.nextStage;

    if (stageAction === null) {
      if (stageActionData !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nextStage", "stageActionData"],
          message: "stageActionData must be null when stageAction is null.",
        });
      }

      return;
    }

    if (stageActionData === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextStage", "stageActionData"],
        message: "stageActionData is required when stageAction is set.",
      });
      return;
    }

    const validators = {
      START_TRADE: startTradeActionDataSchema,
      END_TRADE: endTradeActionDataSchema,
      WAIT: waitActionDataSchema,
      SKIP: skipActionDataSchema,
      CLARIFY: clarifyActionDataSchema,
    } as const;

    const result = validators[stageAction].safeParse(stageActionData);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["nextStage", "stageActionData", ...issue.path],
        });
      }
    }
  });
