import type {
  AIEstimate,
  NormalizedMarket,
  ScoredMarket,
} from "../lib/scoring";
import type { AiModelResponse } from "./schemas";
import type { ToolResponse } from "./tools";

export type AiGraphMessage = {
  role: "server" | "ai";
  content: string;
  timestamp: string;
};

export type FeedbackContinuation = {
  requestId: string;
  formattedAnswer: string;
  answer: {
    selectedOption?: string;
    selectedOptions?: string[];
    customText?: string;
    textAnswer?: string;
  };
};

export type CompileTradingGraphParams = {
  sessionId?: string;
  userId?: string;
  userInstruction?: string;
  forceInitPath?: boolean;
  feedbackContinuation?: FeedbackContinuation | null;
  onEvent?: BotUiEventSink;
};

export type BotUiEventKind =
  | "graph-run-start"
  | "graph-run-complete"
  | "graph-run-error"
  | "graph-node"
  | "ai-response"
  | "tool-call"
  | "tool-result"
  | "stage-action"
  | "chat-message"
  | "feedback-request"
  | "feedback-answer"
  | "bot-sleep";

export type BotUiEvent = {
  id: string;
  sessionId: string;
  timestamp: string;
  kind: BotUiEventKind;
  payload: Record<string, unknown>;
};

export type BotUiEventSink = (event: BotUiEvent) => void;

export type TradingGraphNodeState = {
  sessionId: string | null;
  userId: string | null;
  wakeTraceId: string | null;
  forceInitPath: boolean;
  userInstruction: string;
  feedbackContinuation: FeedbackContinuation | null;
  failureCount: number;
  turnCount: number;
  prompt: string;
  messages: AiGraphMessage[];
  aiResponse: AiModelResponse | null;
  intendedStartTradeOrder: {
    tokenId: string;
    side: "BUY" | "SELL";
    price: number;
    shareSize: number;
    orderType: "GTC" | "GTD";
    postOnly: boolean;
    expiration?: number;
  } | null;
  toolResults: ToolResponse<unknown>[];
  stageActionComplete: boolean;
  stopReason: string | null;
  botSleepRequested: boolean;
  onEvent: BotUiEventSink | null;
  normalizedMarkets: NormalizedMarket[];
  estimates: Record<string, AIEstimate>;
  scoredMarkets: ScoredMarket[];
  opportunities: ScoredMarket[];
};
