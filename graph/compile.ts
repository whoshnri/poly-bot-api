import type { CompileTradingGraphParams } from "../types/graph";
import { compileAiGraph } from "./compileAiGraph";
import { runSession } from "./orchestrator/runSession";

export function compileTradingGraph(params: CompileTradingGraphParams = {}) {
  const aiGraph = compileAiGraph();

  return {
    graph: aiGraph.graph,
    invoke: () => runSession(params),
  };
}
