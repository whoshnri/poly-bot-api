import configJson from "./config.json" with { type: "json" };
import type { UserPreferences } from "../types/db";

export type TradeGuardrails = {
  maxOrderSizeUsdc: number;
  maxExposureUsdc: number;
  allowedSides: ("BUY" | "SELL")[];
  minPrice: number;
  maxPrice: number;
  dryRun: boolean;
};

export type BotConfig = {
  maxRetriesPerStage: number;
  tradeGuardrails: TradeGuardrails;
};

export const defaultBotConfigValues = {
  maxOrderSizeUsdc: 100,
  maxExposureUsdc: 500,
  allowedSides: ["BUY", "SELL"] as string[],
  minPrice: 0.01,
  maxPrice: 0.99,
  dryRun: true,
};

const defaults: BotConfig = {
  maxRetriesPerStage: 3,
  tradeGuardrails: {
    maxOrderSizeUsdc: 100,
    maxExposureUsdc: 500,
    allowedSides: ["BUY", "SELL"],
    minPrice: 0.01,
    maxPrice: 0.99,
    dryRun: false,
  },
};

export function getBotGaurdrails(): TradeGuardrails {
  return botConfig.tradeGuardrails;
}

function loadConfig(): BotConfig {
  const parsed = configJson as Partial<BotConfig>;
  return {
    maxRetriesPerStage: parsed.maxRetriesPerStage ?? defaults.maxRetriesPerStage,
    tradeGuardrails: {
      ...defaults.tradeGuardrails,
      ...parsed.tradeGuardrails,
    },
  };
}

export const botConfig: BotConfig = loadConfig();

export function applyUserPreferences(prefs: Partial<UserPreferences>): void {
  if (prefs.dryRun !== undefined) {
    botConfig.tradeGuardrails.dryRun = prefs.dryRun;
  }
  if (prefs.maxOrderSizeUsdc !== undefined) {
    botConfig.tradeGuardrails.maxOrderSizeUsdc = prefs.maxOrderSizeUsdc;
  }
}

export function applyBotConfigRecord(record: {
  maxOrderSizeUsdc: number;
  maxExposureUsdc: number;
  allowedSides: string[];
  minPrice: number;
  maxPrice: number;
  dryRun: boolean;
}): void {
  botConfig.tradeGuardrails = {
    maxOrderSizeUsdc: record.maxOrderSizeUsdc,
    maxExposureUsdc: record.maxExposureUsdc,
    allowedSides: record.allowedSides.filter(
      (side): side is "BUY" | "SELL" => side === "BUY" || side === "SELL",
    ),
    minPrice: record.minPrice,
    maxPrice: record.maxPrice,
    dryRun: record.dryRun,
  };
}

export function buildGuardrailsDescription(): string {
  const g = botConfig.tradeGuardrails;
  const lines = [
    "Operator-configured trade guardrails (MUST be respected at all times):",
    `- Max single order size: $${g.maxOrderSizeUsdc} USDC`,
    `- Max total exposure: $${g.maxExposureUsdc} USDC`,
    `- Allowed sides: ${g.allowedSides.join(", ")}`,
    `- Price range: ${g.minPrice} – ${g.maxPrice}`,
    `- Dry-run mode: ${g.dryRun ? "ENABLED (no real orders will be placed)" : "disabled (live trading active)"}`,
    `- Max retries per stage: ${botConfig.maxRetriesPerStage}`,
  ];
  return lines.join("\n");
}
