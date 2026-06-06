import { Annotation } from "@langchain/langgraph";
import type {
  AIEstimate,
  NormalizedMarket,
  ScoredMarket,
} from "../lib/scoring";
import type { AiGraphMessage, TradingGraphNodeState } from "../types/graph";
import type { AiModelResponse } from "../types/schemas";
import type { ToolResponse } from "../types/tools";

export const tradingGraphState = Annotation.Root({
  sessionId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  userId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  wakeTraceId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  forceInitPath: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  userInstruction: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  feedbackContinuation: Annotation<TradingGraphNodeState["feedbackContinuation"]>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  failureCount: Annotation<number>({
    reducer: (left, right) => left + right,
    default: () => 0,
  }),
  turnCount: Annotation<number>({
    reducer: (left, right) => left + right,
    default: () => 0,
  }),
  prompt: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  messages: Annotation<AiGraphMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  aiResponse: Annotation<AiModelResponse | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  intendedStartTradeOrder: Annotation<
    TradingGraphNodeState["intendedStartTradeOrder"]
  >({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  toolResults: Annotation<ToolResponse<unknown>[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  stageActionComplete: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => true,
  }),
  stopReason: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  botSleepRequested: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  onEvent: Annotation<TradingGraphNodeState["onEvent"]>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  normalizedMarkets: Annotation<NormalizedMarket[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  estimates: Annotation<Record<string, AIEstimate>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  scoredMarkets: Annotation<ScoredMarket[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  opportunities: Annotation<ScoredMarket[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
});
