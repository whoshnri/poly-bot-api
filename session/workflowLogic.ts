export const MAX_SHORTLIST = 10;

export type SessionPhase =
  | "SPEC"
  | "DISCOVER"
  | "SHORTLIST"
  | "RESEARCH"
  | "DECIDE"
  | "BACKGROUND"
  | "PRICE"
  | "APPROVE"
  | "EXECUTE"
  | "SLEEP";

export type UserSpecSource = "prompt" | "feedback";

export type UserSpec = {
  topic?: string;
  targetMarketId?: string;
  source: UserSpecSource;
};

export type MarketCandidate = {
  marketId: string;
  question: string;
  eventTitle?: string;
  tokenIds?: string[];
  category?: string;
  endDate?: string;
  liquidity?: number;
  volume?: number;
};

export type ChosenMarket = {
  marketId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  thesis: string;
};

export type PendingOrder = {
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  shareSize: number;
  orderType?: "GTC" | "GTD";
  postOnly?: boolean;
};

export type OperatorDecision = "approve" | "reject" | "pivot";

export type SessionWorkflowState = {
  phase: SessionPhase;
  userSpec?: UserSpec;
  shortlist?: MarketCandidate[];
  selectedMarketIds?: string[];
  rankedMarketIds?: string[];
  chosen?: ChosenMarket;
  pendingOrder?: PendingOrder;
  approvalReason?: string;
  operatorDecision?: OperatorDecision;
};

export type WorkflowToolSlug =
  | "request_feedback"
  | "get-markets"
  | "web_research"
  | "get-market-by-id"
  | "get-market-price";

const PHASE_TOOL_ALLOWLIST: Record<SessionPhase, WorkflowToolSlug[]> = {
  SPEC: ["request_feedback"],
  DISCOVER: ["get-markets", "request_feedback"],
  SHORTLIST: ["request_feedback"],
  RESEARCH: ["web_research", "request_feedback"],
  DECIDE: ["request_feedback"],
  BACKGROUND: ["web_research", "get-market-by-id"],
  PRICE: ["get-market-price"],
  APPROVE: ["request_feedback"],
  EXECUTE: [],
  SLEEP: [],
};

export type FeedbackAnswer = {
  selectedOption?: string;
  selectedOptions?: string[];
  customText?: string;
  textAnswer?: string;
};

export type FeedbackResolution = {
  workflow: SessionWorkflowState;
  pivotInstruction?: string;
};

export function formatShortlistOption(candidate: MarketCandidate): string {
  return `[${candidate.marketId}] ${candidate.question}`;
}

const APPROVE_FEEDBACK_OPTIONS = ["Yes, place order", "No, cancel"] as const;

export function enrichFeedbackRequest(
  phase: SessionPhase,
  metadata: {
    type: "mcq" | "text" | "mcq_or_custom" | "multi_select";
    question: string;
    options?: string[];
    minSelections?: number;
    maxSelections?: number;
  },
  workflow: SessionWorkflowState,
): {
  type: "mcq" | "text" | "mcq_or_custom" | "multi_select";
  question: string;
  options: string[];
  minSelections?: number;
  maxSelections?: number;
} {
  if (phase === "SHORTLIST") {
    const options = (workflow.shortlist ?? [])
      .slice(0, MAX_SHORTLIST)
      .map(formatShortlistOption);
    if (options.length === 0) {
      throw new Error("No shortlisted markets available to present for selection.");
    }

    return {
      type: "multi_select",
      question: metadata.question,
      options,
      minSelections: metadata.minSelections ?? 1,
      maxSelections: metadata.maxSelections ?? Math.min(MAX_SHORTLIST, options.length),
    };
  }

  if (phase === "APPROVE") {
    const chosenLabel = workflow.chosen?.marketId
      ? formatRankedOption(workflow.chosen.marketId, workflow.shortlist)
      : "the chosen market";
    const options =
      metadata.options && metadata.options.length >= 2
        ? metadata.options
        : [
            "Yes, place order — submit the trade at the calculated size and limit price.",
            "No, cancel — pause the session without placing a trade.",
          ];

    return {
      type: "mcq",
      question: `Ready to place the order on ${chosenLabel}? Review the breakdown above, then choose an option.`,
      options,
    };
  }

  if (phase === "DECIDE") {
    const rankedIds = workflow.rankedMarketIds ?? [];
    const options =
      rankedIds.length > 0
        ? rankedIds.map((marketId, index) => {
            const label = formatRankedOption(marketId, workflow.shortlist);
            const rankHint = index === 0 ? " (highest EV)" : "";
            return `${label}${rankHint} — Run deep background research on this pick before approval.`;
          })
        : (metadata.options ?? []);

    return {
      type: "mcq",
      question:
        "Pick one market to focus on next. Options are ranked by expected value (best first).",
      options,
    };
  }

  return {
    type: metadata.type,
    question: metadata.question,
    options: metadata.options ?? [],
    minSelections: metadata.minSelections,
    maxSelections: metadata.maxSelections,
  };
}

export function formatRankedOption(
  marketId: string,
  shortlist: MarketCandidate[] | undefined,
): string {
  const match = shortlist?.find((candidate) => candidate.marketId === marketId);
  return match ? formatShortlistOption(match) : `[${marketId}]`;
}

export function matchShortlistSelection(
  shortlist: MarketCandidate[] | undefined,
  answer: string,
): MarketCandidate | null {
  if (!shortlist || shortlist.length === 0 || answer.trim().length === 0) {
    return null;
  }

  const normalized = answer.trim().toLowerCase();
  for (const candidate of shortlist) {
    const label = formatShortlistOption(candidate).toLowerCase();
    if (normalized === label || normalized.includes(candidate.marketId.toLowerCase())) {
      return candidate;
    }

    const questionPrefix = candidate.question.toLowerCase().slice(0, 64);
    if (questionPrefix.length >= 12 && normalized.includes(questionPrefix)) {
      return candidate;
    }
  }

  return null;
}

function buildChosenFromCandidate(
  candidate: MarketCandidate,
  existing?: ChosenMarket,
): ChosenMarket {
  const fromCandidate = candidate.tokenIds?.find((tokenId) => tokenId.trim().length > 0);
  return {
    marketId: candidate.marketId,
    tokenId: fromCandidate ?? existing?.tokenId ?? "",
    side: existing?.side ?? "BUY",
    thesis: existing?.thesis ?? "",
  };
}

export function defaultWorkflowState(instruction?: string): SessionWorkflowState {
  const trimmed = instruction?.trim() ?? "";
  if (trimmed.length === 0) {
    return { phase: "DISCOVER" };
  }

  return {
    phase: "DISCOVER",
    userSpec: {
      topic: trimmed,
      source: "prompt",
    },
  };
}

export type PreSessionMarketInput = {
  marketId: string;
  question: string;
  eventTitle?: string;
  tokenIds?: string[];
};

export type PreSessionExploreMessage = {
  role: "user" | "bot";
  content: string;
};

export type PreSessionInput = {
  topic: string;
  summary?: string;
  queries?: string[];
  selectedMarketId: string;
  selectedMarketIds?: string[];
  markets: PreSessionMarketInput[];
  exploreMessages?: PreSessionExploreMessage[];
};

export function readPreSessionFromMetadata(metadata: unknown): PreSessionInput | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const raw = (metadata as Record<string, unknown>).preSession;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const topic = typeof value.topic === "string" ? value.topic.trim() : "";
  const selectedMarketId =
    typeof value.selectedMarketId === "string" ? value.selectedMarketId.trim() : "";
  const markets = Array.isArray(value.markets) ? value.markets : [];

  if (!topic || !selectedMarketId || markets.length === 0) {
    return null;
  }

  const selectedMarketIds = Array.isArray(value.selectedMarketIds)
    ? value.selectedMarketIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [selectedMarketId];

  return {
    topic,
    summary: typeof value.summary === "string" ? value.summary.trim() : undefined,
    queries: Array.isArray(value.queries)
      ? value.queries.filter((entry): entry is string => typeof entry === "string")
      : [],
    selectedMarketId,
    selectedMarketIds,
    exploreMessages: Array.isArray(value.exploreMessages)
      ? value.exploreMessages
          .filter(
            (entry): entry is PreSessionExploreMessage =>
              Boolean(entry) &&
              typeof entry === "object" &&
              ((entry as PreSessionExploreMessage).role === "user" ||
                (entry as PreSessionExploreMessage).role === "bot") &&
              typeof (entry as PreSessionExploreMessage).content === "string",
          )
          .map((entry) => ({
            role: entry.role,
            content: entry.content.trim(),
          }))
          .filter((entry) => entry.content.length > 0)
      : undefined,
    markets: markets
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((market) => ({
        marketId: typeof market.marketId === "string" ? market.marketId.trim() : "",
        question: typeof market.question === "string" ? market.question.trim() : "Untitled market",
        eventTitle: typeof market.eventTitle === "string" ? market.eventTitle.trim() : undefined,
        tokenIds: Array.isArray(market.tokenIds)
          ? market.tokenIds.filter((tokenId): tokenId is string => typeof tokenId === "string")
          : undefined,
      }))
      .filter((market) => market.marketId.length > 0),
  };
}

export function workflowFromPreSession(preSession: PreSessionInput): SessionWorkflowState {
  const shortlist = trimShortlist(
    preSession.markets.map((market) => ({
      marketId: market.marketId,
      question: market.question,
      eventTitle: market.eventTitle,
      tokenIds: market.tokenIds,
    })),
  );

  const requestedIds = (preSession.selectedMarketIds ?? [preSession.selectedMarketId])
    .map((marketId) => marketId.trim())
    .filter(Boolean);
  const selectedMarketIds = requestedIds.filter((marketId, index, all) =>
    all.indexOf(marketId) === index,
  );

  if (selectedMarketIds.length === 0) {
    throw new Error("Pre-session payload must include at least one selected market.");
  }

  const primary =
    shortlist.find((candidate) => candidate.marketId === preSession.selectedMarketId) ??
    shortlist.find((candidate) => candidate.marketId === selectedMarketIds[0]) ??
    shortlist[0];

  if (!primary) {
    throw new Error("Pre-session payload must include at least one market.");
  }

  return {
    phase: "RESEARCH",
    userSpec: {
      topic: preSession.topic,
      source: "prompt",
      targetMarketId: primary.marketId,
    },
    shortlist,
    selectedMarketIds,
  };
}

export function readWorkflowState(metadata: unknown): SessionWorkflowState {
  if (!metadata || typeof metadata !== "object") {
    return { phase: "DISCOVER" };
  }

  const raw = (metadata as Record<string, unknown>).workflow;
  if (!raw || typeof raw !== "object") {
    return { phase: "DISCOVER" };
  }

  const value = raw as Record<string, unknown>;
  const phase = value.phase;
  if (typeof phase !== "string" || !(phase in PHASE_TOOL_ALLOWLIST)) {
    return { phase: "DISCOVER" };
  }

  return {
    phase: phase as SessionPhase,
    userSpec: readUserSpec(value.userSpec),
    shortlist: readShortlist(value.shortlist),
    selectedMarketIds: readStringArray(value.selectedMarketIds),
    rankedMarketIds: readStringArray(value.rankedMarketIds),
    chosen: readChosen(value.chosen),
    pendingOrder: readPendingOrder(value.pendingOrder),
    approvalReason:
      typeof value.approvalReason === "string" ? value.approvalReason : undefined,
    operatorDecision: readOperatorDecision(value.operatorDecision),
  };
}

export function allowedToolsForPhase(phase: SessionPhase): WorkflowToolSlug[] {
  return [...PHASE_TOOL_ALLOWLIST[phase]];
}

export function isToolAllowedInPhase(phase: SessionPhase, tool: string): boolean {
  return allowedToolsForPhase(phase).includes(tool as WorkflowToolSlug);
}

export function trimShortlist(candidates: MarketCandidate[]): MarketCandidate[] {
  return candidates.slice(0, MAX_SHORTLIST);
}

export function mergeShortlist(
  current: MarketCandidate[] | undefined,
  incoming: MarketCandidate[],
): MarketCandidate[] {
  const merged = [...(current ?? [])];
  for (const candidate of incoming) {
    if (!merged.some((entry) => entry.marketId === candidate.marketId)) {
      merged.push(candidate);
    }
  }
  return trimShortlist(merged);
}

export function shortlistResearchComplete(
  selectedMarketIds: string[] | undefined,
  researchedMarketIds: string[],
): boolean {
  if (!selectedMarketIds || selectedMarketIds.length === 0) {
    return false;
  }

  const researched = new Set(researchedMarketIds);
  return selectedMarketIds.every((marketId) => researched.has(marketId));
}

export function canExecuteTrade(workflow: SessionWorkflowState): {
  allowed: boolean;
  reason?: string;
} {
  if (workflow.phase !== "EXECUTE") {
    return {
      allowed: false,
      reason: `Trade execution requires EXECUTE phase (current: ${workflow.phase}).`,
    };
  }

  if (workflow.operatorDecision !== "approve") {
    return {
      allowed: false,
      reason: "Operator approval is required before placing an order.",
    };
  }

  if (!workflow.chosen?.tokenId) {
    return {
      allowed: false,
      reason: "No chosen market/token is recorded for this session.",
    };
  }

  return { allowed: true };
}

export function applyFeedbackToWorkflow(
  workflow: SessionWorkflowState,
  answer: FeedbackAnswer,
): FeedbackResolution {
  if (workflow.phase === "APPROVE") {
    return resolveApprovalFeedback(workflow, answer);
  }

  if (workflow.phase === "SHORTLIST") {
    return resolveShortlistFeedback(workflow, answer);
  }

  if (workflow.phase === "DECIDE") {
    return resolveDecisionFeedback(workflow, answer);
  }

  const normalized = normalizeFeedbackAnswer(answer);
  if (normalized.length === 0) {
    return { workflow };
  }

  if (workflow.phase === "SPEC") {
    return {
      workflow: {
        phase: "DISCOVER",
        userSpec: {
          topic: normalized,
          source: "feedback",
        },
      },
      pivotInstruction: normalized,
    };
  }

  if (isRejectionAnswer(normalized)) {
    return {
      workflow: {
        ...workflow,
        operatorDecision: "reject",
        phase: "SLEEP",
      },
    };
  }

  return {
    workflow: {
      ...defaultWorkflowState(normalized),
      operatorDecision: "pivot",
    },
    pivotInstruction: normalized,
  };
}

function resolveShortlistFeedback(
  workflow: SessionWorkflowState,
  answer: FeedbackAnswer,
): FeedbackResolution {
  const selectedOptions =
    answer.selectedOptions?.map((entry) => entry.trim()).filter(Boolean) ?? [];

  if (selectedOptions.length > 0 && workflow.shortlist) {
    const selectedMarketIds = selectedOptions
      .map((option) => matchShortlistSelection(workflow.shortlist, option)?.marketId ?? null)
      .filter((marketId): marketId is string => marketId !== null);

    if (selectedMarketIds.length > 0) {
      const primary = workflow.shortlist.find(
        (candidate) => candidate.marketId === selectedMarketIds[0],
      );
      return {
        workflow: {
          ...workflow,
          phase: "RESEARCH",
          selectedMarketIds,
          rankedMarketIds: undefined,
          userSpec: {
            source: workflow.userSpec?.source ?? "feedback",
            topic: workflow.userSpec?.topic ?? primary?.question,
            targetMarketId: primary?.marketId,
          },
        },
      };
    }
  }

  const normalized = normalizeFeedbackAnswer(answer);
  if (normalized.length === 0) {
    return { workflow };
  }

  return {
    workflow: {
      phase: "DISCOVER",
      userSpec: {
        topic: normalized,
        source: "feedback",
      },
      operatorDecision: "pivot",
    },
    pivotInstruction: normalized,
  };
}

function resolveDecisionFeedback(
  workflow: SessionWorkflowState,
  answer: FeedbackAnswer,
): FeedbackResolution {
  const normalized = normalizeFeedbackAnswer(answer);
  const chosen = matchShortlistSelection(workflow.shortlist, normalized);
  if (chosen) {
    return {
      workflow: {
        ...workflow,
        phase: "BACKGROUND",
        userSpec: {
          source: workflow.userSpec?.source ?? "feedback",
          topic: workflow.userSpec?.topic ?? chosen.question,
          targetMarketId: chosen.marketId,
        },
        chosen: buildChosenFromCandidate(chosen, workflow.chosen),
      },
    };
  }

  if (normalized.length === 0) {
    return { workflow };
  }

  if (isRejectionAnswer(normalized)) {
    return {
      workflow: {
        ...workflow,
        operatorDecision: "reject",
        phase: "SLEEP",
      },
    };
  }

  return {
    workflow: {
      ...defaultWorkflowState(normalized),
      operatorDecision: "pivot",
    },
    pivotInstruction: normalized,
  };
}

function normalizeFeedbackAnswer(answer: FeedbackAnswer): string {
  if (Array.isArray(answer.selectedOptions) && answer.selectedOptions.length > 0) {
    return answer.selectedOptions.join(" | ").trim();
  }

  return (answer.textAnswer ?? answer.customText ?? answer.selectedOption ?? "").trim();
}

function isApprovalAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return (
    normalized.startsWith("yes") ||
    normalized === "approve" ||
    normalized === "confirm" ||
    normalized.includes("place order")
  );
}

function isRejectionAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return (
    normalized.startsWith("no") ||
    normalized === "reject" ||
    normalized === "cancel" ||
    normalized === "skip" ||
    normalized === "stop"
  );
}

export function resolveApprovalFeedback(
  workflow: SessionWorkflowState,
  answer: FeedbackAnswer,
): FeedbackResolution {
  const normalized = normalizeFeedbackAnswer(answer);

  if (isApprovalAnswer(normalized)) {
    return {
      workflow: {
        ...workflow,
        operatorDecision: "approve",
        phase: "EXECUTE",
      },
    };
  }

  if (isRejectionAnswer(normalized)) {
    return {
      workflow: {
        ...workflow,
        operatorDecision: "reject",
        phase: "SLEEP",
      },
    };
  }

  if (normalized.length === 0) {
    return { workflow };
  }

  return {
    workflow: {
      ...defaultWorkflowState(normalized),
      operatorDecision: "pivot",
    },
    pivotInstruction: normalized,
  };
}

function readUserSpec(value: unknown): UserSpec | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const source = record.source;
  if (source !== "prompt" && source !== "feedback") {
    return undefined;
  }

  return {
    source,
    topic: typeof record.topic === "string" ? record.topic : undefined,
    targetMarketId:
      typeof record.targetMarketId === "string" ? record.targetMarketId : undefined,
  };
}

function readShortlist(value: unknown): MarketCandidate[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const candidates = value
    .map((entry) => readMarketCandidate(entry))
    .filter((entry): entry is MarketCandidate => entry !== null);

  return candidates.length > 0 ? trimShortlist(candidates) : undefined;
}

function readMarketCandidate(value: unknown): MarketCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.marketId !== "string" || typeof record.question !== "string") {
    return null;
  }

  return {
    marketId: record.marketId,
    question: record.question,
    eventTitle: typeof record.eventTitle === "string" ? record.eventTitle : undefined,
    tokenIds: Array.isArray(record.tokenIds)
      ? record.tokenIds.filter((tokenId): tokenId is string => typeof tokenId === "string")
      : undefined,
    category: typeof record.category === "string" ? record.category : undefined,
    endDate: typeof record.endDate === "string" ? record.endDate : undefined,
    liquidity: typeof record.liquidity === "number" ? record.liquidity : undefined,
    volume: typeof record.volume === "number" ? record.volume : undefined,
  };
}

function readChosen(value: unknown): ChosenMarket | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.marketId !== "string" ||
    typeof record.tokenId !== "string" ||
    typeof record.thesis !== "string" ||
    (record.side !== "BUY" && record.side !== "SELL")
  ) {
    return undefined;
  }

  return {
    marketId: record.marketId,
    tokenId: record.tokenId,
    side: record.side,
    thesis: record.thesis,
  };
}

function readPendingOrder(value: unknown): PendingOrder | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.tokenId !== "string" ||
    (record.side !== "BUY" && record.side !== "SELL") ||
    typeof record.price !== "number" ||
    typeof record.shareSize !== "number"
  ) {
    return undefined;
  }

  return {
    tokenId: record.tokenId,
    side: record.side,
    price: record.price,
    shareSize: record.shareSize,
    orderType:
      record.orderType === "GTD" ? "GTD" : record.orderType === "GTC" ? "GTC" : undefined,
    postOnly: record.postOnly === true ? true : undefined,
  };
}

function readOperatorDecision(value: unknown): OperatorDecision | undefined {
  if (value === "approve" || value === "reject" || value === "pivot") {
    return value;
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value.filter((entry): entry is string => typeof entry === "string");
  return entries.length > 0 ? entries : undefined;
}
