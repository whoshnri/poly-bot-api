import { createNewStage, createNewTask, SessionAction } from "../db/db";
import { buildSessionName } from "../shared/sessionLabel";
import type { AiModelResponse } from "../types/schemas";

function getDefaultWakeTime(): string {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function toPersistedSessionAction(
  stageAction: AiModelResponse["nextStage"]["stageAction"],
): SessionAction {
  switch (stageAction) {
    case "START_TRADE":
      return SessionAction.START_TRADE;
    case "END_TRADE":
      return SessionAction.END_TRADE;
    case "SKIP":
      return SessionAction.SKIP;
    case "WAIT":
    case "CLARIFY":
    case null:
      return SessionAction.WAIT;
    default: {
      const unsupported = stageAction satisfies never;
      throw new Error(`Unsupported stage action: ${unsupported}`);
    }
  }
}

function getResumeAt(aiResponse: AiModelResponse): string | null {
  const action = aiResponse.nextStage.stageAction;
  const actionData = aiResponse.nextStage.stageActionData;

  if (!action || !actionData || typeof actionData !== "object") {
    return null;
  }

  if (action === "START_TRADE" || action === "WAIT" || action === "CLARIFY") {
    if ("resumeAt" in actionData && typeof actionData.resumeAt === "string") {
      return actionData.resumeAt;
    }
  }

  return null;
}

function shouldScheduleWake(aiResponse: AiModelResponse): boolean {
  const action = aiResponse.nextStage.stageAction;
  return action === "START_TRADE" || action === "WAIT" || action === "CLARIFY";
}

export async function ensureSessionId(sessionId: string | null, userId: string | null): Promise<string> {
  if (sessionId) {
    return sessionId;
  }

  if (!userId) {
    throw new Error("Cannot create a session without an authenticated user.");
  }

  const createdSession = await createNewTask({
    name: buildSessionName(),
    metadata: { targetToken: null },
    userId,
  });

  return createdSession.id;
}

export async function persistAiStage(
  sessionId: string,
  aiResponse: AiModelResponse,
): Promise<void> {
  const nextWake = getResumeAt(aiResponse) ?? getDefaultWakeTime();
  await createNewStage(sessionId, {
    summary: aiResponse.nextStage.summary,
    todo: aiResponse.nextStage.todo,
    sessionAction: toPersistedSessionAction(aiResponse.nextStage.stageAction),
    stageActionCompleted: false,
    nextWake,
    scheduleWake: shouldScheduleWake(aiResponse),
  });
}
