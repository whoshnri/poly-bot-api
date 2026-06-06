import type { z } from "zod";
import type {
  aiModelResponseSchema,
  modelDecisionToolSchema,
  modelToolCallSchema,
  nextStageSchema,
  stageActionSchema,
} from "../tools/schemas";

export type StageAction = z.infer<typeof stageActionSchema>;
export type DecisionTool = z.infer<typeof modelDecisionToolSchema>;
export type ToolCall = z.infer<typeof modelToolCallSchema>;
export type NextStage = z.infer<typeof nextStageSchema>;
export type AiModelResponse = z.infer<typeof aiModelResponseSchema>;
