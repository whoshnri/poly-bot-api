import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import {
  createNewTask,
  deleteSession,
  getAllStages,
  listSessions,
} from "../../db/db";
import {
  applyRuntimeBotConfigForUser,
  assertUserCanRunBot,
} from "../../db/users";
import { compileTradingGraph } from "../../graph";
import {
  clearPendingFeedback,
  formatFeedbackAnswer,
  getPendingFeedback,
} from "../../session/feedback";
import { getSessionResumeState } from "../../session/resumeLogic";
import { isChatVisibleEvent, publishRunError, publishSessionEvent, subscribeSessionEvents, getSessionEventsHistory } from "../../session/events";
import { initializeSessionWorkflow } from "../../session/workflow";
import { jsonFail, jsonOk } from "../../shared/apiResponse";
import { buildSessionName } from "../../shared/sessionLabel";
import { debugError, logInfo } from "../../shared/log";
import { assertOwned } from "./settings";

export async function getSessions(c: Context) {
  const userId = c.get("userId");
  try {
    const sessions = await listSessions(userId);
    return jsonOk(c, { sessions });
  } catch (error) {
    return jsonFail(
      c,
      "Failed to load sessions.",
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function startSession(c: Context) {
  const userId = c.get("userId");
  const body = (await c.req.json()) as { instruction?: string };
  const instruction = body.instruction?.trim() || "Start active market discovery.";

  await applyRuntimeBotConfigForUser(userId);

  try {
    await assertUserCanRunBot(userId);
  } catch (error) {
    return jsonFail(
      c,
      error instanceof Error ? error.message : "Account is not ready to run the bot.",
      412,
    );
  }

  const createdAt = new Date();
  const session = await createNewTask({
    name: buildSessionName(createdAt),
    metadata: { targetToken: null, instruction },
    userId,
  });

  await initializeSessionWorkflow(session.id, instruction);

  publishSessionEvent({
    id: randomUUID(),
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    kind: "chat-message",
    payload: { role: "user", content: instruction },
  });

  logInfo("session-start", "Starting session from instruction", {
    sessionId: session.id,
    userId,
    instructionLength: instruction.length,
  });

  const { invoke } = compileTradingGraph({
    sessionId: session.id,
    userId,
    userInstruction: instruction,
    forceInitPath: true,
    onEvent: publishSessionEvent,
  });
  invoke()
    .then((result) => {
      logInfo("session-start", "Initial graph run completed", {
        sessionId: session.id,
        userId,
        stopReason: result.stopReason,
        stageActionComplete: result.stageActionComplete,
      });
    })
    .catch((err: unknown) => {
      publishRunError(session.id, err, "Session start");
      debugError("session-start", "Initial graph run failed", {
        sessionId: session.id,
        userId,
      }, err);
    });

  return jsonOk(
    c,
    {
      sessionId: session.id,
      name: session.name,
      createdAt: session.createdAt.toISOString(),
      message: "Session started from your instruction.",
    },
    201,
  );
}

export async function submitFeedback(c: Context) {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return jsonFail(c, "Missing sessionId path parameter.", 400);
  }

  if (!(await assertOwned(sessionId, userId))) {
    return jsonFail(c, "Session not found.", 404);
  }

  const pending = await getPendingFeedback(sessionId);
  if (!pending) {
    return jsonFail(c, "No pending feedback request for this session.", 409);
  }

  const body = (await c.req.json()) as {
    selectedOption?: string;
    selectedOptions?: string[];
    customText?: string;
    textAnswer?: string;
  };

  let formattedAnswer: string;
  try {
    formattedAnswer = formatFeedbackAnswer(pending, body);
  } catch (error) {
    return jsonFail(
      c,
      error instanceof Error ? error.message : "Invalid feedback answer.",
      400,
    );
  }

  await clearPendingFeedback(sessionId);

  publishSessionEvent({
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    kind: "feedback-answer",
    payload: {
      requestId: pending.requestId,
      formattedAnswer,
      type: pending.type,
    },
  });

  publishSessionEvent({
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    kind: "chat-message",
    payload: { role: "user", content: formattedAnswer },
  });

  await applyRuntimeBotConfigForUser(userId);

  try {
    await assertUserCanRunBot(userId);
  } catch (error) {
    return jsonFail(
      c,
      error instanceof Error ? error.message : "Account is not ready to run the bot.",
      412,
    );
  }

  const { invoke } = compileTradingGraph({
    sessionId,
    userId,
    feedbackContinuation: {
      requestId: pending.requestId,
      formattedAnswer,
      answer: {
        selectedOption: body.selectedOption,
        selectedOptions: body.selectedOptions,
        customText: body.customText,
        textAnswer: body.textAnswer,
      },
    },
    onEvent: publishSessionEvent,
  });

  invoke()
    .then((result) => {
      logInfo("session-feedback", "Graph resumed after feedback", {
        sessionId,
        userId,
        stopReason: result.stopReason,
      });
    })
    .catch((err: unknown) => {
      publishRunError(sessionId, err, "Feedback resume");
      debugError("session-feedback", "Graph resume failed after feedback", {
        sessionId,
        userId,
      }, err);
    });

  return jsonOk(c, {
    sessionId,
    formattedAnswer,
    message: "Feedback submitted. Bot is continuing.",
  });
}

export async function getPendingFeedbackRoute(c: Context) {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return jsonFail(c, "Missing sessionId path parameter.", 400);
  }

  if (!(await assertOwned(sessionId, userId))) {
    return jsonFail(c, "Session not found.", 404);
  }

  const pending = await getPendingFeedback(sessionId);
  return jsonOk(c, { pending });
}

export async function getSessionResumeStatus(c: Context) {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return jsonFail(c, "Missing sessionId path parameter.", 400);
  }

  if (!(await assertOwned(sessionId, userId))) {
    return jsonFail(c, "Session not found.", 404);
  }

  const resume = await getSessionResumeState(sessionId);
  return jsonOk(c, { resume });
}

export async function resumeSession(c: Context) {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return jsonFail(c, "Missing sessionId path parameter.", 400);
  }

  if (!(await assertOwned(sessionId, userId))) {
    return jsonFail(c, "Session not found.", 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as { instruction?: string };
  const instruction = body.instruction?.trim();

  await applyRuntimeBotConfigForUser(userId);

  try {
    await assertUserCanRunBot(userId);
  } catch (error) {
    return jsonFail(
      c,
      error instanceof Error ? error.message : "Account is not ready to run the bot.",
      412,
    );
  }

  if (instruction) {
    await initializeSessionWorkflow(sessionId, instruction);

    publishSessionEvent({
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      kind: "chat-message",
      payload: { role: "user", content: instruction },
    });

    const { invoke } = compileTradingGraph({
      sessionId,
      userId,
      userInstruction: instruction,
      forceInitPath: true,
      onEvent: publishSessionEvent,
    });
    invoke()
      .then((result) => {
        logInfo("session-resume", "Graph run completed after new instruction", {
          sessionId,
          userId,
          stopReason: result.stopReason,
        });
      })
      .catch((err: unknown) => {
        publishRunError(sessionId, err, "Session resume");
        debugError("session-resume", "Graph run failed after new instruction", {
          sessionId,
          userId,
        }, err);
      });

    return jsonOk(c, {
      sessionId,
      message: "Session restarted from your new instruction.",
    });
  }

  const resume = await getSessionResumeState(sessionId);
  if (resume.mode === "awaiting_feedback") {
    return jsonOk(c, {
      sessionId,
      message: resume.message,
      resume,
    });
  }

  if (!resume.canContinue) {
    return jsonFail(c, resume.message, 409);
  }

  publishSessionEvent({
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    kind: "chat-message",
    payload: {
      role: "bot",
      content: resume.message,
      subtitle: `Resuming ${resume.phase} phase`,
    },
  });

  const { invoke } = compileTradingGraph({
    sessionId,
    userId,
    onEvent: publishSessionEvent,
  });
  invoke()
    .then((result) => {
      logInfo("session-resume", "Graph run completed", {
        sessionId,
        userId,
        stopReason: result.stopReason,
      });
    })
    .catch((err: unknown) => {
      publishRunError(sessionId, err, "Session resume");
      debugError("session-resume", "Graph run failed", {
        sessionId,
        userId,
      }, err);
    });

  return jsonOk(c, {
    sessionId,
    message: resume.message,
    resume,
  });
}

export async function removeSession(c: Context) {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return jsonFail(c, "Missing sessionId path parameter.", 400);
  }

  try {
    await deleteSession(sessionId, userId);
    return jsonOk(c, {
      sessionId,
      deleted: true,
    });
  } catch (error) {
    return jsonFail(
      c,
      "Failed to delete session.",
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function streamSessionEvents(c: Context) {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return jsonFail(c, "Missing sessionId path parameter.", 400);
  }

  if (!(await assertOwned(sessionId, userId))) {
    return jsonFail(c, "Session not found.", 404);
  }

  const encoder = new TextEncoder();
  const persistedStages = await getAllStages(sessionId);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let pingInterval: ReturnType<typeof setInterval> | null = null;

      const writeEvent = (payload: unknown): void => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const close = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        if (unsubscribe) {
          unsubscribe();
        }
        controller.close();
      };

      const historyEvents = getSessionEventsHistory(sessionId);
      const visibleHistoryCount = historyEvents.filter((event) => isChatVisibleEvent(event.kind)).length;

      logInfo("sse", "Client connected to session event stream", {
        sessionId,
        userId,
        persistedStageCount: persistedStages.length,
        historyEventCount: historyEvents.length,
        visibleHistoryCount,
      });

      for (const stage of persistedStages) {
        writeEvent({
          id: `persisted-stage-${stage.id}`,
          sessionId,
          timestamp: stage.createdAt.toISOString(),
          kind: "chat-message",
          payload: {
            role: "bot",
            content: stage.summary,
            subtitle: stage.todo,
          },
        });
      }

      for (const event of historyEvents) {
        if (isChatVisibleEvent(event.kind)) {
          writeEvent(event);
        }
      }

      unsubscribe = subscribeSessionEvents(sessionId, (event) => {
        if (isChatVisibleEvent(event.kind)) {
          writeEvent(event);
        }
      });
      pingInterval = setInterval(() => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 5000);

      c.req.raw.signal.addEventListener("abort", () => {
        logInfo("sse", "Client disconnected from session event stream", {
          sessionId,
          userId,
        });
        close();
      }, { once: true });
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
