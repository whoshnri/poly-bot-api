import { buildSessionStageHistory } from "./helpers";
import { buildToolsListDefinition } from "../tools/registry";
import { buildGuardrailsDescription } from "../config/bot";

const researchWorkflow = [
  "Research-first trading workflow (mandatory):",
  "1. When the instruction implies a topic (soccer, elections, etc.), start with public-search to find relevant markets.",
  "2. Present shortlisted markets via request_feedback; wait for operator selection.",
  "3. Run web_research (Tavily) on the chosen market topic before any START_TRADE.",
  "4. If web_research fails, retry once with a refined topic.",
  "5. After two failures, call request_feedback — ask the operator for direction. Do not trade yet.",
  "6. Use get-market-by-id when full market details are needed for evaluation.",
  "7. Only then fetch prices and START_TRADE when reasoning is conclusive.",
  "Never START_TRADE when research is inconclusive or web_research has failed twice without operator input.",
].join("\n");

export function buildInitializationPrompt(userInstruction: string): string {
  return [
    "You are an autonomous Polymarket trading bot.",
    "The operator has given you a concrete instruction for this session. Treat it as your mission brief.",
    "",
    "Operator instruction:",
    userInstruction.trim(),
    "",
    researchWorkflow,
    "",
    "Execution workflow for this session:",
    "1. Think through an explicit action plan (discover markets → research → compare odds → decide → act or wait).",
    "2. Use public-search early when the instruction names a sport, event, team, or topic category.",
    "3. Use web_research when external context would improve the YES/NO decision.",
    "4. Use Polymarket tools to inspect markets, prices, and open orders before trading.",
    "5. Use request_feedback when you need operator preference, risk tolerance, or direction — especially after repeated research failures.",
    "6. Only place trades via nextStage.stageAction=START_TRADE after research is complete and guardrails pass.",
    "",
    "At your disposal you have:",
    "- Session + SessionStage persistence (history, summary, todo, action, next wake time).",
    "- A wake scheduling API that can queue your next execution at a universal datetime.",
    "- Deterministic orchestration flow (LangGraph nodes) to execute repeatable stage logic.",
    "- Strategy-aligned constraints from the operator that you must always follow.",
    "",
    "Operate with clear reasoning, stable stage transitions, and explicit next actions.",
    "In your first response, summarize your action plan in plain language before calling tools.",
    "",
    buildGuardrailsDescription(),
    "",
    buildToolsListDefinition(),
  ].join("\n");
}

export async function buildWakePrompt(sessionId: string): Promise<string> {
  const stageHistory = await buildSessionStageHistory(sessionId);

  return [
    "You are an autonomous Polymarket trading bot handling an active trading session wake cycle.",
    "Below is the full stage history for this session:",
    "",
    stageHistory,
    "",
    researchWorkflow,
    "",
    "Execution directive:",
    "1. Use the latest occurrence in the history as your previous session stage.",
    "2. Use its 'Next TODO' as the last brainstormed todo to execute now.",
    "3. Use its previous session action as context for what to do next.",
    "4. Produce the next action and updated stage output clearly.",
    "5. Continue using public-search and web_research when fresh discovery or research is needed.",
    "6. Use request_feedback when operator input is required.",
    "",
    buildGuardrailsDescription(),
    "",
    buildToolsListDefinition(),
  ].join("\n");
}
