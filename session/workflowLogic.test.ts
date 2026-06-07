import { describe, expect, test } from "bun:test";
import {
  MAX_SHORTLIST,
  allowedToolsForPhase,
  applyFeedbackToWorkflow,
  canExecuteTrade,
  defaultWorkflowState,
  formatRankedOption,
  enrichFeedbackRequest,
  formatShortlistOption,
  isToolAllowedInPhase,
  matchShortlistSelection,
  mergeShortlist,
  readWorkflowState,
  resolveApprovalFeedback,
  shortlistResearchComplete,
  trimShortlist,
  type SessionWorkflowState,
} from "./workflowLogic";

describe("defaultWorkflowState", () => {
  test("starts in DISCOVER when instruction is empty", () => {
    expect(defaultWorkflowState()).toEqual({ phase: "DISCOVER" });
    expect(defaultWorkflowState("   ")).toEqual({ phase: "DISCOVER" });
  });

  test("starts in DISCOVER with userSpec when instruction is present", () => {
    expect(defaultWorkflowState("celebrity news")).toEqual({
      phase: "DISCOVER",
      userSpec: { topic: "celebrity news", source: "prompt" },
    });
  });
});

describe("readWorkflowState", () => {
  test("returns DISCOVER for missing metadata", () => {
    expect(readWorkflowState(null)).toEqual({ phase: "DISCOVER" });
  });

  test("reads persisted workflow fields", () => {
    const workflow = readWorkflowState({
      workflow: {
        phase: "APPROVE",
        userSpec: { topic: "soccer", source: "feedback" },
        shortlist: [{ marketId: "m1", question: "Will X win?" }],
        selectedMarketIds: ["m1"],
        rankedMarketIds: ["m1"],
        operatorDecision: "approve",
      },
    });

    expect(workflow.phase).toBe("APPROVE");
    expect(workflow.userSpec?.topic).toBe("soccer");
    expect(workflow.shortlist).toHaveLength(1);
    expect(workflow.selectedMarketIds).toEqual(["m1"]);
    expect(workflow.rankedMarketIds).toEqual(["m1"]);
    expect(workflow.operatorDecision).toBe("approve");
  });
});

describe("allowedToolsForPhase", () => {
  test("limits discovery to active markets and feedback", () => {
    expect(allowedToolsForPhase("DISCOVER")).toEqual(["get-markets", "request_feedback"]);
  });

  test("blocks tools during EXECUTE and SLEEP", () => {
    expect(allowedToolsForPhase("EXECUTE")).toEqual([]);
    expect(allowedToolsForPhase("SLEEP")).toEqual([]);
  });

  test("isToolAllowedInPhase reflects allowlist", () => {
    expect(isToolAllowedInPhase("RESEARCH", "web_research")).toBe(true);
    expect(isToolAllowedInPhase("RESEARCH", "get-markets")).toBe(false);
  });
});

describe("shortlist helpers", () => {
  test("trimShortlist caps at ten entries", () => {
    const candidates = Array.from({ length: MAX_SHORTLIST + 2 }, (_, index) => ({
      marketId: `m${index}`,
      question: `Question ${index}`,
    }));

    expect(trimShortlist(candidates)).toHaveLength(MAX_SHORTLIST);
  });

  test("mergeShortlist deduplicates by marketId", () => {
    const merged = mergeShortlist(
      [{ marketId: "m1", question: "One" }],
      [
        { marketId: "m1", question: "One duplicate" },
        { marketId: "m2", question: "Two" },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.question).toBe("One");
  });

  test("shortlistResearchComplete requires every selected market", () => {
    expect(shortlistResearchComplete(["m1", "m2"], ["m1"])).toBe(false);
    expect(shortlistResearchComplete(["m1", "m2"], ["m1", "m2"])).toBe(true);
  });

  test("formats ranked labels from shortlist", () => {
    expect(
      formatRankedOption("m1", [{ marketId: "m1", question: "Will X win?" }]),
    ).toBe("[m1] Will X win?");
  });
});

describe("canExecuteTrade", () => {
  const ready: SessionWorkflowState = {
    phase: "EXECUTE",
    operatorDecision: "approve",
    chosen: {
      marketId: "m1",
      tokenId: "t1",
      side: "BUY",
      thesis: "Evidence supports YES.",
    },
  };

  test("allows trade when approval and order draft exist", () => {
    expect(canExecuteTrade(ready)).toEqual({ allowed: true });
  });

  test("blocks trade outside EXECUTE phase", () => {
    const result = canExecuteTrade({ ...ready, phase: "APPROVE" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("EXECUTE");
  });
});

describe("resolveApprovalFeedback", () => {
  const approvalPhase: SessionWorkflowState = {
    phase: "APPROVE",
    approvalReason: "Strong YES thesis.",
  };

  test("approve moves to EXECUTE", () => {
    const result = resolveApprovalFeedback(approvalPhase, { selectedOption: "Yes" });
    expect(result.workflow.phase).toBe("EXECUTE");
    expect(result.workflow.operatorDecision).toBe("approve");
  });

  test("reject moves to SLEEP", () => {
    const result = resolveApprovalFeedback(approvalPhase, { selectedOption: "No" });
    expect(result.workflow.phase).toBe("SLEEP");
    expect(result.workflow.operatorDecision).toBe("reject");
  });
});

describe("applyFeedbackToWorkflow", () => {
  test("SPEC feedback moves to DISCOVER", () => {
    const result = applyFeedbackToWorkflow(
      { phase: "SPEC" },
      { textAnswer: "Grammy awards" },
    );
    expect(result.workflow.phase).toBe("DISCOVER");
    expect(result.workflow.userSpec?.topic).toBe("Grammy awards");
  });

  test("SHORTLIST multi-select moves to RESEARCH", () => {
    const shortlist = [
      { marketId: "m1", question: "Will X win?" },
      { marketId: "m2", question: "Will Y win?" },
    ];
    const result = applyFeedbackToWorkflow(
      { phase: "SHORTLIST", shortlist, userSpec: { topic: "sports", source: "prompt" } },
      { selectedOptions: [formatShortlistOption(shortlist[0]!), formatShortlistOption(shortlist[1]!)] },
    );
    expect(result.workflow.phase).toBe("RESEARCH");
    expect(result.workflow.selectedMarketIds).toEqual(["m1", "m2"]);
  });

  test("DECIDE pick moves to BACKGROUND", () => {
    const shortlist = [{ marketId: "m1", question: "Will X win?" }];
    const result = applyFeedbackToWorkflow(
      { phase: "DECIDE", shortlist, rankedMarketIds: ["m1"] },
      { selectedOption: formatShortlistOption(shortlist[0]!) },
    );
    expect(result.workflow.phase).toBe("BACKGROUND");
    expect(result.workflow.chosen?.marketId).toBe("m1");
  });
});

describe("enrichFeedbackRequest", () => {
  test("builds multi-select options from workflow shortlist", () => {
    const shortlist = [
      { marketId: "m1", question: "Will X win?" },
      { marketId: "m2", question: "Will Y win?" },
    ];
    const feedback = enrichFeedbackRequest(
      "SHORTLIST",
      {
        type: "mcq",
        question: "Please select up to 10 markets you would like to shortlist for further research:",
      },
      { phase: "SHORTLIST", shortlist },
    );

    expect(feedback.type).toBe("multi_select");
    expect(feedback.options).toEqual([
      formatShortlistOption(shortlist[0]!),
      formatShortlistOption(shortlist[1]!),
    ]);
    expect(feedback.minSelections).toBe(1);
    expect(feedback.maxSelections).toBe(2);
  });

  test("enriches DECIDE options with actionable copy", () => {
    const shortlist = [{ marketId: "m1", question: "Will X win?" }];
    const feedback = enrichFeedbackRequest(
      "DECIDE",
      { type: "mcq", question: "Pick one" },
      { phase: "DECIDE", shortlist, rankedMarketIds: ["m1"] },
    );

    expect(feedback.options[0]).toContain("deep background research");
    expect(feedback.options[0]).toContain("highest EV");
  });

  test("enriches APPROVE options with detailed trade copy", () => {
    const feedback = enrichFeedbackRequest(
      "APPROVE",
      { type: "mcq", question: "Approve?" },
      {
        phase: "APPROVE",
        shortlist: [{ marketId: "m1", question: "Will X win?" }],
        chosen: { marketId: "m1", tokenId: "t1", side: "BUY", thesis: "yes" },
      },
    );

    expect(feedback.question).toContain("m1");
    expect(feedback.options[0]).toContain("place order");
    expect(feedback.options[1]).toContain("cancel");
  });
});

describe("matchShortlistSelection", () => {
  test("matches by market id in answer", () => {
    const shortlist = [{ marketId: "m1", question: "Will X win?" }];
    expect(matchShortlistSelection(shortlist, "pick m1 please")).toEqual(shortlist[0]);
  });
});
