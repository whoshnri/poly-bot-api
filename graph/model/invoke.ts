import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { aiModelResponseSchema } from "../../tools/schemas";
import type { AiGraphMessage } from "../../types/graph";
import type { AiModelResponse } from "../../types/schemas";
import { debugError, logInfo, logWarn } from "../../shared/log";
import { isNonUserFacingError } from "../../shared/errorPresentation";
import {
  buildModelInstruction,
  type ModelInstructionContext,
} from "./instruction";
import {
  buildRecoveryPayload,
  normalizeModelPayload,
  safeParseModelJson,
} from "./normalize";
import type { RecoveryContext } from "./recoveryContext";
import { formatConversation } from "../messages";
import { getUserAiConfig } from "./getUserConfig";
import { createChatModel } from "./providers";
import { ensureActionableModelResponse } from "./phaseExecution";

function modelContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return String(content ?? "");
}

async function invokeModelWithJsonContract(
  model: BaseChatModel,
  messages: [SystemMessage, HumanMessage],
  recoveryContext?: RecoveryContext,
): Promise<unknown> {
  const response = await model.invoke(messages);
  const rawText = modelContentToText(response.content);
  return safeParseModelJson(rawText, recoveryContext);
}

export async function invokeUniversalModel(
  messages: AiGraphMessage[],
  instructionContext: ModelInstructionContext | undefined,
  recoveryContext: RecoveryContext | undefined,
  loginUserId: string,
): Promise<AiModelResponse> {
  const aiConfig = await getUserAiConfig(loginUserId);
  if (!aiConfig) {
    throw new Error("AI provider and API key must be configured before running the bot.");
  }

  const model = createChatModel({
    provider: aiConfig.provider,
    apiKey: aiConfig.apiKey,
  });

  const llmMessages: [SystemMessage, HumanMessage] = [
    new SystemMessage(buildModelInstruction(instructionContext)),
    new HumanMessage(formatConversation(messages)),
  ];

  let response: unknown;
  try {
    response = await invokeModelWithJsonContract(model, llmMessages, recoveryContext);
  } catch (error) {
    if (isNonUserFacingError(error)) {
      logWarn("graph.model", "Model provider limit hit; continuing with phase fallback", {
        phase: instructionContext?.phase ?? null,
        provider: aiConfig.provider,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response = buildRecoveryPayload({}, recoveryContext);
    } else {
      throw error;
    }
  }

  const normalized = normalizeModelPayload(response ?? {}, recoveryContext);
  const validated = aiModelResponseSchema.safeParse(normalized);
  if (validated.success) {
    const actionable = ensureActionableModelResponse(
      validated.data,
      recoveryContext,
    );
    logInfo("graph.model", "Model response validated", {
      toolCallCount: actionable.toolCalls.length,
      stageAction: actionable.nextStage.stageAction,
      phase: instructionContext?.phase ?? null,
      provider: aiConfig.provider,
      injectedFallback:
        actionable.toolCalls.length > validated.data.toolCalls.length ||
        (validated.data.toolCalls.length === 0 && actionable.toolCalls.length > 0),
    });
    return actionable;
  }

  logWarn(
    "graph.model",
    "Model response failed schema validation; attempting recovery",
    {
      issueCount: validated.error.issues.length,
      firstIssue: validated.error.issues[0]?.message,
      phase: instructionContext?.phase ?? null,
      provider: aiConfig.provider,
    },
  );

  const recovered = buildRecoveryPayload(normalized, recoveryContext);
  const recoveredValidated = aiModelResponseSchema.safeParse(recovered);
  if (recoveredValidated.success) {
    logWarn("graph.model", "Recovered model response from partial payload", {
      toolCallCount: recoveredValidated.data.toolCalls.length,
      stageAction: recoveredValidated.data.nextStage.stageAction,
      phase: instructionContext?.phase ?? null,
      provider: aiConfig.provider,
    });
    return recoveredValidated.data;
  }

  const fallback = buildRecoveryPayload({}, recoveryContext);
  const fallbackValidated = aiModelResponseSchema.safeParse(fallback);
  if (fallbackValidated.success) {
    logWarn(
      "graph.model",
      "Using phase fallback model response after validation failure",
      {
        toolCallCount: fallbackValidated.data.toolCalls.length,
        phase: instructionContext?.phase ?? null,
        provider: aiConfig.provider,
        fallbackTool: fallbackValidated.data.toolCalls[0]?.tool ?? null,
      },
    );
    return fallbackValidated.data;
  }

  debugError(
    "graph.model",
    "Model response could not be validated or recovered",
    {},
    validated.error,
  );
  throw validated.error;
}
