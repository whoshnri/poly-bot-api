import prisma from "../db/prisma";
import { enrichWorkflowTradeTokens } from "./marketTokens";
import {
  defaultWorkflowState,
  readWorkflowState,
  workflowFromPreSession,
  type PreSessionInput,
  type SessionWorkflowState,
} from "./workflowLogic";

export {
  ensureChosenTokenId,
  enrichWorkflowTradeTokens,
  MissingTradeTokenIdError,
  primaryTokenIdFromCandidate,
  requireTradeTokenId,
  resolveTokenIdForMarket,
} from "./marketTokens";

export {
  allowedToolsForPhase,
  canExecuteTrade,
  defaultWorkflowState,
  isToolAllowedInPhase,
  mergeShortlist,
  MAX_SHORTLIST,
  readWorkflowState,
  resolveApprovalFeedback,
  shortlistResearchComplete,
  trimShortlist,
  applyFeedbackToWorkflow,
  type ChosenMarket,
  type MarketCandidate,
  type OperatorDecision,
  type PendingOrder,
  type SessionPhase,
  type SessionWorkflowState,
  type UserSpec,
  type WorkflowToolSlug,
} from "./workflowLogic";

function readMetadataRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return metadata as Record<string, unknown>;
}

export async function getSessionWorkflow(sessionId: string): Promise<SessionWorkflowState> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  return readWorkflowState(session?.metadata ?? null);
}

export async function updateSessionWorkflow(
  sessionId: string,
  updater: (current: SessionWorkflowState) => SessionWorkflowState,
): Promise<SessionWorkflowState> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const metadata = readMetadataRecord(session.metadata);
  const nextWorkflow = updater(readWorkflowState(metadata));

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      metadata: {
        ...metadata,
        workflow: nextWorkflow,
      },
    },
  });

  return nextWorkflow;
}

export async function initializeSessionWorkflow(
  sessionId: string,
  instruction?: string,
  preSession?: PreSessionInput,
): Promise<SessionWorkflowState> {
  if (preSession) {
    const initial = workflowFromPreSession(preSession);
    const enriched = await enrichWorkflowTradeTokens(initial);
    return updateSessionWorkflow(sessionId, () => enriched);
  }

  return updateSessionWorkflow(sessionId, () => defaultWorkflowState(instruction));
}
