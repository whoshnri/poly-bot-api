import prisma from "../../db/prisma";
import { normalizeAiProvider } from "../../shared/aiProviders";
import { decryptSecretIfPresent, hasStoredSecret } from "../../shared/secretCrypto";

export type UserAiConfig = {
  apiKey: string;
  provider: string;
};

export async function getUserAiConfig(loginUserId: string): Promise<UserAiConfig | null> {
  const user = await prisma.user.findUnique({
    where: { userId: loginUserId },
    include: {
      userConfig: {
        select: {
          aiApiKey: true,
          aiApiProvider: true,
        },
      },
    },
  });

  const storedKey = user?.userConfig?.aiApiKey;
  const provider = normalizeAiProvider(user?.userConfig?.aiApiProvider);
  if (!hasStoredSecret(storedKey) || !provider) {
    return null;
  }

  const apiKey = decryptSecretIfPresent(storedKey);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    provider,
  };
}

export async function userHasBotConfig(loginUserId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { userId: loginUserId },
    select: {
      botConfig: {
        select: { id: true },
      },
    },
  });

  return Boolean(user?.botConfig);
}
