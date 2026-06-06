import prisma from "./prisma";
import { hashPassword, verifyPassword } from "../shared/auth";
import { defaultBotConfigValues } from "../config/bot";

export async function registerUser(input: { userId: string; password: string }) {
  const userId = input.userId.trim();
  const password = input.password;

  if (userId.length < 3) {
    throw new Error("User ID must be at least 3 characters.");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existing = await prisma.user.findUnique({ where: { userId } });
  if (existing) {
    throw new Error("User ID is already taken.");
  }

  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        userId,
        password: passwordHash,
        preferences: {},
      },
    });

    await tx.botConfig.create({
      data: {
        userId: user.id,
        ...defaultBotConfigValues,
      },
    });

    await tx.userConfig.create({
      data: {
        userId: user.id,
      },
    });

    return user;
  });
}

export async function authenticateUser(input: { userId: string; password: string }) {
  const userId = input.userId.trim();
  const user = await prisma.user.findUnique({ where: { userId } });
  if (!user) {
    throw new Error("Invalid user ID or password.");
  }

  const valid = await verifyPassword(input.password, user.password);
  if (!valid) {
    throw new Error("Invalid user ID or password.");
  }

  return user;
}

export async function getUserByUserId(userId: string) {
  return prisma.user.findUnique({
    where: { userId },
    include: {
      botConfig: true,
      userConfig: true,
    },
  });
}
