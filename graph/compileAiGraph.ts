import { START, StateGraph } from "@langchain/langgraph";
import { tradingGraphState } from "./state";
import {
  routeAfterFeedbackContinuationNode,
  routeAfterModelNode,
  routeAfterPromptNode,
  routeAfterStageActionNode,
  routeAfterToolCallsNode,
  routeInitialPromptNode,
} from "./aiRouting";
import {
  loadFeedbackContinuationNode,
  loadInitializationPromptNode,
  loadWakePromptNode,
} from "./nodes/prompts";
import { runModelNode } from "./nodes/model";
import { runToolCallsNode } from "./nodes/tools";
import { runStageActionNode } from "./nodes/stageAction";
import type { CompileTradingGraphParams } from "../types/graph";
import { DEFAULT_GRAPH_RECURSION_LIMIT } from "../shared/limits";
import { ensureSessionId } from "./persist";

export function compileAiGraph() {
  const graphBuilder = new StateGraph(tradingGraphState)
    .addNode("load-wake-prompt", loadWakePromptNode)
    .addNode("load-init-prompt", loadInitializationPromptNode)
    .addNode("load-feedback-continuation", loadFeedbackContinuationNode)
    .addNode("run-model", runModelNode)
    .addNode("run-tool-calls", runToolCallsNode)
    .addNode("run-stage-action", runStageActionNode)
    .addConditionalEdges(START, routeInitialPromptNode)
    .addConditionalEdges("load-wake-prompt", routeAfterPromptNode)
    .addConditionalEdges("load-init-prompt", routeAfterPromptNode)
    .addConditionalEdges("load-feedback-continuation", routeAfterFeedbackContinuationNode)
    .addConditionalEdges("run-model", routeAfterModelNode)
    .addConditionalEdges("run-tool-calls", routeAfterToolCallsNode)
    .addConditionalEdges("run-stage-action", routeAfterStageActionNode);

  const graph = graphBuilder.compile({
    name: "polymarket-ai-graph",
  });

  return {
    graph,
    invoke: async (params: CompileTradingGraphParams & { wakeTraceId: string }) => {
      const sessionId = await ensureSessionId(params.sessionId ?? null, params.userId ?? null);

      return graph.invoke(
        {
          sessionId,
          userId: params.userId ?? null,
          wakeTraceId: params.wakeTraceId,
          forceInitPath: params.forceInitPath ?? false,
          userInstruction: params.userInstruction ?? "",
          feedbackContinuation: params.feedbackContinuation ?? null,
          onEvent: params.onEvent ?? null,
        },
        { recursionLimit: DEFAULT_GRAPH_RECURSION_LIMIT },
      );
    },
  };
}
