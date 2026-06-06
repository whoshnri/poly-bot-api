import { randomUUID } from "node:crypto";
import prisma from "../db/prisma";

export type FeedbackType = "mcq" | "text" | "mcq_or_custom" | "multi_select";

export type PendingFeedback = {
  requestId: string;
  type: FeedbackType;
  question: string;
  options: string[];
  minSelections?: number;
  maxSelections?: number;
  reason: string;
  createdAt: string;
};

export type FeedbackAnswerInput = {
  selectedOption?: string;
  selectedOptions?: string[];
  customText?: string;
  textAnswer?: string;
};

export class AwaitingFeedbackError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super(`Awaiting user feedback: ${requestId}`);
    this.name = "AwaitingFeedbackError";
    this.requestId = requestId;
  }
}

function readMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function optionMatchesSelection(option: string, selected: string): boolean {
  const normalizedOption = option.trim();
  const normalizedSelected = selected.trim();
  if (normalizedOption === normalizedSelected) {
    return true;
  }

  const optionMarketId = normalizedOption.match(/^\[([^\]]+)\]/)?.[1];
  const selectedMarketId = normalizedSelected.match(/^\[([^\]]+)\]/)?.[1];
  if (optionMarketId && selectedMarketId && optionMarketId === selectedMarketId) {
    return true;
  }

  return (
    normalizedOption.toLowerCase().includes(normalizedSelected.toLowerCase()) ||
    normalizedSelected.toLowerCase().includes(normalizedOption.toLowerCase())
  );
}

function isValidFeedbackSelection(selected: string, options: string[]): boolean {
  if (options.length === 0) {
    return selected.trim().length > 0;
  }

  return options.some((option) => optionMatchesSelection(option, selected));
}

export function formatFeedbackAnswer(
  pending: Pick<PendingFeedback, "type" | "question" | "options">,
  answer: FeedbackAnswerInput,
): string {
  if (pending.type === "text") {
    const text = answer.textAnswer?.trim();
    if (!text) {
      throw new Error("A text answer is required.");
    }
    return `Your answer: ${text}`;
  }

  if (pending.type === "mcq") {
    const selected = answer.selectedOption?.trim();
    const custom = answer.textAnswer?.trim();
    if (!selected && custom) {
      return `Custom note: ${custom}`;
    }
    if (!selected) {
      throw new Error("Please select one option.");
    }
    if (pending.options.length > 0 && !isValidFeedbackSelection(selected, pending.options)) {
      throw new Error("Selected option is not valid.");
    }
    return `You chose: ${selected}`;
  }

  if (pending.type === "multi_select") {
    const selectedOptions = Array.isArray(answer.selectedOptions)
      ? answer.selectedOptions.map((entry) => entry.trim()).filter(Boolean)
      : [];
    if (selectedOptions.length === 0) {
      throw new Error("Please select at least one option.");
    }
    if (
      pending.options.length > 0 &&
      selectedOptions.some((option) => !isValidFeedbackSelection(option, pending.options))
    ) {
      throw new Error("One or more selected options are not valid.");
    }

    const minimum = pending.minSelections ?? 1;
    const maximum = pending.maxSelections ?? pending.options.length;
    if (selectedOptions.length < minimum) {
      throw new Error(`Select at least ${minimum} option${minimum === 1 ? "" : "s"}.`);
    }
    if (selectedOptions.length > maximum) {
      throw new Error(`Select no more than ${maximum} options.`);
    }

    return `You chose: ${selectedOptions.join(" | ")}`;
  }

  const selected = answer.selectedOption?.trim();
  const custom = answer.customText?.trim();
  if (!selected && !custom) {
    throw new Error("Select an option or enter a custom answer.");
  }
  if (selected && pending.options.length > 0 && !isValidFeedbackSelection(selected, pending.options)) {
    throw new Error("Selected option is not valid.");
  }

  const lines = [
    selected ? `You chose: ${selected}` : "",
    custom ? `Custom note: ${custom}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function savePendingFeedback(
  sessionId: string,
  pending: PendingFeedback,
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const metadata = readMetadata(session.metadata);
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      metadata: {
        ...metadata,
        pendingFeedback: pending,
      } as object,
    },
  });
}

export async function getPendingFeedback(sessionId: string): Promise<PendingFeedback | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });
  if (!session) {
    return null;
  }

  const metadata = readMetadata(session.metadata);
  const pending = metadata.pendingFeedback;
  if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
    return null;
  }

  const record = pending as Record<string, unknown>;
  if (
    typeof record.requestId !== "string" ||
    typeof record.type !== "string" ||
    typeof record.question !== "string"
  ) {
    return null;
  }

  return {
    requestId: record.requestId,
    type: record.type as FeedbackType,
    question: record.question,
    options: Array.isArray(record.options)
      ? record.options.filter((entry): entry is string => typeof entry === "string")
      : [],
    minSelections:
      typeof record.minSelections === "number" ? record.minSelections : undefined,
    maxSelections:
      typeof record.maxSelections === "number" ? record.maxSelections : undefined,
    reason: typeof record.reason === "string" ? record.reason : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
  };
}

export async function clearPendingFeedback(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });
  if (!session) {
    return;
  }

  const metadata = readMetadata(session.metadata);
  const { pendingFeedback: _removed, ...rest } = metadata;
  await prisma.session.update({
    where: { id: sessionId },
    data: { metadata: rest as object },
  });
}

export function createPendingFeedback(input: {
  type: FeedbackType;
  question: string;
  options?: string[];
  minSelections?: number;
  maxSelections?: number;
  reason: string;
}): PendingFeedback {
  return {
    requestId: randomUUID(),
    type: input.type,
    question: input.question,
    options: input.options ?? [],
    minSelections: input.minSelections,
    maxSelections: input.maxSelections,
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
}
