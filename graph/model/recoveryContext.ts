import type { SessionPhase } from "../../session/workflowLogic";

export type RecoveryContext = {
  searchQuery?: string;
  phase?: SessionPhase;
  shortlistMarketId?: string;
  tokenId?: string;
};

export function buildPhaseFallbackTool(context?: RecoveryContext): {
  tool: string;
  reason: string;
  metadata: Record<string, unknown>;
} {
  const phase = context?.phase ?? "DISCOVER";
  const query = context?.searchQuery?.trim() || "polymarket";

  if (phase === "BACKGROUND") {
    return {
      tool: "web_research",
      reason: "Recovering by gathering detailed background research for the final market.",
      metadata: {
        topic: query,
      },
    };
  }

  if (phase === "RESEARCH") {
    return {
      tool: "web_research",
      reason: "Recovering by researching the chosen market before deciding.",
      metadata: {
        topic: query,
      },
    };
  }

  if (phase === "DECIDE") {
    return {
      tool: "request_feedback",
      reason: "Recovering by asking the operator to pick the final market from the ranked list.",
      metadata: {
        type: "mcq",
        question: "Choose the final market to focus on from the ranked shortlist.",
        options: context?.shortlistMarketId
          ? [context.shortlistMarketId, "Restart discovery"]
          : ["Restart discovery", "Pause this session"],
      },
    };
  }

  if (phase === "PRICE" && context?.tokenId) {
    return {
      tool: "get-market-price",
      reason: "Recovering by fetching the executable price for the chosen token.",
      metadata: {
        tokenId: context.tokenId,
        side: "BUY",
      },
    };
  }

  if (phase === "APPROVE") {
    return {
      tool: "request_feedback",
      reason: "Recovering by asking the operator to approve or reject the trade proposal.",
      metadata: {
        type: "mcq",
        question:
          "The previous model response was incomplete. Review the thread and choose whether to proceed.",
        options: ["Yes, place order", "No, cancel"],
      },
    };
  }

  if (phase === "DISCOVER") {
    return {
      tool: "get-markets",
      reason: "Recovering by loading active Polymarket markets for the shortlist.",
      metadata: {
        limit: 10,
        order: "volume24hr",
        ascending: false,
        closed: false,
      },
    };
  }

  if (phase === "SHORTLIST") {
    return {
      tool: "request_feedback",
      reason: "Recovering by asking the operator to select one or more markets from the shortlist.",
      metadata: {
        type: "multi_select",
        question: "Pick one or more shortlist markets so research can continue.",
        options: context?.shortlistMarketId
          ? [context.shortlistMarketId, "Restart discovery"]
          : ["Restart discovery", "Pause this session"],
        minSelections: 1,
        maxSelections: 2,
      },
    };
  }

  return {
    tool: "request_feedback",
    reason: "Recovering by asking the operator for direction.",
    metadata: {
      type: "text",
      question: "The bot needs your direction to continue this session. What should it do next?",
    },
  };
}
