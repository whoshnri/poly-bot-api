import prisma from "../db/prisma";
import {
  canStartTrade,
  researchRetryRequiredMessage,
  MAX_RESEARCH_ATTEMPTS,
  type ResearchGateState,
} from "./researchGateLogic";

export {
  canStartTrade,
  researchRetryRequiredMessage,
  MAX_RESEARCH_ATTEMPTS,
  type ResearchGateState,
};

const defaultGate = (): ResearchGateState => ({
  researchAttempts: 0,
  researchSucceeded: false,
  userConsultedAfterResearchFailure: false,
  researchComplete: false,
});

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readGate(metadata: unknown): ResearchGateState {
  if (!metadata || typeof metadata !== "object") {
    return defaultGate();
  }

  const raw = metadata as Record<string, unknown>;
  const gate = raw.researchGate;
  if (!gate || typeof gate !== "object") {
    return defaultGate();
  }

  const value = gate as Record<string, unknown>;
  const researchAttempts =
    readNumber(value.researchAttempts) ?? readNumber(value.jinaAttempts) ?? 0;
  const researchSucceeded =
    value.researchSucceeded === true || value.jinaSucceeded === true;
  const userConsultedAfterResearchFailure =
    value.userConsultedAfterResearchFailure === true ||
    value.userConsultedAfterJinaFailure === true;

  return {
    researchAttempts,
    researchSucceeded,
    userConsultedAfterResearchFailure,
    researchComplete: value.researchComplete === true,
  };
}

export async function getResearchGate(sessionId: string): Promise<ResearchGateState> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  return readGate(session?.metadata ?? null);
}

async function persistResearchGate(
  sessionId: string,
  updater: (current: ResearchGateState) => ResearchGateState,
): Promise<ResearchGateState> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const metadata =
    session.metadata && typeof session.metadata === "object"
      ? (session.metadata as Record<string, unknown>)
      : {};

  const nextGate = updater(readGate(metadata));
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      metadata: {
        ...metadata,
        researchGate: nextGate,
      },
    },
  });

  return nextGate;
}

export async function recordResearchFailure(sessionId: string): Promise<ResearchGateState> {
  return persistResearchGate(sessionId, (current) => ({
    ...current,
    researchAttempts: current.researchAttempts + 1,
  }));
}

export async function recordResearchSuccess(sessionId: string): Promise<ResearchGateState> {
  return persistResearchGate(sessionId, (current) => ({
    ...current,
    researchSucceeded: true,
    researchComplete: true,
  }));
}

export async function recordUserConsultedAfterResearchFailure(
  sessionId: string,
): Promise<ResearchGateState> {
  return persistResearchGate(sessionId, (current) => ({
    ...current,
    userConsultedAfterResearchFailure: true,
    researchComplete: true,
  }));
}
