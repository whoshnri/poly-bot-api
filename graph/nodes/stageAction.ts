import { OrderType, Side } from "@polymarket/clob-client-v2";
import { randomUUID } from "node:crypto";
import { markLatestStageActionCompleted } from "../../db/db";
import { botConfig } from "../../config/bot";
import {
  acquireStageLock,
  clearSessionOrderId,
  getSessionOrderId,
  releaseStageLock,
  setSessionOrderId,
} from "../../shared/helpers";
import { startHeartbeat, stopHeartbeat } from "../../shared/heartbeat";
import {
  CircuitBreakerError,
  shouldTripCircuitBreaker,
} from "../../shared/circuitBreaker";
import { debugLog } from "../../shared/log";
import { canStartTrade, getResearchGate } from "../../session/researchGate";
import { canExecuteTrade, getSessionWorkflow } from "../../session/workflow";
import { getOpenOrders, initPolymarketClient } from "../../polymarket";
import type { TradingGraphNodeState } from "../../types/graph";
import { emitUiEvent } from "../emit";
import { createServerMessage } from "../messages";
import {
  asClarifyActionData,
  asEndTradeActionData,
  asSkipActionData,
  asStartTradeActionData,
  asWaitActionData,
  extractOrderId,
  getMarketForOrder,
  getRequiredSessionId,
  orderLooksEquivalent,
  validateExposure,
  validateMarketConstraints,
  validateStartTradeOrder,
} from "../trade/validate";

export async function runStageActionNode(state: TradingGraphNodeState) {
  if (!state.aiResponse) {
    throw new Error("Cannot execute stage action without an AI response.");
  }

  const stageAction = state.aiResponse.nextStage.stageAction;
  const stageActionData = state.aiResponse.nextStage.stageActionData;
  const modelReasoning = state.aiResponse.reasoning;

  if (!stageAction) {
    return { stopReason: "No stage action selected yet." };
  }

  const sessionId = getRequiredSessionId(state.sessionId);
  const wakeTraceId = state.wakeTraceId ?? randomUUID();
  debugLog("graph.node", "run-stage-action", {
    sessionId,
    userId: state.userId,
    stageAction,
  });
  emitUiEvent(
    state,
    "stage-action",
    {
      node: "run-stage-action",
      stageAction,
      status: "selected",
      stageActionData: (stageActionData ?? {}) as Record<string, unknown>,
    },
    sessionId,
  );
  await acquireStageLock(sessionId, wakeTraceId);

  try {
    switch (stageAction) {
      case "START_TRADE": {
        const workflow = await getSessionWorkflow(sessionId);
        const workflowGate = canExecuteTrade(workflow);
        if (!workflowGate.allowed) {
          emitUiEvent(
            state,
            "stage-action",
            {
              node: "run-stage-action",
              stageAction,
              status: "blocked",
              reason: workflowGate.reason,
            },
            sessionId,
          );

          return {
            stageActionComplete: false,
            stopReason: null,
            messages: [
              createServerMessage(
                JSON.stringify({
                  kind: "stage-action-result",
                  stageAction,
                  status: "blocked",
                  reason: workflowGate.reason,
                  fallback: "model-next-step-required",
                }),
              ),
            ],
          };
        }

        const researchGate = await getResearchGate(sessionId);
        const tradeGate = canStartTrade(researchGate);
        if (!tradeGate.allowed) {
          emitUiEvent(
            state,
            "stage-action",
            {
              node: "run-stage-action",
              stageAction,
              status: "blocked",
              reason: tradeGate.reason,
            },
            sessionId,
          );

          return {
            stageActionComplete: false,
            stopReason: null,
            messages: [
              createServerMessage(
                JSON.stringify({
                  kind: "stage-action-result",
                  stageAction,
                  status: "blocked",
                  reason: tradeGate.reason,
                  fallback: "model-next-step-required",
                }),
              ),
            ],
          };
        }

        const actionData = asStartTradeActionData(stageActionData);
        const intendedOrder = validateStartTradeOrder(
          state.intendedStartTradeOrder ?? actionData.order,
        );

        const [openOrders, market] = await Promise.all([
          getOpenOrders({}),
          getMarketForOrder(intendedOrder),
        ]);
        validateMarketConstraints(intendedOrder, market);

        const [existingOrder] = openOrders.filter(
          (openOrder) => openOrder.asset_id === intendedOrder.tokenId,
        );
        if (existingOrder) {
          const likelyMatch = orderLooksEquivalent(
            intendedOrder,
            existingOrder,
          );
          await setSessionOrderId(sessionId, existingOrder.id);
          emitUiEvent(
            state,
            "stage-action",
            {
              node: "run-stage-action",
              stageAction,
              modelReasoning,
              status: "needs-review",
              orderId: existingOrder.id,
              likelyMatch,
            },
            sessionId,
          );

          return {
            stageActionComplete: false,
            intendedStartTradeOrder: intendedOrder,
            stopReason: null,
            messages: [
              createServerMessage(
                `Existing open order ${existingOrder.id} found for token ${intendedOrder.tokenId}. likelyMatch=${likelyMatch}. Details: ${JSON.stringify(existingOrder)}. Validate against intended shape; call cancel-unwanted-order if mismatched.`,
              ),
            ],
          };
        }
        validateExposure(intendedOrder, openOrders);

        if (botConfig.tradeGuardrails.dryRun) {
          await markLatestStageActionCompleted(sessionId, true);
          emitUiEvent(
            state,
            "stage-action",
            {
              node: "run-stage-action",
              stageAction,
              modelReasoning,
              status: "dry-run",
              reason: actionData.reason,
              resumeAt: actionData.resumeAt,
              order: intendedOrder as unknown as Record<string, unknown>,
            },
            sessionId,
          );
          return {
            stageActionComplete: true,
            intendedStartTradeOrder: intendedOrder,
            stopReason: "Stage action completed: START_TRADE (dry-run)",
            messages: [
              createServerMessage(
                JSON.stringify({
                  kind: "stage-action-result",
                  stageAction,
                  status: "dry-run",
                  reason: actionData.reason,
                  resumeAt: actionData.resumeAt,
                  order: intendedOrder,
                  orderId: null,
                }),
              ),
            ],
          };
        }

        const client = await initPolymarketClient();
        const side = intendedOrder.side === "BUY" ? Side.BUY : Side.SELL;
        const orderType =
          intendedOrder.orderType === "GTD" ? OrderType.GTD : OrderType.GTC;
        const orderResult = await client.createAndPostOrder(
          {
            tokenID: intendedOrder.tokenId,
            side,
            price: intendedOrder.price,
            size: intendedOrder.shareSize,
            ...(intendedOrder.expiration !== undefined
              ? { expiration: intendedOrder.expiration }
              : {}),
          },
          undefined,
          orderType,
          intendedOrder.postOnly,
        );
        const orderId = extractOrderId(orderResult);

        try {
          await setSessionOrderId(sessionId, orderId);
        } catch (metadataError) {
          try {
            await client.cancelOrder({ orderID: orderId });
          } catch (rollbackError) {
            throw new Error(
              `Placed order ${orderId} but failed to persist metadata and rollback cancel failed: ${String(rollbackError)}`,
            );
          }

          throw new Error(
            `Placed order ${orderId} but failed to persist metadata. Rolled order back. ${String(metadataError)}`,
          );
        }

        await markLatestStageActionCompleted(sessionId, true);
        startHeartbeat(sessionId);
        emitUiEvent(
          state,
          "stage-action",
          {
            node: "run-stage-action",
            stageAction,
            modelReasoning,
            status: "executed",
            reason: actionData.reason,
            resumeAt: actionData.resumeAt,
            order: intendedOrder as unknown as Record<string, unknown>,
            orderId,
          },
          sessionId,
        );
        return {
          stageActionComplete: true,
          intendedStartTradeOrder: intendedOrder,
          stopReason: "Stage action completed: START_TRADE",
          messages: [
            createServerMessage(
              JSON.stringify({
                kind: "stage-action-result",
                stageAction,
                status: "executed",
                reason: actionData.reason,
                resumeAt: actionData.resumeAt,
                order: intendedOrder,
                orderId,
                result: orderResult,
              }),
            ),
          ],
        };
      }
      case "END_TRADE": {
        const actionData = asEndTradeActionData(stageActionData);
        const client = await initPolymarketClient();

        let closePath: "specific-order" | "fallback-cancel-all" =
          "specific-order";
        let result: unknown;
        let orderId: string | null = null;

        try {
          orderId = await getSessionOrderId(sessionId);
          result = await client.cancelOrder({ orderID: orderId });
        } catch {
          closePath = "fallback-cancel-all";
          result = await client.cancelAll();
        }

        await clearSessionOrderId(sessionId);
        await markLatestStageActionCompleted(sessionId, true);
        stopHeartbeat(sessionId);
        emitUiEvent(
          state,
          "stage-action",
          {
            node: "run-stage-action",
            stageAction,
            modelReasoning,
            status: "executed",
            reason: actionData.reason,
            closePath,
            orderId,
          },
          sessionId,
        );

        return {
          stageActionComplete: true,
          intendedStartTradeOrder: null,
          stopReason: "Stage action completed: END_TRADE",
          messages: [
            createServerMessage(
              JSON.stringify({
                kind: "stage-action-result",
                stageAction,
                status: "executed",
                reason: actionData.reason,
                closePath,
                orderId,
                result,
              }),
            ),
          ],
        };
      }
      case "WAIT": {
        const actionData = asWaitActionData(stageActionData);
        await markLatestStageActionCompleted(sessionId, true);
        emitUiEvent(
          state,
          "stage-action",
          {
            node: "run-stage-action",
            stageAction,
            modelReasoning,
            status: "scheduled",
            reason: actionData.reason,
            resumeAt: actionData.resumeAt,
          },
          sessionId,
        );

        return {
          stageActionComplete: true,
          stopReason: "Stage action completed: WAIT",
          messages: [
            createServerMessage(
              JSON.stringify({
                kind: "stage-action-result",
                stageAction,
                status: "scheduled",
                reason: actionData.reason,
                resumeAt: actionData.resumeAt,
              }),
            ),
          ],
        };
      }
      case "SKIP": {
        const actionData = asSkipActionData(stageActionData);
        await markLatestStageActionCompleted(sessionId, true);
        emitUiEvent(
          state,
          "stage-action",
          {
            node: "run-stage-action",
            stageAction,
            modelReasoning,
            status: "skipped",
            reason: actionData.reason,
          },
          sessionId,
        );

        return {
          stageActionComplete: true,
          stopReason: "Stage action completed: SKIP",
          messages: [
            createServerMessage(
              JSON.stringify({
                kind: "stage-action-result",
                stageAction,
                status: "skipped",
                reason: actionData.reason,
              }),
            ),
          ],
        };
      }
      case "CLARIFY": {
        const actionData = asClarifyActionData(stageActionData);
        await markLatestStageActionCompleted(sessionId, true);
        emitUiEvent(
          state,
          "stage-action",
          {
            node: "run-stage-action",
            stageAction,
            status: "clarify",
            modelReasoning,
            reason: actionData.reason,
            userMessageHtml: actionData.userMessageHtml,
            resumeAt: actionData.resumeAt,
          },
          sessionId,
        );

        return {
          stageActionComplete: true,
          stopReason: "Stage action completed: CLARIFY",
          messages: [
            createServerMessage(
              JSON.stringify({
                kind: "stage-action-result",
                stageAction,
                status: "clarify",
                reason: actionData.reason,
                userMessageHtml: actionData.userMessageHtml,
                resumeAt: actionData.resumeAt,
              }),
            ),
          ],
        };
      }
      default: {
        const unsupported = stageAction satisfies never;
        throw new Error(`Unsupported stage action: ${unsupported}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : "UnknownError";
    let stageUpdateError: string | null = null;

    try {
      await markLatestStageActionCompleted(sessionId, false);
    } catch (markError) {
      stageUpdateError =
        markError instanceof Error ? markError.message : String(markError);
    }
    emitUiEvent(
      state,
      "stage-action",
      {
        node: "run-stage-action",
        stageAction,
        status: "failed",
        errorName,
        errorMessage,
        stageUpdateError,
      },
      sessionId,
    );

    const nextFailureCount = state.failureCount + 1;
    if (shouldTripCircuitBreaker(nextFailureCount)) {
      throw new CircuitBreakerError(nextFailureCount);
    }

    return {
      stageActionComplete: false,
      failureCount: 1,
      stopReason: null,
      messages: [
        createServerMessage(
          JSON.stringify({
            kind: "stage-action-result",
            stageAction,
            status: "failed",
            fallback: "model-next-step-required",
            error: {
              name: errorName,
              message: errorMessage,
            },
            stageUpdateError,
          }),
        ),
      ],
    };
  } finally {
    await releaseStageLock(sessionId, wakeTraceId);
  }
}
