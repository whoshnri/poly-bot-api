import prisma from "./prisma";
import { applyBotConfigRecord, defaultBotConfigValues } from "../config/bot";
import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  isAiProvider,
  normalizeAiProvider,
  type AiProvider,
} from "../shared/aiProviders";
import {
  decryptSecretIfPresent,
  encryptSecretIfPresent,
  hasStoredSecret,
} from "../shared/secretCrypto";

function maskSecret(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const plaintext = decryptSecretIfPresent(value);
    if (!plaintext) {
      return "****";
    }
    if (plaintext.length <= 4) {
      return "****";
    }
    return `${plaintext.slice(0, 4)}${"*".repeat(Math.min(plaintext.length - 4, 12))}`;
  } catch {
    return "****";
  }
}

export type UserRunReadiness = {
  hasBotConfig: boolean;
  hasAiConfig: boolean;
  canRunBot: boolean;
  onboardingCompleted: boolean;
  message: string | null;
  aiProviders: Array<{ id: AiProvider; label: string }>;
  requiredSteps: {
    botConfig: boolean;
    aiConfig: boolean;
  };
};

function buildReadinessState(input: {
  hasBotConfig: boolean;
  hasAiConfig: boolean;
}): Pick<UserRunReadiness, "hasBotConfig" | "hasAiConfig" | "canRunBot" | "message" | "requiredSteps"> {
  const hasBotConfig = input.hasBotConfig;
  const hasAiConfig = input.hasAiConfig;
  const canRunBot = hasBotConfig && hasAiConfig;

  let message: string | null = null;
  if (!hasBotConfig) {
    message = "Trade guardrails are not configured for this account.";
  } else if (!hasAiConfig) {
    message = "Add an AI provider and API key before starting a session.";
  }

  return {
    hasBotConfig,
    hasAiConfig,
    canRunBot,
    message,
    requiredSteps: {
      botConfig: hasBotConfig,
      aiConfig: hasAiConfig,
    },
  };
}

async function syncOnboardingCompleted(loginUserId: string, completed: boolean): Promise<void> {
  await prisma.user.update({
    where: { userId: loginUserId },
    data: { onboardingCompleted: completed },
  });
}

export function getAiProviderOptions() {
  return AI_PROVIDERS.map((id) => ({ id, label: AI_PROVIDER_LABELS[id] }));
}

export async function getUserRunReadiness(loginUserId: string): Promise<UserRunReadiness> {
  const user = await prisma.user.findUnique({
    where: { userId: loginUserId },
    include: {
      botConfig: true,
      userConfig: true,
    },
  });

  const hasBotConfig = Boolean(user?.botConfig);
  const hasAiConfig = Boolean(
    hasStoredSecret(user?.userConfig?.aiApiKey) &&
      normalizeAiProvider(user?.userConfig?.aiApiProvider),
  );
  const readinessState = buildReadinessState({ hasBotConfig, hasAiConfig });

  if (user && user.onboardingCompleted !== readinessState.canRunBot) {
    await syncOnboardingCompleted(loginUserId, readinessState.canRunBot);
  }

  return {
    ...readinessState,
    onboardingCompleted: readinessState.canRunBot,
    aiProviders: getAiProviderOptions(),
  };
}

export async function assertUserCanRunBot(loginUserId: string): Promise<void> {
  const readiness = await getUserRunReadiness(loginUserId);
  if (!readiness.canRunBot) {
    throw new Error(readiness.message ?? "Account is not ready to run the bot.");
  }
}

export async function getUserSettings(loginUserId: string) {
  const user = await prisma.user.findUnique({
    where: { userId: loginUserId },
    include: {
      botConfig: true,
      userConfig: true,
    },
  });

  if (!user) {
    throw new Error(`User not found: ${loginUserId}`);
  }

  const readiness = await getUserRunReadiness(loginUserId);

  return {
    userId: user.userId,
    preferences: user.preferences,
    botConfig: user.botConfig ?? {
      ...defaultBotConfigValues,
    },
    userConfig: user.userConfig
      ? {
          id: user.userConfig.id,
          polymarketApiKey: maskSecret(user.userConfig.polymarketApiKey),
          polymarketApiSecret: maskSecret(user.userConfig.polymarketApiSecret),
          aiApiProvider: normalizeAiProvider(user.userConfig.aiApiProvider),
          aiApiKey: maskSecret(user.userConfig.aiApiKey),
          hasPolymarketApiKey: hasStoredSecret(user.userConfig.polymarketApiKey),
          hasPolymarketApiSecret: hasStoredSecret(user.userConfig.polymarketApiSecret),
          hasAiApiKey: hasStoredSecret(user.userConfig.aiApiKey),
          hasAiConfig: readiness.hasAiConfig,
          updatedAt: user.userConfig.updatedAt.toISOString(),
        }
      : null,
    readiness: {
      hasBotConfig: readiness.hasBotConfig,
      hasAiConfig: readiness.hasAiConfig,
      canRunBot: readiness.canRunBot,
      onboardingCompleted: readiness.onboardingCompleted,
      message: readiness.message,
      aiProviders: readiness.aiProviders,
      requiredSteps: readiness.requiredSteps,
    },
  };
}

export type UpdateUserSettingsInput = {
  botConfig?: Partial<{
    maxOrderSizeUsdc: number;
    maxExposureUsdc: number;
    allowedSides: string[];
    minPrice: number;
    maxPrice: number;
    dryRun: boolean;
  }>;
  userConfig?: Partial<{
    polymarketApiKey: string | null;
    polymarketApiSecret: string | null;
    aiApiKey: string | null;
    aiApiProvider: string | null;
  }>;
};

export async function updateUserSettings(loginUserId: string, input: UpdateUserSettingsInput) {
  const user = await prisma.user.findUnique({
    where: { userId: loginUserId },
    include: {
      botConfig: true,
      userConfig: true,
    },
  });

  if (!user) {
    throw new Error(`User not found: ${loginUserId}`);
  }

  if (input.userConfig?.aiApiProvider && !isAiProvider(input.userConfig.aiApiProvider)) {
    throw new Error(`Unsupported AI provider: ${input.userConfig.aiApiProvider}`);
  }

  await prisma.$transaction(async (tx) => {
    if (input.botConfig) {
      if (user.botConfig) {
        await tx.botConfig.update({
          where: { id: user.botConfig.id },
          data: input.botConfig,
        });
      } else {
        await tx.botConfig.create({
          data: {
            userId: user.id,
            ...defaultBotConfigValues,
            ...input.botConfig,
          },
        });
      }
    }

    if (input.userConfig) {
      const configData: {
        polymarketApiKey?: string | null;
        polymarketApiSecret?: string | null;
        aiApiKey?: string | null;
        aiApiProvider?: string | null;
      } = {};

      if (input.userConfig.polymarketApiKey !== undefined) {
        configData.polymarketApiKey = encryptSecretIfPresent(input.userConfig.polymarketApiKey);
      }
      if (input.userConfig.polymarketApiSecret !== undefined) {
        configData.polymarketApiSecret = encryptSecretIfPresent(input.userConfig.polymarketApiSecret);
      }
      if (input.userConfig.aiApiKey !== undefined) {
        configData.aiApiKey = encryptSecretIfPresent(input.userConfig.aiApiKey);
      }
      if (input.userConfig.aiApiProvider !== undefined) {
        configData.aiApiProvider = input.userConfig.aiApiProvider;
      }

      if (user.userConfig) {
        await tx.userConfig.update({
          where: { id: user.userConfig.id },
          data: configData,
        });
      } else {
        await tx.userConfig.create({
          data: {
            userId: user.id,
            ...configData,
          },
        });
      }
    }
  });

  return getUserSettings(loginUserId);
}

export async function applyRuntimeBotConfigForUser(loginUserId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { userId: loginUserId },
    include: { botConfig: true },
  });

  if (!user?.botConfig) {
    return;
  }

  applyBotConfigRecord(user.botConfig);
}

export async function assertSessionOwnedByUser(sessionId: string, loginUserId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId: loginUserId },
    select: { id: true },
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  return session;
}
