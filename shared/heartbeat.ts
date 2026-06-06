import { runHeartbeatLoop } from "../polymarket";
import { initPolymarketClient } from "../polymarket";
import type { ClobClient as ClobClientV1 } from "@polymarket/clob-client";

const heartbeatControllers = new Map<string, AbortController>();

export function startHeartbeat(sessionId: string): void {
  if (heartbeatControllers.has(sessionId)) {
    return;
  }

  const controller = new AbortController();
  heartbeatControllers.set(sessionId, controller);

  initPolymarketClient()
    .then((client) =>
      runHeartbeatLoop({
        client: client as unknown as ClobClientV1,
        signal: controller.signal,
        onHeartbeat: (hb) => {
          console.log(`[heartbeat] session=${sessionId} id=${hb.heartbeat_id}`);
        },
      }),
    )
    .catch((err) => {
      console.error(`[heartbeat] Loop failed for session ${sessionId}:`, err instanceof Error ? err.message : err);
      heartbeatControllers.delete(sessionId);
    });
}

export function stopHeartbeat(sessionId: string): void {
  const controller = heartbeatControllers.get(sessionId);
  if (!controller) {
    return;
  }

  controller.abort();
  heartbeatControllers.delete(sessionId);
  console.log(`[heartbeat] Stopped for session ${sessionId}`);
}

export function isHeartbeatActive(sessionId: string): boolean {
  return heartbeatControllers.has(sessionId);
}
