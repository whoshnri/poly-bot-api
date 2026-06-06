import type { Context } from "hono";
import { getUserRunReadiness, getUserSettings } from "../../db/users";
import { jsonOk } from "../../shared/apiResponse";

type DepStatus = {
  ok: boolean;
  message: string;
};

async function checkHttp(url: string, timeoutMs = 5000): Promise<DepStatus> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { ok: false, message: `${response.status} ${response.statusText}` };
    }
    return { ok: true, message: "reachable" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getHealthDeps(c: Context) {
  const userId = c.get("userId") as string | undefined;
  const wakeUrl = process.env.WAKE_SERVER_URL ?? "http://localhost:8443";

  const [gamma, wake] = await Promise.all([
    checkHttp("https://gamma-api.polymarket.com/markets?limit=1"),
    checkHttp(`${wakeUrl}/health`),
  ]);

  let settings: Awaited<ReturnType<typeof getUserSettings>> | null = null;
  let readiness: Awaited<ReturnType<typeof getUserRunReadiness>> | null = null;
  if (userId) {
    try {
      settings = await getUserSettings(userId);
      readiness = settings.readiness;
    } catch {
      settings = null;
      readiness = null;
    }
  }

  const deps = {
    database: {
      ok: Boolean(process.env.DATABASE_URL),
      message: process.env.DATABASE_URL ? "DATABASE_URL set" : "DATABASE_URL missing",
    },
    ai: {
      ok: readiness?.hasAiConfig ?? false,
      message: readiness?.hasAiConfig
        ? "user AI provider configured"
        : "Configure an AI provider and API key in settings",
    },
    tavily: {
      ok: Boolean(process.env.TAVILY_API_KEY),
      message: process.env.TAVILY_API_KEY ? "TAVILY_API_KEY set" : "TAVILY_API_KEY missing",
    },
    polymarketGamma: gamma,
    polymarketClob: await checkHttp("https://clob.polymarket.com/"),
    wakeScheduler: {
      ok: wake.ok,
      message: wake.ok ? wakeUrl : `Cannot reach ${wakeUrl}/health — ${wake.message}`,
    },
    polymarketTrading: {
      ok: Boolean(process.env.POLYMARKET_PRIVATE_KEY || process.env.POLY_API_KEY),
      message:
        process.env.POLYMARKET_PRIVATE_KEY || process.env.POLY_API_KEY
          ? "credentials configured"
          : "POLYMARKET_PRIVATE_KEY or POLY_API_KEY missing (live trades disabled)",
    },
    user: settings
      ? {
          hasBotConfig: settings.readiness.hasBotConfig,
          hasAiConfig: settings.readiness.hasAiConfig,
          canRunBot: settings.readiness.canRunBot,
          hasPolymarketApiKey: settings.userConfig?.hasPolymarketApiKey ?? false,
          dryRun: settings.botConfig?.dryRun ?? true,
        }
      : null,
  };

  const allOk =
    deps.database.ok &&
    deps.ai.ok &&
    deps.tavily.ok &&
    deps.polymarketGamma.ok &&
    deps.wakeScheduler.ok;

  return jsonOk(c, {
    status: allOk ? "healthy" : "degraded",
    deps,
    hints: [
      !deps.wakeScheduler.ok ? `Set WAKE_SERVER_URL=${wakeUrl} and ensure API is running on that port.` : null,
      !deps.tavily.ok ? "TAVILY_API_KEY required for web research before trading." : null,
      !deps.ai.ok ? "Configure an AI provider and API key in settings." : null,
    ].filter(Boolean),
  });
}
