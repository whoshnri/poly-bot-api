import type { WorkflowToolSlug } from "../session/workflowLogic";
import { MODEL_TOOL_SLUGS } from "./modelSchemas";

export const modelToolDescriptions: Record<WorkflowToolSlug, string> = {
  "get-markets":
    "Fetch active Polymarket markets directly. metadata: { limit?: number, order?: string, ascending?: boolean, closed?: boolean }.",
  "web_research":
    "Research the chosen market via Tavily (search + crawl). metadata: { topic: string } only — search/crawl params are server-side.",
  "get-market-by-id":
    "Fetch full Gamma market details for evaluation. metadata: { marketId: string }.",
  "get-market-price":
    'Fetch executable CLOB price (Gamma fallback). metadata: { tokenId: string, side: "BUY" | "SELL" }.',
  "request_feedback":
    "Pause for operator input. metadata: { type: mcq | text | mcq_or_custom | multi_select, question, options?, minSelections?, maxSelections? }.",
};

export function buildModelToolsDefinition(tools: WorkflowToolSlug[]): string {
  const lines = tools.map((tool) => `- ${tool}: ${modelToolDescriptions[tool]}`);
  return [
    "Tools available in the CURRENT phase (only these may appear in toolCalls):",
    ...lines,
    "There is no create-order tool. After operator approval, set nextStage.stageAction=START_TRADE with stageActionData.order.",
  ].join("\n");
}

/** Full catalog of model-callable tools (all phases). */
export function buildToolsListDefinition(): string {
  return buildModelToolsDefinition([...MODEL_TOOL_SLUGS]);
}
