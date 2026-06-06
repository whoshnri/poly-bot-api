import { getBotGaurdrails } from "../../config/bot";
import type { WorkflowToolSlug } from "../../session/workflowLogic";

export type ModelInstructionContext = {
  allowedTools: WorkflowToolSlug[];
  phase: string;
};

const ALL_TOOLS: WorkflowToolSlug[] = [
  "request_feedback",
  "get-markets",
  "web_research",
  "get-market-by-id",
  "get-market-price",
];

function formatAllowedTools(tools: WorkflowToolSlug[]): string {
  const selected = tools.length > 0 ? tools : ALL_TOOLS;
  return selected.map((tool) => `"${tool}"`).join(" | ");
}

export function buildModelInstruction(context?: ModelInstructionContext): string {
  const g = getBotGaurdrails();
  const guardrailLine = [
    `Guardrails: maxOrderSize=$${g.maxOrderSizeUsdc}USDC,`,
    `maxExposure=$${g.maxExposureUsdc}USDC,`,
    `price=${g.minPrice}-${g.maxPrice},`,
    `sides=${g.allowedSides.join("/")},`,
    `dryRun=${g.dryRun}.`,
  ].join(" ");

  const allowedTools = context?.allowedTools ?? ALL_TOOLS;
  const toolUnion = formatAllowedTools(allowedTools);

  const responseContract = [
    "Exact response JSON contract:",
    "{",
    '  "message": "plain-language operator update; do not repeat summary/todo verbatim",',
    '  "reasoning": "concise decision rationale based on data, guardrails, and risk, must not reveal internal workings, just rationale. Like , dont say " i will now call XX tool", say "I will do some research or i will grab some markets,',
    '  "isTradeActive": boolean,',
    '  "toolCalls": [',
    "    {",
    `      "tool": ${toolUnion},`,
    '      "reason": "why this data is needed before deciding",',
    '      "metadata": { ...tool-specific fields... }',
    "    }",
    "  ],",
    '  "nextStage": {',
    '    "summary": "short persistent summary of this stage",',
    '    "todo": "concrete next thing to do on the following wake/model turn",',
    '    "stageAction": "START_TRADE" | "END_TRADE" | "WAIT" | "SKIP" | "CLARIFY" | null,',
    '    "stageActionData": "payload for stageAction, or null when stageAction is null"',
    "  }",
    "}",
    "When nextStage.stageAction is null, nextStage.stageActionData MUST be null.",
    "When nextStage.stageAction is non-null, nextStage.stageActionData MUST match the action fields:",
    'START_TRADE: {"reason": string, "resumeAt": ISO datetime, "order": {"tokenId": string, "side": "BUY"|"SELL", "price": number, "shareSize": number, "orderType": "GTC"|"GTD", "postOnly": boolean, "expiration"?: unixSeconds}}',
    'END_TRADE: {"reason": string}',
    'WAIT: {"reason": string, "resumeAt": ISO datetime}',
    'SKIP: {"reason": string}',
    'CLARIFY: {"reason": string, "userMessageHtml": string, "resumeAt": ISO datetime}',
    "Do not return keys such as session_state, current_stage, action, or next_wake_time.",
    "Do not provide the message field and the resoning field in details for hackers to use, make sure its friendly and brief."
  ].join(" ");

  const phaseLine = context
    ? `Current workflow phase: ${context.phase}. Only use tools allowed in this phase.`
    : "Follow the phased workflow in the session prompt.";

  const approveLine =
    context?.phase === "APPROVE"
      ? "In APPROVE, use only the final chosen market, deterministic scoring summary, price data, and detailed Tavily background provided in the session prompt. Ask for approval with request_feedback."
      : null;

  return [
    "You are the autonomous trading reasoner.",
    "Return only JSON that matches the provided schema.",
    "Do not wrap output in markdown.",
    phaseLine,
    approveLine,
    "Use toolCalls only for decision-support data gathering allowed in the current phase.",
    "Phased pipeline:",
    "- DISCOVER: get-markets for active markets only",
    "- SHORTLIST: request_feedback multi_select with 10 options",
    "- RESEARCH: web_research on every operator-selected market",
    "- DECIDE: handled by deterministic scoring and operator final selection",
    "- BACKGROUND: detailed web_research + get-market-by-id for the final pick",
    "- PRICE: get-market-price",
    "- APPROVE: present the final breakdown and call request_feedback",
    "- EXECUTE: START_TRADE only after operator approval",
    "Never START_TRADE before phase EXECUTE.",
    "If more information is needed, keep nextStage.stageAction null and use toolCalls.",
    "For START_TRADE, shareSize is outcome shares/contracts, not USDC. Estimated BUY spend is price * shareSize and must fit guardrails.",
    "Use orderType=GTC unless there is a concrete expiration reason; use GTD only with expiration.",
    "Keep message, reasoning, nextStage.summary, and nextStage.todo distinct; do not copy the same sentence into multiple fields.",
    responseContract,
    guardrailLine,
  ].join(" ");
}
