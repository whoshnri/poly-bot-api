import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { GlobalForPrisma } from "../types/prisma";

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is required to initialize Prisma.");
  }

  const connectionUrl = new URL(raw);
  const sslMode = connectionUrl.searchParams.get("sslmode")?.toLowerCase();

  if (sslMode === "require" && !connectionUrl.searchParams.has("uselibpqcompat")) {
    connectionUrl.searchParams.set("uselibpqcompat", "true");
  }

  return connectionUrl.toString();
}

const globalForPrisma = global as unknown as GlobalForPrisma;

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: resolveDatabaseUrl(),
  });
  return new PrismaClient({ adapter });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
