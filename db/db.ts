import prisma from "./prisma";
import { callWakeApi } from "../shared/wakeCaller";
import { SessionAction } from "../src/generated/prisma/client";
import type { CreateNewStageInput, CreateNewTaskInput } from "../types/db";
import { getPendingFeedback } from "../session/feedback";
import { buildSessionResumeState } from "../session/resumeLogic";
import { getSessionWorkflow } from "../session/workflow";

/**
 * Creates a new session task scoped to a user.
 */
export async function createNewTask(input: CreateNewTaskInput) {
  return prisma.session.create({
    data: {
      name: input.name,
      pages: input.pages,
      metadata: input.metadata,
      userId: input.userId,
    },
  });
}

/**
 * Returns persisted sessions for one user with their latest stage summary.
 */
export async function listSessions(userId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      stages: {
        orderBy: { sequence: "desc" },
        take: 1,
      },
    },
  });

  return Promise.all(
    sessions.map(async (session) => {
      const [latestStage] = session.stages;
      const [workflow, pending] = await Promise.all([
        getSessionWorkflow(session.id),
        getPendingFeedback(session.id),
      ]);
      const resume = buildSessionResumeState(workflow, pending);

      return {
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        resume,
        latestStage: latestStage
          ? {
              id: latestStage.id,
              sequence: latestStage.sequence,
              summary: latestStage.summary,
              todo: latestStage.todo,
              sessionAction: latestStage.sessionAction,
              stageActionCompleted: latestStage.stageActionCompleted,
              nextWake: latestStage.nextWake,
              createdAt: latestStage.createdAt,
            }
          : null,
      };
    }),
  );
}

/**
 * Deletes a persisted session owned by the user.
 */
export async function deleteSession(sessionId: string, userId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  return prisma.session.delete({
    where: { id: sessionId },
  });
}

/**
 * Creates the next stage for a session and schedules its wake call.
 */
export async function createNewStage(sessionId: string, input: CreateNewStageInput) {
  const latestStage = await getLatestStage(sessionId);
  const nextWake = input.nextWake instanceof Date ? input.nextWake : new Date(input.nextWake);

  if (!Number.isFinite(nextWake.getTime())) {
    throw new Error("Invalid nextWake datetime.");
  }

  const createdStage = await prisma.sessionStage.create({
    data: {
      sessionId,
      sequence: input.sequence ?? (latestStage?.sequence ?? 0) + 1,
      summary: input.summary,
      todo: input.todo,
      sessionAction: input.sessionAction,
      stageActionCompleted: input.stageActionCompleted ?? false,
      nextWake,
      prevStageId: input.prevStageId ?? latestStage?.id ?? null,
    },
  });

  if (input.scheduleWake ?? true) {
    await callWakeApi(createdStage.nextWake, sessionId);
  }

  return createdStage;
}

export async function markLatestStageActionCompleted(
  sessionId: string,
  completed: boolean,
) {
  const latestStage = await getLatestStage(sessionId);
  if (!latestStage) {
    throw new Error(`No stage found for session: ${sessionId}`);
  }

  return prisma.sessionStage.update({
    where: { id: latestStage.id },
    data: { stageActionCompleted: completed },
  });
}

/**
 * Returns all session stages in ascending sequence order.
 */
export async function getAllStages(taskId: string) {
  return prisma.sessionStage.findMany({
    where: { sessionId: taskId },
    orderBy: { sequence: "asc" },
  });
}

/**
 * Returns the latest session stage by sequence.
 */
export async function getLatestStage(sessionId: string) {
  return prisma.sessionStage.findFirst({
    where: { sessionId },
    orderBy: { sequence: "desc" },
  });
}

export { SessionAction };
