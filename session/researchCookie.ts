import prisma from "../db/prisma";
import {
  readResearchCookie,
  upsertResearchEntry,
  type ResearchCookie,
  type ResearchEntry,
} from "./researchCookieLogic";

export {
  listResearchedMarketIds,
  readResearchCookie,
  summarizeResearchCookie,
  upsertResearchEntry,
  type ResearchCookie,
  type ResearchEntry,
} from "./researchCookieLogic";

function readMetadataRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return metadata as Record<string, unknown>;
}

export async function getResearchCookie(sessionId: string): Promise<ResearchCookie> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  return readResearchCookie(session?.metadata ?? null);
}

export async function appendResearchEntry(
  sessionId: string,
  entry: ResearchEntry,
): Promise<ResearchCookie> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const metadata = readMetadataRecord(session.metadata);
  const nextCookie = upsertResearchEntry(readResearchCookie(metadata), entry);

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      metadata: {
        ...metadata,
        researchCookie: nextCookie,
      },
    },
  });

  return nextCookie;
}
