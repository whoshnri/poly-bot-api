import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { GlobalForPrisma } from "../types/prisma";

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is required to initialize Prisma.');
  }

  const connectionUrl = new URL(raw);
  const sslMode = connectionUrl.searchParams.get("sslmode")?.toLowerCase();

  // Keep current libpq semantics for sslmode=require to avoid parser deprecation behavior.
  if (sslMode === "require" && !connectionUrl.searchParams.has("uselibpqcompat")) {
    connectionUrl.searchParams.set("uselibpqcompat", "true");
  }

  return connectionUrl.toString();
}

const globalForPrisma = global as unknown as GlobalForPrisma;
const adapter = new PrismaPg({
  connectionString: resolveDatabaseUrl(),
});
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
