export const MAX_OPERATION_FAILURES = 6;
export const MAX_GRAPH_TURNS = 25;

const parsedRecursionLimit = Number(process.env.GRAPH_RECURSION_LIMIT ?? "150");
export const DEFAULT_GRAPH_RECURSION_LIMIT =
  Number.isFinite(parsedRecursionLimit) && parsedRecursionLimit > 0
    ? Math.floor(parsedRecursionLimit)
    : 150;

export class GraphTurnLimitError extends Error {
  readonly turnCount: number;

  constructor(turnCount: number) {
    super(`Graph turn limit reached (${turnCount}/${MAX_GRAPH_TURNS}). Aborting this run.`);
    this.name = "GraphTurnLimitError";
    this.turnCount = turnCount;
  }
}

export function shouldStopGraphTurns(turnCount: number): boolean {
  return turnCount >= MAX_GRAPH_TURNS;
}
