import { MODEL_TOOL_SLUGS } from "../../tools/modelSchemas";
import { buildPhaseFallbackTool, type RecoveryContext } from "./recoveryContext";

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeToolMetadata(rawMetadata: unknown): Record<string, unknown> {
  if (typeof rawMetadata === "string") {
    try {
      const parsed = JSON.parse(rawMetadata) as unknown;
      return toRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }

  return toRecord(rawMetadata) ?? {};
}

function normalizeToolName(rawTool: unknown): string {
  if (typeof rawTool !== "string") {
    return "";
  }

  const tool = rawTool.trim();
  const normalized = tool.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized === "web-research") {
    return "web_research";
  }
  if (normalized === "request-feedback" || normalized === "request_feedback") {
    return "request_feedback";
  }

  return tool;
}

function completeToolCall(
  tool: string,
  reason: string,
  metadata: Record<string, unknown>,
  recoveryContext?: RecoveryContext,
): { tool: string; reason: string; metadata: Record<string, unknown> } | null {
  const query = recoveryContext?.searchQuery?.trim() || "polymarket";

  if (tool === "get-markets") {
    return {
      tool,
      reason,
      metadata: {
        limit:
          typeof metadata.limit === "number" && Number.isFinite(metadata.limit)
            ? metadata.limit
            : 10,
        order: typeof metadata.order === "string" ? metadata.order : "volume24hr",
        ascending: metadata.ascending === true,
        closed: metadata.closed === true ? true : false,
      },
    };
  }

  if (tool === "web_research") {
    return {
      tool,
      reason,
      metadata: {
        topic:
          typeof metadata.topic === "string" && metadata.topic.trim().length > 0
            ? metadata.topic
            : query,
      },
    };
  }

  if (tool === "get-market-by-id") {
    const marketId =
      typeof metadata.marketId === "string" && metadata.marketId.trim().length > 0
        ? metadata.marketId
        : recoveryContext?.shortlistMarketId;
    if (!marketId) {
      return null;
    }

    return {
      tool,
      reason,
      metadata: { marketId },
    };
  }

  if (tool === "get-market-price") {
    const tokenId =
      typeof metadata.tokenId === "string" && metadata.tokenId.trim().length > 0
        ? metadata.tokenId
        : recoveryContext?.tokenId;
    if (!tokenId) {
      return null;
    }

    return {
      tool,
      reason,
      metadata: {
        tokenId,
        side: metadata.side === "SELL" ? "SELL" : "BUY",
      },
    };
  }

  if (tool === "request_feedback") {
    const type =
      metadata.type === "mcq" ||
      metadata.type === "text" ||
      metadata.type === "mcq_or_custom" ||
      metadata.type === "multi_select"
        ? metadata.type
        : "text";
    const question =
      typeof metadata.question === "string" && metadata.question.trim().length > 0
        ? metadata.question
        : "What direction should the bot take next?";

    const options = Array.isArray(metadata.options)
      ? metadata.options.filter((entry): entry is string => typeof entry === "string")
      : undefined;

    if (type !== "text" && (!options || options.length < 2)) {
      if (recoveryContext?.phase === "APPROVE") {
        return {
          tool,
          reason,
          metadata: {
            type: "mcq",
            question,
            options: ["Yes, place order", "No, cancel"],
          },
        };
      }

      return {
        tool,
        reason,
        metadata: {
          type,
          question,
          ...(typeof metadata.minSelections === "number"
            ? { minSelections: metadata.minSelections }
            : {}),
          ...(typeof metadata.maxSelections === "number"
            ? { maxSelections: metadata.maxSelections }
            : {}),
        },
      };
    }

    return {
      tool,
      reason,
      metadata: {
        type,
        question,
        ...(options ? { options } : {}),
        ...(typeof metadata.minSelections === "number"
          ? { minSelections: metadata.minSelections }
          : {}),
        ...(typeof metadata.maxSelections === "number"
          ? { maxSelections: metadata.maxSelections }
          : {}),
      },
    };
  }

  return null;
}

function normalizeNextStage(rawNextStage: unknown): Record<string, unknown> {
  const nextStage = toRecord(rawNextStage) ?? {};
  const stageAction =
    nextStage.stageAction === "START_TRADE" ||
    nextStage.stageAction === "END_TRADE" ||
    nextStage.stageAction === "WAIT" ||
    nextStage.stageAction === "SKIP" ||
    nextStage.stageAction === "CLARIFY"
      ? nextStage.stageAction
      : null;

  return {
    summary:
      typeof nextStage.summary === "string" && nextStage.summary.trim().length > 0
        ? nextStage.summary
        : "Continuing the current workflow phase.",
    todo:
      typeof nextStage.todo === "string" && nextStage.todo.trim().length > 0
        ? nextStage.todo
        : "Use the allowed tools for this phase before selecting a terminal action.",
    stageAction,
    stageActionData: stageAction === null ? null : (nextStage.stageActionData ?? null),
  };
}

export function normalizeModelPayload(
  rawPayload: unknown,
  recoveryContext?: RecoveryContext,
): unknown {
  const root = toRecord(rawPayload);
  if (!root) {
    return rawPayload;
  }

  const allowedTools = new Set<string>(MODEL_TOOL_SLUGS);
  const rawToolCalls = Array.isArray(root.toolCalls) ? root.toolCalls : [];
  const toolCalls = rawToolCalls
    .map((toolCall) => {
      const call = toRecord(toolCall) ?? {};
      const functionRecord = toRecord(call.function);
      const tool = normalizeToolName(
        (typeof call.tool === "string" && call.tool) ||
          (typeof call.name === "string" && call.name) ||
          (typeof call.functionName === "string" && call.functionName) ||
          (typeof functionRecord?.name === "string" && functionRecord.name) ||
          "",
      );
      if (!allowedTools.has(tool)) {
        return null;
      }

      const reason =
        typeof call.reason === "string" && call.reason.length > 0
          ? call.reason
          : `Requested ${tool} for decision support.`;
      const metadata = normalizeToolMetadata(
        call.metadata ??
          call.args ??
          call.parameters ??
          call.input ??
          functionRecord?.arguments,
      );

      return completeToolCall(tool, reason, metadata, recoveryContext);
    })
    .filter((call): call is NonNullable<typeof call> => call !== null);

  return {
    message:
      typeof root.message === "string" && root.message.trim().length > 0
        ? root.message
        : "Continuing the session.",
    reasoning:
      typeof root.reasoning === "string" && root.reasoning.trim().length > 0
        ? root.reasoning
        : "Proceeding with the current workflow phase using available tool results.",
    isTradeActive: typeof root.isTradeActive === "boolean" ? root.isTradeActive : false,
    toolCalls,
    nextStage: normalizeNextStage(root.nextStage),
  };
}

export function buildRecoveryPayload(
  rawPayload: unknown,
  recoveryContext?: RecoveryContext,
): unknown {
  const normalized = normalizeModelPayload(rawPayload, recoveryContext);
  const root = toRecord(normalized) ?? {};
  const nextStage = normalizeNextStage(root.nextStage);
  const toolCalls = Array.isArray(root.toolCalls) ? root.toolCalls : [];

  const recovered: Record<string, unknown> = {
    message:
      typeof root.message === "string" && root.message.trim().length > 0
        ? root.message
        : "Model response normalized after schema mismatch.",
    reasoning:
      typeof root.reasoning === "string" && root.reasoning.trim().length > 0
        ? root.reasoning
        : "Continuing with phase-appropriate tool recovery.",
    isTradeActive:
      typeof root.isTradeActive === "boolean" ? root.isTradeActive : false,
    toolCalls,
    nextStage: {
      ...nextStage,
      stageAction: null,
      stageActionData: null,
    },
  };

  if (toolCalls.length === 0) {
    recovered.toolCalls = [buildPhaseFallbackTool(recoveryContext)];
  }

  return recovered;
}

function extractJsonPayload(rawText: string): string {
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    throw new Error("Model output did not include a JSON object.");
  }

  return rawText.slice(firstBrace, lastBrace + 1).trim();
}

export function safeParseModelJson(
  rawText: string,
  recoveryContext?: RecoveryContext,
): unknown {
  try {
    return normalizeModelPayload(JSON.parse(extractJsonPayload(rawText)) as unknown, recoveryContext);
  } catch {
    return buildRecoveryPayload(
      {
        message: "Model response could not be parsed as JSON. Continuing with a safe recovery plan.",
        reasoning:
          typeof rawText === "string" && rawText.trim().length > 0
            ? rawText.slice(0, 500)
            : "Empty or invalid model output.",
      },
      recoveryContext,
    );
  }
}
